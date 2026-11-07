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
    const bucket = process.env.FIREBASE_STORAGE_BUCKET
      || (creds.project_id ? creds.project_id + '.firebasestorage.app' : undefined);
    admin.initializeApp({
      credential: admin.credential.cert(creds),
      ...(bucket ? { storageBucket: bucket } : {})
    });
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

/* Bir cihazın bildirim alıcıları: cihaz sahibi + bağlı olduğu evin tüm
   üyeleri. Eski (home_id'siz) kayıtlar yalnızca sahibine gider. */
async function deviceAudience(device) {
  const out = { owner: '', homeId: '', uids: [], homeName: '' };
  if (!device) return out;
  if (!admin.apps.length && !initAdmin()) return out;
  try {
    const snap = await admin.firestore().collection('device_bindings').doc(String(device)).get();
    if (!snap.exists) return out;
    const b = snap.data() || {};
    out.owner = String(b.owner_id || '');
    out.homeId = String(b.home_id || '');
    out.homeName = String(b.home_name || '');
    const set = new Set();
    if (out.owner) set.add(out.owner);
    if (out.homeId) {
      const ms = await admin.firestore().collection('home_members')
        .where('home_id', '==', out.homeId).get();
      ms.docs.forEach(function (d) {
        const m = d.data() || {};
        if (m.uid) set.add(String(m.uid));
      });
    }
    out.uids = Array.from(set);
  } catch (e) {
    console.warn('[lib] cihaz kitlesi okunamadı:', e && e.message);
  }
  return out;
}

async function queryByUids(col, opts) {
  if (Array.isArray(opts.uids)) {
    const docs = [];
    const seen = new Set();
    for (const uid of opts.uids) {
      try {
        const snap = await col.where('uid', '==', String(uid)).get();
        snap.docs.forEach(function (d) {
          if (seen.has(d.id)) return;
          seen.add(d.id);
          docs.push(d);
        });
      } catch (e) { /* tek uid hatası diğerlerini durdurmasın */ }
    }
    return docs;
  }
  const snap = opts.uid
    ? await col.where('uid', '==', String(opts.uid)).get()
    : await col.get();
  return snap.docs;
}

/* Tüm aboneliklere (veya tek bir uid / uid listesine) bildirim gönderir.
   404/410 dönen ölü abonelikler Firestore'dan temizlenir. */
