/* ==========================================================================
   api/ota.js — ESP32 bulut firmware güncelleme manifesti
   --------------------------------------------------------------------------
   Cihaz belirli aralıklarla bu adrese gelir:

     GET /api/ota?device=DK-1A2B&current=3.4.0&channel=stable

   Yanıt (güncelleme varsa):
     {
       ok: true, update: true, channel: "stable",
       version: "3.5.0", size: 1234567,
       sha256: "64 karakter hex",
       url: "https://storage.googleapis.com/... imzalı, 15 dk geçerli",
       mandatory: false, notes: "..."
     }

   Güncelleme yoksa `update:false` döner ve indirme adresi ÜRETİLMEZ.
   Firmware; HTTPS + SHA-256 doğrulaması yapmadan yeni bölüme geçmez.

   Bu uç nokta herkese açıktır: yayınlanmış firmware gizli değildir. Yine de
   yalnızca Firestore'daki `firmware_releases/{channel}` belgesinde tanımlı
   dosya için kısa ömürlü imzalı adres üretilir. İstenmeyen yayın için belgeyi
   silmek yeterlidir.
   ========================================================================== */

'use strict';

const lib = require('./_lib');

function versionParts(v) {
  return String(v || '').trim().split(/[.\-+]/).map(function (x) {
    const n = parseInt(x, 10);
    return isNaN(n) ? 0 : n;
  });
}

/* -1: a < b, 0: eşit, 1: a > b */
function compareVersions(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  const n = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
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
  const channel = lib.normalizeChannel ? lib.normalizeChannel(q.channel) : 'stable';
  const current = String(q.current || '').trim().slice(0, 32);
  const device = String(q.device || '').trim().slice(0, 64);

  const manifest = await lib.firmwareManifest(channel, { signedUrl: false });
  if (!manifest || !manifest.ok) {
    const status = manifest && manifest.notFound ? 404 : 503;
    res.status(status).json({
      ok: false,
      error: (manifest && manifest.error) || 'yayın bilgisi okunamadı',
      channel: channel
    });
    return;
  }

  const cmp = current ? compareVersions(manifest.version, current) : 1;
  const update = cmp > 0;

  const out = {
    ok: true,
    update: update,
    channel: channel,
    version: manifest.version,
    latest: manifest.version,
    size: manifest.size,
    sha256: manifest.sha256,
    mandatory: update ? manifest.mandatory === true : false,
    min_version: manifest.min_version || '',
    notes: manifest.notes || '',
    published_at: manifest.published_at || null
  };

  if (!update) {
    out.reason = current ? 'already-current' : 'no-current-version';
    res.status(200).json(out);
    return;
  }

  /* URL'yi ancak gerçekten güncelleme varsa imzala (gereksiz imza üretmeyiz). */
  const signed = await lib.firmwareManifest(channel, { signedUrl: true });
  if (!signed || !signed.ok || !signed.url) {
    res.status(503).json({
      ok: false,
      error: (signed && signed.error) || 'firmware indirme adresi üretilemedi',
      channel: channel
    });
    return;
  }

  out.url = signed.url;
  out.size = signed.size || out.size;
  out.sha256 = signed.sha256 || out.sha256;
  out.device = device || undefined;

  res.status(200).json(out);
};
