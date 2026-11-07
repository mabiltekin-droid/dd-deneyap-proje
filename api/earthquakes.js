/* ==========================================================================
   api/earthquakes.js — AFAD son deprem akışı için güvenli önbellekli röle
   --------------------------------------------------------------------------
   GET /api/earthquakes?hours=24&minmag=2.5&limit=100

   Neden röle?
     • deprem.afad.gov.tr tarayıcıdan CORS nedeniyle okunamayabilir.
     • Vercel kenar önbelleği sayesinde AFAD'a gereksiz yük binmez.
     • Yanıt alanları sadeleştirilir; ham servis yapısı istemciye taşınmaz.

   Bu uç nokta deprem TAHMİNİ üretmez. Yalnızca AFAD'ın yayımladığı
   kayıtları listeler. S dalgası varış hesabı istemcide, kullanıcı konumuyla
   ve yaklaşık 3,5 km/s hız varsayımıyla yapılır.
   ========================================================================== */

'use strict';

const AFAD_URL = 'https://deprem.afad.gov.tr/apiv2/event/filter';
const TIMEOUT_MS = 9000;
const MAX_HOURS = 72;
const MAX_LIMIT = 200;

function round(value, digits) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = Math.pow(10, digits);
  return Math.round(n * factor) / factor;
}

/* AFAD saatleri Türkiye saatidir (UTC+3) ve saat dilimi eki içermez.
   Sunucu hangi saat diliminde çalışırsa çalışsın doğru yorumlayalım. */
function parseAfadDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  return Date.parse(hasZone ? raw : raw + '+03:00');
}

/* Türkiye saatini açıkça +03:00 olarak biçimlendir. */
function trtIso(date) {
  const t = new Date(date.getTime() + 3 * 3600 * 1000);
  const p = function (n) { return String(n).padStart(2, '0'); };
  return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) +
    'T' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes()) + ':' +
    p(t.getUTCSeconds()) + '+03:00';
}

function numberParam(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const originMs = parseAfadDate(raw.date);
  const lat = Number(raw.latitude);
  const lng = Number(raw.longitude);
  const mag = Number(raw.magnitude);

  if (!Number.isFinite(originMs) || !Number.isFinite(lat) ||
      !Number.isFinite(lng) || !Number.isFinite(mag)) {
    return null;
  }

  return {
    id: String(raw.eventID || ''),
    time: new Date(originMs).toISOString(),
    origin_ms: originMs,
    latitude: round(lat, 5),
    longitude: round(lng, 5),
    depth_km: round(raw.depth, 2),
    magnitude: round(mag, 1),
    type: String(raw.type || ''),
    location: String(raw.location || 'Konum bilgisi yok'),
    country: raw.country ? String(raw.country) : '',
    province: raw.province ? String(raw.province) : '',
    district: raw.district ? String(raw.district) : '',
    updated: raw.isEventUpdate === true,
    updated_at: raw.lastUpdateDate ? String(raw.lastUpdateDate) : null
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET,OPTIONS');
    res.status(405).json({ ok: false, error: 'yalnızca GET destekleniyor' });
    return;
  }

  const q = req.query || {};
  const hours = Math.round(numberParam(q.hours, 24, 1, MAX_HOURS));
  const minmag = numberParam(q.minmag, 2.5, 0, 8);
  const limit = Math.round(numberParam(q.limit, 100, 1, MAX_LIMIT));

  const now = new Date();
  const start = new Date(now.getTime() - hours * 3600 * 1000);
  const upstreamUrl = AFAD_URL +
    '?start=' + encodeURIComponent(trtIso(start)) +
    '&end=' + encodeURIComponent(trtIso(now)) +
    '&minmag=' + encodeURIComponent(minmag.toFixed(1)) +
    '&limit=' + limit;

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DeneyapEvKoruma/2.23 (+https://ddproje.vercel.app)'
      }
    });

    if (!upstream.ok) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(502).json({
        ok: false,
        error: 'AFAD servisi yanıt vermedi',
        upstream_status: upstream.status
      });
      return;
    }

    const data = await upstream.json();
    const list = Array.isArray(data) ? data : (Array.isArray(data.events) ? data.events : []);
    const events = list.map(normalizeEvent).filter(Boolean)
      .sort(function (a, b) { return b.origin_ms - a.origin_ms; })
      .slice(0, limit);

    /* 30 saniyelik kenar önbelleği: canlıya yakın kalır, AFAD'ı korur. */
    res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=60');
    res.status(200).json({
      ok: true,
      source: 'AFAD',
      generated_at: new Date().toISOString(),
      window_hours: hours,
      min_magnitude: minmag,
      count: events.length,
      events: events
    });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    const aborted = err && err.name === 'AbortError';
    res.status(aborted ? 504 : 502).json({
      ok: false,
      error: aborted ? 'AFAD isteği zaman aşımına uğradı' : 'AFAD verisi alınamadı'
    });
  } finally {
    clearTimeout(timer);
  }
};
