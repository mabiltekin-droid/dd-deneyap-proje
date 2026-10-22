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
  authorized: authorized
};
