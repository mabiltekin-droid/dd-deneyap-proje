'use strict';

const admin = require('firebase-admin');
const { initAdmin } = require('./_lib');

module.exports = async function accountDeletion(req, res) {
  res.setHeader('Allow', 'POST');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false });
  }

  const header = String(req.headers.authorization || '');
  const token = /^Bearer (\S+)$/.exec(header)?.[1];
  if (!token) return res.status(401).json({ ok: false });
  if (!initAdmin()) return res.status(503).json({ ok: false });

  let user;
  try {
    user = await admin.auth().verifyIdToken(token, true);
  } catch (error) {
    const rejected = [
      'auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired',
      'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found'
    ];
    if (rejected.includes(error.code)) return res.status(401).json({ ok: false });
    console.error('[account-deletion] token verification failed:', error.code);
    return res.status(503).json({ ok: false });
  }

  if (!user.email || !user.email_verified) {
    return res.status(403).json({ ok: false });
  }

  // The ID comes from the verified session, never from the request body.
  // create() makes retries and concurrent requests safe without replacing an
  // existing request's original date or its processing status.
  try {
    await admin.firestore().collection('account_deletion_requests').doc(user.uid).create({
      email: user.email,
      requested_at: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    if (error.code !== 6 && error.code !== 'already-exists') {
      console.error('[account-deletion] request write failed:', error.code);
      return res.status(503).json({ ok: false });
    }
  }

  return res.status(202).json({ ok: true });
};
