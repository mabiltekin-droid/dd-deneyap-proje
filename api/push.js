/* ==========================================================================
   api/push.js — Vercel Serverless Function: Web Push + FCM gönderici
   --------------------------------------------------------------------------
   Panel/uygulama KAPALIYKEN bildirim göndermek için kullanılır.

   İki hedef birlikte desteklenir:
     • Web Push  → push_subs    (tarayıcı / PWA)
     • FCM       → push_tokens  (Android uygulaması)

   Tetikleyici: cihazın kendisi (MQTT firmware) alarm anında bu adrese kısa
   bir HTTPS isteği atar. Alternatif olarak curl ile elle de tetiklenebilir.

   İstek:
     POST /api/push
     x-dd-secret: <PUSH_TRIGGER_SECRET>
     { "device": "DK-1744", "kind": "flame|gas|flood|vib|offline|test", "uid": "op-01" }
       - uid verilmezse TÜM abonelere gönderilir (alarm = herkes),
       - test için: { "kind": "test", "uid": "<kendi-uid>" }

   Yanıt: { ok, kind, targeted, sent, removed, failed, web, fcm }

   Gerekli ortam değişkenleri (Vercel > Settings > Environment Variables):
     FIREBASE_SERVICE_ACCOUNT : servis hesabı JSON'u (FCM + Firestore)
     VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT : web push (opsiyonel)
     PUSH_TRIGGER_SECRET      : cihazın gönderdiği x-dd-secret ile AYNI
   ========================================================================== */

'use strict';

const lib = require('./_lib');

/* Tür -> varsayılan bildirim metni. Cihaz yalnızca `kind` gönderir. */
const KIND = {
  flame: {
    title: 'ALEV / YANGIN ALGILANDI',
    body: 'Siren çalıyor, pencere kapatıldı; fan ve su motoru durduruldu. Yangın güvenliğinizi kontrol edin.',
    urgent: true, tag: 'dd-flame'
  },
  gas: {
    title: 'GAZ KAÇAĞI (TEHLİKE)',
    body: 'Tahliye fanı çalıştırıldı, su motoru kilitlendi ve pencere kapatıldı.',
    urgent: true, tag: 'dd-gas'
  },
  flood: {
    title: 'SU BASKINI ALGILANDI',
    body: 'Pencere kapatıldı. Su motorunu ve tahliye önlemlerini kontrol edin.',
    urgent: true, tag: 'dd-flood'
  },
  vib: {
    title: 'SARSINTI / KURCALAMA ALGILANDI',
    body: 'Siren çalıyor. Evdeki durumu kontrol edin.',
    urgent: true, tag: 'dd-vib'
  },
  offline: {
    title: 'Cihaz Bağlantısı Kesildi',
    body: 'Deneyap Kart yanıt vermiyor.',
    urgent: false, tag: 'dd-offline'
  },
  test: {
    title: 'Test bildirimi',
    body: 'Arka plan bildirimi çalışıyor. Alarm anında benzer bir bildirim alacaksınız.',
    urgent: false, tag: 'dd-test'
  }
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-dd-secret');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  /* --- sağlık / yapılandırma sorgusu ------------------------------------- */
  if (req.method === 'GET') {
    const out = { ok: true, configured: { vapid: false, firestore: false, fcm: false } };
    try { out.configured.vapid = lib.initVapid(); } catch (e) { /* yoksay */ }
    try { out.configured.firestore = lib.initAdmin(); } catch (e) { out.error = e.message; }
    out.configured.fcm = out.configured.firestore;
    out.ready = out.configured.firestore;
    res.status(200).json(out);
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'yöntem desteklenmiyor' });
    return;
  }

  /* --- yetki ------------------------------------------------------------- */
  const secret = process.env.PUSH_TRIGGER_SECRET || '';
  const given = req.headers['x-dd-secret'] || req.headers['X-Dd-Secret'] || '';
  if (!secret || given !== secret) {
    res.status(401).json({ ok: false, error: 'yetkisiz istek' });
    return;
  }

  /* --- yapılandırma ------------------------------------------------------ */
  if (!lib.initAdmin()) {
    res.status(503).json({
      ok: false,
      error: 'FIREBASE_SERVICE_ACCOUNT tanımlı değil (abonelikler/tokenlar okunamıyor)'
    });
    return;
  }
  const vapidReady = (function () {
    try { return lib.initVapid(); } catch (e) { return false; }
  })();

  /* --- istek gövdesi ----------------------------------------------------- */
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const kindName = KIND[body.kind] ? body.kind : 'test';
  const k = KIND[kindName];
  const device = String(body.device || '').slice(0, 64);
  const title = body.title || k.title;
  const text = body.body || (device ? k.body + ' (Cihaz: ' + device + ')' : k.body);

  const webPayload = JSON.stringify({
    title: title,
    body: text,
    tag: k.tag,
    urgent: (body.urgent === undefined) ? k.urgent : !!body.urgent,
    kind: kindName,
    url: './'
  });

  /* --- Web Push (tarayıcı / PWA) ---------------------------------------- */
  let web = { targeted: 0, sent: 0, removed: 0, failed: 0, skipped: true };
  if (vapidReady) {
    try {
      web = await lib.sendToSubs(webPayload, {
        ttl: 3600,
        urgent: k.urgent,
        uid: body.uid
      });
      web.skipped = false;
    } catch (e) {
      web.error = e && e.message;
    }
  }

  /* --- FCM (Android uygulaması) ----------------------------------------- */
  let fcm = { targeted: 0, sent: 0, removed: 0, failed: 0 };
  try {
    fcm = await lib.sendFcm({
      kind: kindName,
      title: title,
      body: text,
      url: body.url || './'
    }, {
      ttl: 3600,
      urgent: k.urgent,
      uid: body.uid
    });
  } catch (e) {
    fcm.error = e && e.message;
  }

  res.status(200).json({
    ok: true,
    kind: kindName,
    targeted: (web.targeted || 0) + (fcm.targeted || 0),
    sent: (web.sent || 0) + (fcm.sent || 0),
    removed: (web.removed || 0) + (fcm.removed || 0),
    failed: (web.failed || 0) + (fcm.failed || 0),
    web: web,
    fcm: fcm
  });
};
