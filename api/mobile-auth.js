'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');
const { initAdmin } = require('./_lib');

const COLLECTION = 'mobile_auth_codes';
const TTL_MS = 180 * 1000;
const MAX_BODY_BYTES = 16 * 1024;

const STATE_RE = /^[A-Za-z0-9_-]{16,80}$/;
const PKCE_RE = /^[A-Za-z0-9_-]{32,128}$/;
const CODE_RE = /^[A-Za-z0-9_-]{16,120}$/;

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function sha256Base64Url(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('base64url');
}

function readJsonBody(req) {
  if (req && req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
    try {
      return Promise.resolve(JSON.parse(String(req.body)));
    } catch (e) {
      return Promise.reject(new Error('invalid-json'));
    }
  }
  return new Promise(function (resolve, reject) {
    if (!req || typeof req.on !== 'function') return resolve({});
    let size = 0;
    const chunks = [];
    req.on('data', function (chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buf.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body-too-large'));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', function () {
      if (size > MAX_BODY_BYTES) return;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error('invalid-json')); }
    });
    req.on('error', function (err) { reject(err); });
  });
}

function bearerToken(req) {
  const header = String((req && req.headers && req.headers.authorization) || '');
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : '';
}

module.exports = async function mobileAuth(req, res) {
  res.setHeader('Allow', 'POST');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method-not-allowed' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    const code = e && e.message === 'body-too-large' ? 413 : 400;
    return res.status(code).json({ ok: false, error: e && e.message || 'invalid-body' });
  }

  if (!initAdmin()) {
    return res.status(503).json({ ok: false, error: 'service-unavailable' });
  }

  const db = admin.firestore();
  const col = db.collection(COLLECTION);
  const action = String((body && body.action) || '');
  const state = String((body && body.state) || '');

  if (!STATE_RE.test(state)) {
    return res.status(400).json({ ok: false, error: 'invalid-state' });
  }

  const docRef = col.doc(state);
  const now = Date.now();

  if (action === 'init') {
    const challenge = String((body && body.challenge) || '');
    if (!PKCE_RE.test(challenge)) {
      return res.status(400).json({ ok: false, error: 'invalid-challenge' });
    }
    try {
      await docRef.create({
        challenge: challenge,
        status: 'pending',
        createdAt: now,
        expiresAt: now + TTL_MS
      });
      return res.status(201).json({ ok: true, expiresIn: Math.floor(TTL_MS / 1000) });
    } catch (error) {
      if (error && (error.code === 6 || error.code === 'already-exists')) {
        return res.status(409).json({ ok: false, error: 'state-exists' });
      }
      console.error('[mobile-auth] init failed:', error && (error.code || error.message));
      return res.status(503).json({ ok: false, error: 'init-failed' });
    }
  }

  if (action === 'complete') {
    const idToken = bearerToken(req);
    if (!idToken) {
      return res.status(401).json({ ok: false, error: 'missing-token' });
    }
    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken, true);
    } catch (error) {
      const rejected = [
        'auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired',
        'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found'
      ];
      if (error && rejected.includes(error.code)) {
        return res.status(401).json({ ok: false, error: 'invalid-token' });
      }
      console.error('[mobile-auth] verifyIdToken failed:', error && error.code);
      return res.status(503).json({ ok: false, error: 'auth-check-failed' });
    }

    if (!decoded || !decoded.uid || !decoded.email) {
      return res.status(403).json({ ok: false, error: 'email-required' });
    }

    const code = crypto.randomBytes(24).toString('base64url');
    try {
      const outcome = await db.runTransaction(async function (tx) {
        const snap = await tx.get(docRef);
        if (!snap.exists) return { status: 404, body: { ok: false, error: 'not-found' } };
        const data = snap.data() || {};
        if (!data.expiresAt || Number(data.expiresAt) <= now) {
          tx.delete(docRef);
          return { status: 410, body: { ok: false, error: 'expired' } };
        }
        if (data.status !== 'pending') {
          return { status: 409, body: { ok: false, error: 'already-completed' } };
        }
        tx.update(docRef, {
          status: 'ready',
          uid: String(decoded.uid),
          email: String(decoded.email),
          code: code,
          completedAt: now
        });
        return { status: 200, body: { ok: true, code: code } };
      });
      return res.status(outcome.status).json(outcome.body);
    } catch (error) {
      console.error('[mobile-auth] complete failed:', error && (error.code || error.message));
      return res.status(503).json({ ok: false, error: 'complete-failed' });
    }
  }

  if (action === 'claim') {
    const verifier = String((body && body.verifier) || '');
    const code = body && body.code !== undefined && body.code !== null ? String(body.code) : '';
    if (!PKCE_RE.test(verifier)) {
      return res.status(400).json({ ok: false, error: 'invalid-verifier' });
    }
    if (code && !CODE_RE.test(code)) {
      return res.status(400).json({ ok: false, error: 'invalid-code' });
    }

    const expectedChallenge = sha256Base64Url(verifier);
    let outcome;
    try {
      outcome = await db.runTransaction(async function (tx) {
        const snap = await tx.get(docRef);
        if (!snap.exists) return { status: 404, body: { ok: false, error: 'not-found' } };
        const data = snap.data() || {};
        if (!safeEqual(expectedChallenge, data.challenge || '')) {
          return { status: 403, body: { ok: false, error: 'verifier-mismatch' } };
        }
        if (!data.expiresAt || Number(data.expiresAt) <= now) {
          tx.delete(docRef);
          return { status: 410, body: { ok: false, error: 'expired' } };
        }
        if (data.status === 'pending') {
          return { status: 200, body: { ok: true, pending: true } };
        }
        if (data.status !== 'ready' || !data.uid) {
          return { status: 409, body: { ok: false, error: 'invalid-state-status' } };
        }
        if (code && !safeEqual(code, data.code || '')) {
          return { status: 403, body: { ok: false, error: 'code-mismatch' } };
        }
        tx.delete(docRef);
        return { status: 200, uid: String(data.uid) };
      });
    } catch (error) {
      console.error('[mobile-auth] claim failed:', error && (error.code || error.message));
      return res.status(503).json({ ok: false, error: 'claim-failed' });
    }

    if (outcome.body) {
      return res.status(outcome.status).json(outcome.body);
    }

    try {
      const customToken = await admin.auth().createCustomToken(outcome.uid);
      return res.status(200).json({ ok: true, customToken: customToken });
    } catch (error) {
      console.error('[mobile-auth] createCustomToken failed:', error && (error.code || error.message));
      return res.status(503).json({ ok: false, error: 'custom-token-failed' });
    }
  }

  return res.status(400).json({ ok: false, error: 'unknown-action' });
};
