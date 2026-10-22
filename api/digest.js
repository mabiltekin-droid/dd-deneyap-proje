/* ==========================================================================
   api/digest.js — Vercel Serverless Function: haftalık özet bildirimi
   --------------------------------------------------------------------------
   Her pazartesi sabahı (TRT) son 7 günün alarm/olay kayıtlarını toplar ve
   tek bir Web Push bildirimi olarak gönderir:
       "Bu hafta 12 olay · 3 gaz · 2 alev · En yoğun: Salı 21:00"

   Neden sunucu tarafı? Telefon/panel kapalıyken de özet gitsin diye. Panel
   açıkken zaten anlık bildirimler çalışıyor; bu yalnızca "haftalık nabız".

   Tetikleme:
     - Vercel Cron (vercel.json → crons):  "0 6 * * 1"  (Pzt 06:00 UTC = 09:00 TRT)
       Vercel, CRON_SECRET tanımlıysa "Authorization: Bearer <CRON_SECRET>" ekler.
     - Elle:  curl -H "x-dd-secret: <PUSH_TRIGGER_SECRET>" \
                   https://<alan-adı>/api/digest
     - Deneme (göndermeden):  .../api/digest?dry=1

   Yanıt: { ok, total, byType, busiest, sent, removed, failed } (dry=1 ise gönderim yok)
   ========================================================================== */

'use strict';

const lib = require('./_lib');

/* events.js'deki TYPE anahtarlarıyla aynı olmalı */
const TURLER = {
  flame: 'alev',
  gas: 'gaz',
  gaswarn: 'gaz uyarısı',
  vib: 'sarsıntı',
  flood: 'su baskını',
  sensor: 'sensör arızası',
  offline: 'bağlantı kesintisi',
  online: 'bağlantı',
  boot: 'yeniden başlatma',
  mode: 'mod değişimi',
  system: 'sistem'
};

const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/* Türkiye sabit UTC+3 (2016'dan beri yaz saati uygulanmıyor). Sunucu UTC
   çalıştığı için gün/saat bu kaydırma ile hesaplanır. */
const TRT_MS = 3 * 3600 * 1000;

function ikili(n) { return (n < 10 ? '0' : '') + n; }

function gunSaat(ms) {
  const d = new Date(Number(ms) + TRT_MS);
  return { gun: d.getUTCDay(), saat: d.getUTCHours() };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Allow', 'GET, POST');

  /* --- yetki ------------------------------------------------------------- */
  if (!lib.authorized(req)) {
    res.status(401).json({
      ok: false,
      error: 'yetkisiz istek (CRON_SECRET veya x-dd-secret gerekli)'
    });
    return;
  }

  if (!lib.initAdmin()) {
    res.status(503).json({
      ok: false,
      error: 'FIREBASE_SERVICE_ACCOUNT tanımlı değil — olaylar okunamıyor'
    });
    return;
  }

  const dry = String((req.query && req.query.dry) || '') === '1';

  /* --- son 7 günün olayları ---------------------------------------------- */
  const GUN = 7;
  const since = Date.now() - GUN * 86400000;

  let snap;
  try {
    const db = require('firebase-admin').firestore();
    snap = await db.collection('alarm_events')
      .where('at', '>=', since)
      .orderBy('at', 'desc')
      .limit(1000)
      .get();
  } catch (e) {
    res.status(500).json({ ok: false, error: 'olaylar okunamadı: ' + (e && e.message) });
    return;
  }

  const olaylar = snap.docs.map(function (d) { return d.data() || {}; });

  /* --- özet çıkar -------------------------------------------------------- */
  const sayac = {};
  const saatler = {};
  let enYogun = null;

  olaylar.forEach(function (o) {
    const t = String(o.type || 'system');
    sayac[t] = (sayac[t] || 0) + 1;

    const gs = gunSaat(Number(o.at) || Date.now());
    const anahtar = gs.gun + ':' + gs.saat;
    saatler[anahtar] = (saatler[anahtar] || 0) + 1;
    if (!enYogun || saatler[anahtar] > enYogun.adet) {
      enYogun = { gun: gs.gun, saat: gs.saat, adet: saatler[anahtar] };
    }
  });

  /* En sık türler (en fazla 4) — "3 gaz · 2 alev" */
  const turler = Object.keys(sayac)
    .sort(function (a, b) { return sayac[b] - sayac[a]; })
    .slice(0, 4)
    .map(function (t) { return sayac[t] + ' ' + (TURLER[t] || t); });

  const toplam = olaylar.length;

  let baslik, govde;
  if (toplam === 0) {
    baslik = 'Haftalık Özet — sessiz bir hafta';
    govde = 'Son 7 günde alarm kaydı yok. Sistem sessiz görünüyor.';
  } else {
    baslik = 'Haftalık Özet — ' + toplam + ' olay';
    govde = turler.join(' · ');
    if (enYogun && enYogun.adet > 1) {
      govde += ' | En yoğun: ' + GUNLER[enYogun.gun] + ' ' +
               ikili(enYogun.saat) + ':00';
    }
  }

  const payload = {
    title: baslik,
    body: govde,
    tag: 'dd-digest',
    kind: 'digest',
    urgent: false,
    url: './'
  };

  const ozet = {
    ok: true,
    window: GUN + ' gün',
    total: toplam,
    byType: sayac,
    busiest: enYogun ? {
      day: GUNLER[enYogun.gun], hour: ikili(enYogun.saat) + ':00', count: enYogun.adet
    } : null,
    title: baslik,
    body: govde
  };

  if (dry) {
    res.status(200).json(Object.assign({ ok: true, dry: true }, ozet));
    return;
  }

  /* --- gönder ------------------------------------------------------------ */
  if (!lib.initVapid()) {
    res.status(503).json({
      ok: false,
      error: 'VAPID anahtarları tanımlı değil (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)'
    });
    return;
  }

  try {
    const r = await lib.sendToSubs(payload, { ttl: 86400, urgent: false });
    res.status(200).json(Object.assign({}, ozet, {
      ok: true,
      dry: false,
      targeted: r.targeted,
      sent: r.sent,
      removed: r.removed,
      failed: r.failed
    }));
  } catch (e) {
    res.status(500).json({ ok: false, error: 'gönderilemedi: ' + (e && e.message) });
  }
};
