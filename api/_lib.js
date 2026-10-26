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
  if (!admin.apps.length && !initAdmin()) {
    return { targeted: 0, sent: 0, failed: 0, removed: 0, error: 'servis hesabı yok' };
  }
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

/* --------------------------------------------------------------------------
   ACİL DURUM E-POSTALARI
   --------------------------------------------------------------------------
   `emergency_contacts` koleksiyonu: { uid, name, email, enabled }.
   Sağlayıcı olarak Resend veya Brevo kullanılabilir. Yalnızca sunucu tarafı
   anahtarları gerekir; istemci e-posta göndermez.

   Gerekli ortam değişkenleri:
     EMERGENCY_FROM   : "Deneyap Ev Koruma <alerts@alanadiniz.com>"
     RESEND_API_KEY   : Resend kullanılıyorsa
     BREVO_API_KEY    : Brevo kullanılıyorsa
   -------------------------------------------------------------------------- */

function emailConfig() {
  const from = String(process.env.EMERGENCY_FROM || process.env.EMAIL_FROM || '').trim();
  if (!from) return null;
  const resend = String(process.env.RESEND_API_KEY || '').trim();
  if (resend) return { provider: 'resend', key: resend, from: from };
  const brevo = String(process.env.BREVO_API_KEY || '').trim();
  if (brevo) return { provider: 'brevo', key: brevo, from: from };
  return null;
}

function parseFrom(value) {
  const raw = String(value || '').trim();
  const m = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) {
    return { name: m[1].replace(/^"|"$/g, '').trim(), email: m[2].trim() };
  }
  return { name: 'Deneyap Ev Koruma', email: raw };
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendEmail(to, subject, text, html) {
  const cfg = emailConfig();
  if (!cfg) {
    return { ok: false, skipped: true, error: 'e-posta servisi yapılandırılmadı' };
  }

  try {
    if (cfg.provider === 'resend') {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + cfg.key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: cfg.from,
          to: [to],
          subject: subject,
          text: text,
          html: html
        })
      });
      if (!res.ok) {
        const detail = await res.text().catch(function () { return ''; });
        return { ok: false, status: res.status, error: detail.slice(0, 300) };
      }
      return { ok: true, provider: 'resend' };
    }

    const sender = parseFrom(cfg.from);
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': cfg.key,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        sender: sender,
        to: [{ email: to }],
        subject: subject,
        textContent: text,
        htmlContent: html
      })
    });
    if (!res.ok) {
      const detail = await res.text().catch(function () { return ''; });
      return { ok: false, status: res.status, error: detail.slice(0, 300) };
    }
    return { ok: true, provider: 'brevo' };
  } catch (e) {
    return { ok: false, error: e && e.message };
  }
}

/* Bir hesabın acil durum kişilerine e-posta gönderir. */
async function sendEmergencyEmails(uid, message) {
  message = message || {};
  const empty = { targeted: 0, sent: 0, failed: 0, skipped: true };
  if (!uid) return empty;
  if (!admin.apps.length && !initAdmin()) {
    return Object.assign({}, empty, { error: 'servis hesabı yok' });
  }

  let snap;
  try {
    snap = await admin.firestore().collection('emergency_contacts')
      .where('uid', '==', String(uid))
      .limit(20)
      .get();
  } catch (e) {
    return Object.assign({}, empty, { error: e && e.message });
  }

  const contacts = [];
  snap.docs.forEach(function (doc) {
    const c = doc.data() || {};
    if (c.enabled === false) return;
    if (!c.email || String(c.email).indexOf('@') < 1) return;
    contacts.push(c);
  });

  if (!contacts.length) return empty;
  if (!emailConfig()) {
    return {
      targeted: contacts.length,
      sent: 0,
      failed: 0,
      skipped: true,
      error: 'EMERGENCY_FROM / API anahtarı tanımlı değil'
    };
  }

  const title = String(message.title || 'Deneyap Ev Koruma alarmı').slice(0, 160);
  const body = String(message.body || 'Ev güvenlik sisteminizden bir uyarı geldi.').slice(0, 1200);
  const device = String(message.device || '').slice(0, 64);
  const kind = String(message.kind || 'alarm').slice(0, 32);
  const when = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const panel = String(message.url || 'https://ddproje.vercel.app/');

  const text = [
    title,
    '',
    body,
    '',
    device ? 'Cihaz: ' + device : '',
    'Olay: ' + kind,
    'Zaman: ' + when,
    'Panel: ' + panel,
    '',
    'Bu e-posta, Deneyap Ev Koruma ayarlarında acil durum kişisi olarak eklendiğiniz için gönderildi.'
  ].filter(function (line) { return line !== ''; }).join('\n');

  const html =
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">' +
    '<div style="background:#0a0d14;color:#fff;padding:18px 20px;border-radius:10px 10px 0 0">' +
    '<div style="font-size:11px;letter-spacing:.12em;color:#94a3b8">DENEYAP EV KORUMA</div>' +
    '<h1 style="font-size:20px;margin:8px 0 0">' + escapeHtml(title) + '</h1></div>' +
    '<div style="border:1px solid #e2e8f0;border-top:0;padding:20px;border-radius:0 0 10px 10px">' +
    '<p style="font-size:14px;line-height:1.6;margin:0 0 16px">' + escapeHtml(body) + '</p>' +
    '<table style="font-size:13px;color:#475569;border-collapse:collapse">' +
    (device ? '<tr><td style="padding:2px 12px 2px 0">Cihaz</td><td style="padding:2px 0"><strong>' + escapeHtml(device) + '</strong></td></tr>' : '') +
    '<tr><td style="padding:2px 12px 2px 0">Olay</td><td style="padding:2px 0">' + escapeHtml(kind) + '</td></tr>' +
    '<tr><td style="padding:2px 12px 2px 0">Zaman</td><td style="padding:2px 0">' + escapeHtml(when) + '</td></tr>' +
    '</table>' +
    '<p style="margin:20px 0 0"><a href="' + escapeHtml(panel) + '" style="background:#0ea5e9;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600">Paneli aç</a></p>' +
    '<p style="font-size:11px;color:#94a3b8;margin:18px 0 0">Bu e-posta, Deneyap Ev Koruma ayarlarında acil durum kişisi olarak eklendiğiniz için gönderildi.</p>' +
    '</div></div>';

  let sent = 0;
  let failed = 0;
  let provider = '';
  for (let i = 0; i < contacts.length; i++) {
    const r = await sendEmail(contacts[i].email, '[Deneyap] ' + title, text, html);
    if (r.ok) {
      sent += 1;
      provider = r.provider || provider;
    } else {
      failed += 1;
    }
  }

  return {
    targeted: contacts.length,
    sent: sent,
    failed: failed,
    skipped: false,
    provider: provider
  };
}

/* Cihaz kimliğinden sahibini bulur (firmware body.uid göndermezse). */
async function deviceOwner(device) {
  if (!device) return '';
  if (!admin.apps.length && !initAdmin()) return '';
  try {
    const doc = await admin.firestore().collection('device_bindings')
      .doc(String(device)).get();
    return doc.exists ? String((doc.data() || {}).owner_id || '') : '';
  } catch (e) {
    return '';
  }
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
  sendEmail: sendEmail,
  sendEmergencyEmails: sendEmergencyEmails,
  emailReady: function () { return !!emailConfig(); },
  deviceOwner: deviceOwner,
  authorized: authorized
};
