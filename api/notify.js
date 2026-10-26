/* ==========================================================================
   api/notify.js — Oturum sahibine test/deneme bildirimi
   --------------------------------------------------------------------------
   Android uygulamasındaki "Test bildirimi" düğmesi buraya gelir. İstek,
   Firebase ID token'ı ile doğrulanır; kullanıcı yalnızca KENDİ cihazlarına
   bildirim gönderebilir.

   İstek:
     POST /api/notify
     Authorization: Bearer <Firebase ID token>
     { "test": true }                       → standart test bildirimi
     { "title": "...", "body": "..." }      → özel metin (opsiyonel)

   Yanıt: { ok, targeted, sent, failed, removed }
   ========================================================================== */

'use strict';

const lib = require('./_lib');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'yöntem desteklenmiyor' });
    return;
  }

  if (!lib.initAdmin()) {
    res.status(503).json({
      ok: false,
      error: 'Sunucu yapılandırılmamış (FIREBASE_SERVICE_ACCOUNT eksik).'
    });
    return;
  }

  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ ok: false, error: 'oturum token\'ı gerekli' });
    return;
  }

  let decoded;
  try {
    decoded = await require('firebase-admin').auth().verifyIdToken(token);
  } catch (e) {
    res.status(401).json({ ok: false, error: 'geçersiz veya süresi geçmiş oturum' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const panelUrl = 'https://' + (req.headers.host || 'ddproje.vercel.app') + '/';

  /* Acil durum e-posta testi: FCM göndermez, yalnızca kayıtlı kişilere yazar. */
  if (body.emailTest === true) {
    let email;
    try {
      email = await lib.sendEmergencyEmails(decoded.uid, {
        title: String(body.title || 'Test e-postası').slice(0, 120),
        body: String(body.body
          || 'Acil durum e-posta bildirimi çalışıyor. Gerçek alarmda bu adrese benzer bir e-posta gelecek.')
          .slice(0, 400),
        device: '',
        kind: 'test',
        url: panelUrl
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'e-posta gönderilemedi: ' + (e && e.message) });
      return;
    }

    if (!email.targeted) {
      res.status(409).json({
        ok: false,
        error: 'Kayıtlı acil durum e-postası yok. Önce bir kişi ekleyin.',
        email: email
      });
      return;
    }
    if (email.skipped) {
      res.status(503).json({
        ok: false,
        error: email.error || 'Sunucuda e-posta servisi yapılandırılmadı.',
        email: email
      });
      return;
    }

    res.status(200).json({ ok: true, email: email });
    return;
  }

  const title = String(body.title || 'Test bildirimi').slice(0, 120);
  const text = String(body.body
    || 'Bildirimler çalışıyor. Alarm anında uygulama kapalı olsa bile bu bildirimi alacaksınız.')
    .slice(0, 400);
  const kind = String(body.kind || 'test').slice(0, 24);

  let result;
  try {
    result = await lib.sendFcm({
      kind: kind,
      title: title,
      body: text,
      url: body.url || './'
    }, {
      uid: decoded.uid,
      ttl: 600,
      urgent: true
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'gönderilemedi: ' + (e && e.message) });
    return;
  }

  if (!result.targeted) {
    res.status(409).json({
      ok: false,
      error: 'Bu hesap için kayıtlı uygulama token\'ı yok. Bildirimleri açıp tekrar deneyin.',
      targeted: 0
    });
    return;
  }

  res.status(200).json({
    ok: true,
    targeted: result.targeted,
    sent: result.sent,
    failed: result.failed,
    removed: result.removed
  });
};
