/* ==========================================================================
   api/push.js — Vercel Serverless Function: Web Push gönderici
   --------------------------------------------------------------------------
   Panel KAPALIYKEN bildirim göndermek için kullanılır. Panel abonelikleri
   Firestore'da `push_subs` koleksiyonunda tutulur (bkz. pwa/js/notify.js).

   Tetikleyici: cihazın kendisi (MQTT firmware) alarm anında bu adrese kısa
   bir HTTPS isteği atar. Böylece panel kapalı olsa da bildirim gider.
   Alternatif olarak curl ile elle de tetiklenebilir.

   İstek:
     POST /api/push
     x-dd-secret: <PUSH_TRIGGER_SECRET>
     { "device": "DK-1744", "kind": "flame|gas|flood|vib|offline|test", "uid": "op-01" }
       - uid verilmezse TÜM abonelere gönderilir (alarm = herkes),
       - test için: { "kind": "test", "uid": "<kendi-uid>" }

   Yanıt: { ok, kind, targeted, sent, removed, failed }

   Gerekli ortam değişkenleri (Vercel > Settings > Environment Variables):
     FIREBASE_SERVICE_ACCOUNT : servis hesabı JSON'u (tek satır; admin SDK kuralları atlar)
     VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT : node tools/gen-vapid.js
     PUSH_TRIGGER_SECRET      : cihazın gönderdiği x-dd-secret ile AYNI
   ========================================================================== */

'use strict';

const admin = require('firebase-admin');
const webpush = require('web-push');

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

function initAdmin() {
  if (admin.apps.length) return true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return false;
  let cred;
  try {
    cred = JSON.parse(raw);
  } catch (e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT geçerli JSON değil: ' + e.message);
  }
  /* Vercel'e tek satır olarak girildiyse yeni satırlar "\\n" olarak gelir. */
  if (cred.private_key && cred.private_key.indexOf('\\n') !== -1) {
    cred.private_key = cred.private_key.replace(/\\n/g, '\n');
  }
  admin.initializeApp({
    credential: admin.credential.cert(cred),
    projectId: cred.project_id
  });
  return true;
}

function initVapid() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  return true;
}

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
    const out = { ok: true, configured: { vapid: false, firestore: false } };
    try { out.configured.vapid = initVapid(); } catch (e) { /* yoksay */ }
    try { out.configured.firestore = initAdmin(); } catch (e) { out.error = e.message; }
    out.ready = out.configured.vapid && out.configured.firestore;
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
  if (!initVapid()) {
    res.status(503).json({
      ok: false,
      error: 'VAPID anahtarları tanımlı değil (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)'
    });
    return;
  }
  if (!initAdmin()) {
    res.status(503).json({
      ok: false,
      error: 'FIREBASE_SERVICE_ACCOUNT tanımlı değil (abonelikler okunamıyor)'
    });
    return;
  }

  /* --- istek gövdesi ----------------------------------------------------- */
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const kindName = KIND[body.kind] ? body.kind : 'test';
  const k = KIND[kindName];
  const device = String(body.device || '').slice(0, 64);
  const payload = JSON.stringify({
    title: body.title || k.title,
    body: body.body || (device ? k.body + ' (Cihaz: ' + device + ')' : k.body),
    tag: k.tag,
    urgent: (body.urgent === undefined) ? k.urgent : !!body.urgent,
    kind: kindName,
    url: './'
  });

  /* --- abonelikleri oku -------------------------------------------------- */
  const db = admin.firestore();
  let snap;
  try {
    const col = db.collection('push_subs');
    snap = body.uid ? await col.where('uid', '==', String(body.uid)).get() : await col.get();
  } catch (e) {
    res.status(500).json({ ok: false, error: 'abonelikler okunamadı: ' + e.message });
    return;
  }

  /* --- gönder ------------------------------------------------------------ */
  const results = await Promise.all(snap.docs.map(async function (doc) {
    const s = doc.data() || {};
    if (!s.endpoint || !s.keys) return { ok: false, dead: true };
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: s.keys },
        payload,
        { TTL: 3600, urgency: k.urgent ? 'high' : 'normal' }
      );
      return { ok: true };
    } catch (e) {
      const code = (e && (e.statusCode || e.status)) || 0;
      /* 404/410 = abonelik ölmüş → temizle */
      if (code === 404 || code === 410) {
        try { await doc.ref.delete(); } catch (e2) { /* yoksay */ }
        return { ok: false, dead: true };
      }
      return { ok: false, code: code };
    }
  }));

  const sent = results.filter(function (r) { return r.ok; }).length;
  const removed = results.filter(function (r) { return r.dead; }).length;

  res.status(200).json({
    ok: true,
    kind: kindName,
    targeted: snap.size,
    sent: sent,
    removed: removed,
    failed: results.length - sent - removed
  });
};
