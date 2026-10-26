/* ==========================================================================
   api/_lib.js — sunucusuz fonksiyonların ortak yardımcıları
   --------------------------------------------------------------------------
   Vercel, alt çizgi ile başlayan dosyaları UÇ NOKTA (endpoint) olarak
   yayınlamaz; yalnızca `require('./_lib')` ile içe aktarılır. Böylece push
   göndericisi ile haftalık özet aynı kodu paylaşır.

   Gerekli ortam değişkenleri (Vercel > Settings > Environment Variables):
     FIREBASE_SERVICE_ACCOUNT : servis hesabı JSON'u (tek satır)
     VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT : `npm run vapid`
     PUSH_TRIGGER_SECRET      : cihazın/curl'ün gönderdiği x-dd-secret
     CRON_SECRET              : Vercel Cron isteklerini doğrular (opsiyonel)
   ========================================================================== */

'use strict';

const admin = require('firebase-admin');
const webpush = require('web-push');

/* Servis hesabı tek satır JSON olarak saklanır; private_key içindeki \n
   kaçışları gerçek satır sonuna çevrilmelidir (yoksa imza hatası verir). */
function initAdmin() {
  if (admin.apps.length) return true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!raw) return false;
  try {
    const creds = JSON.parse(raw);
    if (creds.private_key) creds.private_key = String(creds.private_key).replace(/\\n/g, '\n');
    admin.initializeApp({ credential: admin.credential.cert(creds) });
    return true;
  } catch (e) {
    console.error('[lib] servis hesabı okunamadı:', e && e.message);
    return false;
  }
}

function initVapid() {
  const pub = process.env.VAPID_PUBLIC_KEY || '';
  const priv = process.env.VAPID_PRIVATE_KEY || '';
  if (!pub || !priv) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com', pub, priv
  );
  return true;
}

/* Tüm aboneliklere (veya tek bir uid'ye) bildirim gönderir.
   404/410 dönen ölü abonelikler Firestore'dan temizlenir. */
async function sendToSubs(payload, opts) {
  opts = opts || {};
  const db = admin.firestore();
  const col = db.collection('push_subs');
  const snap = opts.uid
    ? await col.where('uid', '==', String(opts.uid)).get()
    : await col.get();

  const body = (typeof payload === 'string') ? payload : JSON.stringify(payload);
  const options = { TTL: opts.ttl || 3600, urgency: opts.urgent ? 'high' : 'normal' };

  const results = await Promise.all(snap.docs.map(async function (doc) {
    const s = doc.data() || {};
    if (!s.endpoint || !s.keys) return { ok: false, dead: true };
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, options);
      return { ok: true };
    } catch (e) {
      const code = (e && (e.statusCode || e.status)) || 0;
      if (code === 404 || code === 410) {
        try { await doc.ref.delete(); } catch (e2) { /* yoksay */ }
        return { ok: false, dead: true };
      }
      return { ok: false, code: code };
    }
  }));

  const sent = results.filter(function (r) { return r.ok; }).length;
  const removed = results.filter(function (r) { return r.dead; }).length;
  return {
    targeted: snap.size,
    sent: sent,
    removed: removed,
    failed: results.length - sent - removed
  };
}

/* Android uygulamasının FCM token'larına bildirim gönderir.
   `push_tokens` koleksiyonu: { uid, token, platform, updated_at }.
   Data-only mesaj kullanılır; bildirimi uygulama kendisi çizer. */
async function sendFcm(payload, opts) {
  opts = opts || {};
  const db = admin.firestore();
  const col = db.collection('push_tokens');

  let snap;
  try {
    snap = opts.uid
      ? await col.where('uid', '==', String(opts.uid)).get()
      : await col.get();
  } catch (e) {
    return { targeted: 0, sent: 0, failed: 0, removed: 0, error: e && e.message };
  }

  /* Aynı token birden fazla kayıtta olabilir; tekilleştir. */
  const owners = new Map();
  snap.docs.forEach(function (doc) {
    const v = doc.data() || {};
    if (!v.token || owners.has(v.token)) return;
    owners.set(v.token, doc);
  });

  const data = {};
  Object.keys(payload || {}).forEach(function (k) {
    if (payload[k] !== undefined && payload[k] !== null) data[k] = String(payload[k]);
  });
  if (!data.kind) data.kind = 'test';
  if (!data.url) data.url = './';

  const tokens = Array.from(owners.keys());
  let sent = 0;
  let failed = 0;
  let removed = 0;

  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    let res;
    try {
      res = await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        data: data,
        android: {
          priority: opts.urgent ? 'high' : 'normal',
          ttl: (opts.ttl || 3600) * 1000
        }
      });
    } catch (e) {
      failed += chunk.length;
      continue;
    }

    res.responses.forEach(function (r, idx) {
      if (r.success) {
        sent += 1;
        return;
      }
      failed += 1;
      const code = (r.error && r.error.code) || '';
      if (code === 'messaging/registration-token-not-registered'
          || code === 'messaging/invalid-registration-token') {
        removed += 1;
        const doc = owners.get(chunk[idx]);
        if (doc) doc.ref.delete().catch(function () { /* yoksay */ });
      }
    });
  }

  return { targeted: tokens.length, sent: sent, removed: removed, failed: failed };
}

/* Zamanlanmış işler (Vercel Cron) ve elle tetikleme için tek yetki kapısı.
   CRON_SECRET tanımlıysa Vercel, cron isteğine "Authorization: Bearer ..."
   başlığını kendisi ekler. Elle denemek için x-dd-secret kullanılabilir. */
function authorized(req) {
  const cron = process.env.CRON_SECRET || '';
  const auth = String(req.headers.authorization || req.headers.Authorization || '');
  if (cron && auth === 'Bearer ' + cron) return true;

  const secret = process.env.PUSH_TRIGGER_SECRET || '';
  const given = req.headers['x-dd-secret'] || req.headers['X-Dd-Secret'] || '';
  return !!secret && given === secret;
}

module.exports = {
  initAdmin: initAdmin,
  initVapid: initVapid,
  sendToSubs: sendToSubs,
  sendFcm: sendFcm,
  authorized: authorized
};