async function sendToSubs(payload, opts) {
  opts = opts || {};
  const db = admin.firestore();
  const col = db.collection('push_subs');
  const docs = await queryByUids(col, opts);

  const body = (typeof payload === 'string') ? payload : JSON.stringify(payload);
  const options = { TTL: opts.ttl || 3600, urgency: opts.urgent ? 'high' : 'normal' };

  const results = await Promise.all(docs.map(async function (doc) {
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
    targeted: docs.length,
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

  let docs;
  try {
    docs = await queryByUids(col, opts);
  } catch (e) {
    return { targeted: 0, sent: 0, failed: 0, removed: 0, error: e && e.message };
  }

  /* Aynı token birden fazla kayıtta olabilir; tekilleştir. */
  const owners = new Map();
  docs.forEach(function (doc) {
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

/* Bir veya birden çok hesabın acil durum kişilerine e-posta gönderir.
   Ev modelinde alarm, cihaz sahibi + ev üyelerinin kişilerine gider. */
async function sendEmergencyEmails(uidOrUids, message) {
  message = message || {};
  const empty = { targeted: 0, sent: 0, failed: 0, skipped: true };
  const uids = Array.isArray(uidOrUids)
    ? uidOrUids.filter(Boolean).map(String)
    : (uidOrUids ? [String(uidOrUids)] : []);
  if (!uids.length) return empty;
  if (!admin.apps.length && !initAdmin()) {
    return Object.assign({}, empty, { error: 'servis hesabı yok' });
  }

  const contacts = [];
  const seen = new Set();
  try {
    for (const uid of uids) {
      const snap = await admin.firestore().collection('emergency_contacts')
        .where('uid', '==', uid)
        .limit(20)
        .get();
      snap.docs.forEach(function (doc) {
        const c = doc.data() || {};
        if (c.enabled === false) return;
        if (!c.email || String(c.email).indexOf('@') < 1) return;
        const key = String(c.email).toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        contacts.push(c);
      });
    }
  } catch (e) {
    return Object.assign({}, empty, { error: e && e.message });
  }

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

/* --------------------------------------------------------------------------
   BULUT OTA (firmware_releases + Firebase Storage)
   --------------------------------------------------------------------------
   `firmware_releases/{channel}` belgesi:
     { version, storage_path, sha256, size, notes, mandatory, published_at }

   İkili dosya Storage'da tutulur. Vercel'e doğrudan bin dosyası koymuyoruz;
   endpoint yalnızca kısa ömürlü imzalı indirme adresi üretir. Böylece firmware
   güncellemesi Vercel dağıtımını gerektirmez.
   -------------------------------------------------------------------------- */

function firebaseProjectId() {
  try {
    const app = admin.app();
    if (app && app.options && app.options.projectId) return app.options.projectId;
  } catch (e) { /* yoksay */ }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  try {
    const creds = JSON.parse(raw);
    return creds.project_id || '';
  } catch (e) { return ''; }
}

function storageBucketCandidates() {
  const list = [];
  const env = String(process.env.FIREBASE_STORAGE_BUCKET || '').trim();
  if (env) list.push(env);
  const project = firebaseProjectId();
  if (project) {
    list.push(project + '.firebasestorage.app');
    list.push(project + '.appspot.com');
  }
  return Array.from(new Set(list.filter(Boolean)));
}

async function findStorageFile(storagePath) {
  if (!storagePath) return null;
  const names = storageBucketCandidates();
  for (const name of names) {
    try {
      const bucket = admin.storage().bucket(name);
      const file = bucket.file(storagePath);
      const meta = await file.getMetadata();
      return { bucket: bucket, file: file, meta: (meta && meta[0]) || {} };
    } catch (e) {
      /* 404 veya izin: sıradaki olası kovayı dene. */
    }
  }
  return null;
}

function normalizeChannel(channel) {
  const c = String(channel || 'stable').trim().toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(c) ? c : 'stable';
}

async function firmwareManifest(channel, opts) {
  opts = opts || {};
  const ch = normalizeChannel(channel);
  if (!admin.apps.length && !initAdmin()) {
    return { ok: false, error: 'servis hesabı yok', channel: ch };
  }
  let snap;
  try {
    snap = await admin.firestore().collection('firmware_releases').doc(ch).get();
  } catch (e) {
    return { ok: false, error: e && e.message, channel: ch };
  }
  if (!snap.exists) {
    return { ok: false, notFound: true, channel: ch, error: 'bu kanal için yayın yok' };
  }
  const d = snap.data() || {};
  const version = String(d.version || '').trim();
  const sha256 = String(d.sha256 || '').trim().toLowerCase();
  const storagePath = String(d.storage_path || '').trim();
  if (!/^\d+\.\d+\.\d+([.-][0-9A-Za-z]+)?$/.test(version)) {
    return { ok: false, error: 'yayın sürümü geçersiz', channel: ch };
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    return { ok: false, error: 'yayın SHA-256 özeti geçersiz', channel: ch };
  }

  const out = {
    ok: true,
    channel: ch,
    version: version,
    latest: version,
    sha256: sha256,
    size: Number(d.size) || 0,
    notes: String(d.notes || '').slice(0, 500),
    mandatory: d.mandatory === true,
    min_version: String(d.min_version || ''),
    published_at: d.published_at || null,
    storage_path: storagePath
  };

  if (opts.signedUrl) {
    if (!storagePath) {
      return Object.assign({}, out, { ok: false, error: 'yayında storage_path yok' });
    }
    const found = await findStorageFile(storagePath);
    if (!found) {
      return Object.assign({}, out, { ok: false, error: 'firmware dosyası Storage\'da bulunamadı' });
    }
    try {
      const url = await found.file.getSignedUrl({
        action: 'read',
        expires: Date.now() + (opts.urlTtlMs || 15 * 60 * 1000)
      });
      out.url = url && url[0];
      out.size = Number(out.size) || Number(found.meta.size) || 0;
    } catch (e) {
      return Object.assign({}, out, { ok: false, error: 'imzalı indirme adresi üretilemedi: ' + (e && e.message) });
    }
  }
  return out;
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
  deviceAudience: deviceAudience,
  firmwareManifest: firmwareManifest,
  storageBucketCandidates: storageBucketCandidates,
  normalizeChannel: normalizeChannel,
  authorized: authorized
};
