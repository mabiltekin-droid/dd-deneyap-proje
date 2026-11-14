'use strict';

const EMSC_URL = 'https://www.seismicportal.eu/fdsnws/event/1/query';
const TIMEOUT_MS = 9000;
const MAX_HOURS = 72;
const MAX_LIMIT = 200;

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function numberParam(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeEvent(feature) {
  const props = feature?.properties;
  const coords = feature?.geometry?.coordinates;
  if (!props || feature.geometry?.type !== 'Point' || !Array.isArray(coords)) return null;

  const [lng, lat] = coords;
  const originMs = Date.parse(props.time);
  const mag = props.mag;
  const id = feature.id ?? props.unid;
  if (!id || !Number.isFinite(originMs) || !Number.isFinite(lat) ||
      !Number.isFinite(lng) || !Number.isFinite(mag)) return null;

  const updatedMs = Date.parse(props.lastupdate);
  return {
    id: 'emsc:' + id,
    time: new Date(originMs).toISOString(),
    origin_ms: originMs,
    latitude: round(lat, 5),
    longitude: round(lng, 5),
    depth_km: round(props.depth, 2),
    magnitude: round(mag, 1),
    type: String(props.magtype || '').toUpperCase(),
    location: String(props.flynn_region || 'Konum bilgisi yok'),
    country: '',
    province: '',
    district: '',
    updated: false,
    updated_at: Number.isFinite(updatedMs) ? new Date(updatedMs).toISOString() : null
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
  const start = new Date(now.getTime() - hours * 3600000);
  const url = new URL(EMSC_URL);
  url.search = new URLSearchParams({
    starttime: start.toISOString(),
    endtime: now.toISOString(),
    minlatitude: '35.5',
    maxlatitude: '42.5',
    minlongitude: '25.5',
    maxlongitude: '45',
    minmagnitude: String(minmag),
    orderby: 'time',
    limit: String(limit),
    catalog: 'EMSC-RTS',
    format: 'json',
    nodata: '204'
  });

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });

    if (!upstream.ok) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(502).json({
        ok: false,
        error: 'EMSC servisi yanıt vermedi',
        upstream_status: upstream.status
      });
      return;
    }

    let events = [];
    if (upstream.status !== 204) {
      const data = await upstream.json();
      if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
        throw new Error('EMSC yanıt biçimi geçersiz');
      }
      events = data.features.map(normalizeEvent).filter(Boolean)
        .sort((a, b) => b.origin_ms - a.origin_ms)
        .slice(0, limit);
    }

    res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=60');
    res.status(200).json({
      ok: true,
      source: 'EMSC',
      generated_at: new Date().toISOString(),
      window_hours: hours,
      min_magnitude: minmag,
      count: events.length,
      events
    });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    const aborted = err && err.name === 'AbortError';
    res.status(aborted ? 504 : 502).json({
      ok: false,
      error: aborted ? 'EMSC isteği zaman aşımına uğradı' : 'EMSC verisi alınamadı'
    });
  } finally {
    clearTimeout(timer);
  }
};
