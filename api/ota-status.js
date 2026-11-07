/* ==========================================================================
   api/ota-status.js — panel için yayın özeti (imzalı URL içermez)
   --------------------------------------------------------------------------
   GET /api/ota-status?channel=stable

   Ayarlar > Cihaz yazılımı kartı bu uç noktayı kullanır. Firmware'in aksine
   indirme adresi istemez; yalnızca yayındaki sürüm ve notları gösterir.
   ========================================================================== */

'use strict';

const lib = require('./_lib');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'yalnızca GET destekleniyor' });
    return;
  }

  const q = req.query || {};
  const channel = (q.channel || 'stable').toString().toLowerCase();
  const manifest = await lib.firmwareManifest(channel, { signedUrl: false });

  if (!manifest || !manifest.ok) {
    const status = manifest && manifest.notFound ? 404 : 503;
    res.status(status).json({
      ok: false,
      error: (manifest && manifest.error) || 'yayın bilgisi okunamadı',
      channel: (q.channel || 'stable').toString()
    });
    return;
  }

  res.status(200).json({
    ok: true,
    channel: manifest.channel,
    latest: manifest.version,
    version: manifest.version,
    size: manifest.size,
    sha256: manifest.sha256,
    notes: manifest.notes,
    mandatory: manifest.mandatory,
    min_version: manifest.min_version,
    published_at: manifest.published_at
  });
};
