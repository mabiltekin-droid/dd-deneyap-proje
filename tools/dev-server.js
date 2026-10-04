#!/usr/bin/env node
/* ==========================================================================
   dev-server.js — cihaz olmadan panel geliştirmek için sahte cihaz sunucusu.
   --------------------------------------------------------------------------
   Eski yol: `npx serve pwa` -> panel açılır ama /api/status çalışmaz, her kart
   "cihaz yok" der. Bu araç pwa/ klasörünü sunarKEN /api/status ve
   /api/control uçlarını da simüle eder; böylece arayüz, uyarılar ve grafik
   cihaz parçası olmadan denenebilir.

   Kullanım:
       npm run dev                 # http://localhost:3000
       node tools/dev-server.js --port 8080

   Bağımlılık yok — sadece Node'ın standart modülleri.
   ========================================================================== */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

/* --------------------------------------------------------------- ayarlar */

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg('port', process.env.PORT || 3000));
const HOST = arg('host', '127.0.0.1');
const ROOT = path.join(__dirname, '..', 'pwa');

/* Gerçek cihazın firmware/config.h'indeki sürümü kullan; yoksa panelin
   sürümünü yansıt ki "sürüm uyumsuzluğu" uyarısı yanlış çalışmasın. */
function readFwVersion() {
  const h = path.join(__dirname, '..', 'firmware', 'config.h');
  try {
    const m = fs.readFileSync(h, 'utf8').match(/#define\s+FW_VERSION\s+"([^"]+)"/);
    if (m) return m[1];
  } catch (e) { /* config.h yok — panel sürümüne düşer */ }
  try {
    const c = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');
    const m = c.match(/App\.VERSION\s*=\s*'([^']+)'/);
    if (m) return m[1];
  } catch (e) { /* yok sayılır */ }
  return '0.0.0';
}

/* Firmware'deki varsayılan eşiklerle aynı olmalı (config.h) */
function readThresholds() {
  const def = { warn: 250, danger: 400 };
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', 'firmware', 'config.h'), 'utf8');
    const w = src.match(/#define\s+GAS_WARN_PPM\s+(\d+)/);
    const d = src.match(/#define\s+GAS_DANGER_PPM\s+(\d+)/);
    if (w) def.warn = Number(w[1]);
    if (d) def.danger = Number(d[1]);
  } catch (e) { /* yok sayılır */ }
  return def;
}

const FW_VERSION = readFwVersion();
const TH = readThresholds();
const PPM_FS = 10000;

/* --------------------------------------------------------- sahte cihaz durumu */

const bootMs = Date.now() - 1000 * 60 * 47;   // 47 dakikadır açık gibi
let fan = false, pump = false, buzzer = false, auto = true;
let windowPos = 0, blindPos = 0, movingUntil = 0;
let gasBase = 118;                            // "temiz hava" tabanı
let lastTick = Date.now();
let gasState = 'normal';                      // histerezis için kalıcı durum

/* Kontrollü senaryo: gaz seviyesi yavaşça yükselir, eşikleri geçer, sonra düşer.
   Böylece uyarı/tehlike banner'ı, rozetler ve grafik gerçekten test edilir. */
function simulate() {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  const t = (now - bootMs) / 1000;            // cihaz açık olduğundan beri sn
  const phase = t / 90;                       // 90 sn'lik tur

  /* 0..1 arası gezinen bir dalga: yavaş yükseliş, hızlı düşüş */
  const wave = Math.pow(Math.max(0, Math.sin(phase * Math.PI * 2)), 3);

  const target = 70 + wave * (TH.danger * 2.1);
  gasBase = gasBase + (115 - gasBase) * 0.02 + (Math.random() - 0.5) * 0.6;

  const ppm = Math.max(0, Math.round(
    (target - 70) + gasBase + (Math.random() - 0.5) * 40
  ));

  const raw = Math.max(0, Math.min(1023,
    Math.round(ppm / PPM_FS * 1023 * 0.92 + gasBase * 0.4 + Math.random() * 12)
  ));

  const rainRaw = Math.random() < 0.12
    ? 1800 + Math.round(Math.random() * 1400)
    : Math.round(Math.random() * 700);
  const rain = rainRaw > 2000;

  /* Cihazdaki gibi histerezisli durum (GAS_HYSTERESIS = 60) */
  const HYST = 60;
  if (gasState === 'danger') {
    gasState = ppm < TH.danger - HYST ? 'warning' : 'danger';
  } else if (gasState === 'warning') {
    gasState = ppm >= TH.danger ? 'danger' : (ppm < TH.warn - HYST ? 'normal' : 'warning');
  } else {
    gasState = ppm >= TH.danger ? 'danger' : (ppm >= TH.warn ? 'warning' : 'normal');
  }
  const state = gasState;

  /* Otomatik müdahale: tehlikede fan açılır, su motoru kilitlenir */
  if (auto) {
    fan = state !== 'normal';
    pump = false;
  }

  const moving = now < movingUntil;
  return {
    ppm, raw, rain, rainRaw, state, moving,
    fan, pump, buzzer, auto, windowPos, blindPos,
    clients: 1,
    rssi: -58 + Math.round((Math.random() - 0.5) * 10),
    heap: 210000 + Math.round((Math.random() - 0.5) * 20000),
    fsUsed: 41230, fsTotal: 196608,
    tick: dt
  };
}

let sim = simulate();

function status() {
  return {
    ok: true,
    fw: FW_VERSION,
    t: Date.now(),
    rssi: sim.rssi,
    ip: '192.168.4.1',
    clients: sim.clients,
    heap: sim.heap,
    uptime: Date.now() - bootMs,
    gasRaw: sim.raw,
    gasPpm: sim.ppm,
    gasBase: Math.round(gasBase),
    rainRaw: sim.rainRaw,
    rain: sim.rain,
    state: sim.state,
    fan: fan, pump: pump, buzzer: buzzer, auto: auto,
    window: windowPos, blind: blindPos,
    moving: sim.moving,
    fs: true,
    fsUsed: sim.fsUsed,
    fsTotal: sim.fsTotal
  };
}

/* /api/control — firmware ile aynı sözleşme */
function control(device, action, value) {
  /* Servo: 800 ms "hareket ediyor", sonra hedef konuma oturur (SERVO_MOVE_MS) */
  const moveServo = function (which, target) {
    movingUntil = Date.now() + 800;
    setTimeout(function () {
      if (which === 'window') windowPos = target;
      else blindPos = target;
      sim.moving = Date.now() < movingUntil;
    }, 800);
  };

  if (device === 'auto') {
    auto = action === 'on' ? true : action === 'off' ? false : !auto;
    if (!auto) fan = false;
  } else if (device === 'fan') {
    fan = action === 'on' ? true : action === 'off' ? false : !fan;
  } else if (device === 'pump') {
    if (action === 'on') pump = true;
    else if (action === 'off') pump = false;
    else pump = !pump;
  } else if (device === 'buzzer') {
    buzzer = action === 'on' ? true : action === 'off' ? false : !buzzer;
  } else if (device === 'window') {
    if (action === 'open') moveServo('window', 180);
    else if (action === 'shut') moveServo('window', 0);
    else if (action === 'ajar') moveServo('window', 90);
    else if (action === 'stop') moveServo('window', windowPos);   // ayır
  } else if (device === 'blind') {
    if (action === 'open') moveServo('blind', 180);
    else if (action === 'shut') moveServo('blind', 0);
    else if (action === 'stop') moveServo('blind', blindPos);
  }

  sim.moving = Date.now() < movingUntil;
  return { ok: true };
}

/* ------------------------------------------------------------- HTTP katmanı */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  const file = path.join(ROOT, path.normalize(rel));
  /* dizin dışına çıkmaya çalışan istekleri reddet */
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('403');
    return;
  }

  fs.readFile(file, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 — bulunamadı: ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      /* Geliştirmede cache'i kapat: her kaydetmede taze dosya gelsin.
         Service Worker'ın "Yenile" bildirimi devrede çalışsın diye. */
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

const server = http.createServer(function (req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  const query = {};
  parsed.searchParams.forEach(function (v, k) { query[k] = v; });
  const p = parsed.pathname;

  /* Sahte ölçümleri ilerlet */
  sim = simulate();

  if (p === '/api/status' && req.method === 'GET') {
    sendJson(res, 200, status());
    return;
  }

  if (p === '/api/control' && req.method === 'POST') {
    let body = '';
    req.on('data', function (c) { body += c; if (body.length > 2048) req.destroy(); });
    req.on('end', function () {
      let v = {};
      try { v = JSON.parse(body || '{}'); } catch (e) { /* bozuk gövde */ }
      const src = Object.assign({}, query, v);
      control(src.device, src.action, src.value);
      sendJson(res, 200, status());
    });
    return;
  }

  if (p === '/api/control' && req.method === 'GET') {
    control(query.device, query.action, query.value);
    sendJson(res, 200, status());
    return;
  }

  if (p.indexOf('/api/') === 0) {
    sendJson(res, 404, { ok: false, error: 'bilinmeyen uç: ' + p });
    return;
  }

  serveStatic(req, res, p);
});

/* Port doluysa yığın iziyle değil, anlaşılır bir mesajla çık */
server.on('error', function (err) {
  if (err.code === 'EADDRINUSE') {
    console.error('\n  Hata: ' + HOST + ':' + PORT + ' zaten kullanımda.');
    console.error('  Başka port dene:  node tools/dev-server.js --port 5173\n');
  } else {
    console.error('\n  Hata: ' + err.message + '\n');
  }
  process.exit(1);
});

/* Cihaz 800 ms'de bir ölçüm alır; simülasyon da aynı ritimde ilerlesin */
setInterval(function () { sim = simulate(); }, 200);

server.listen(PORT, HOST, function () {
  const s = FW_VERSION;
  console.log('');
  console.log('  Deneyap Ev Koruma — sahte cihaz sunucusu');
  console.log('  ---------------------------------------------');
  console.log('  Panel     : http://' + HOST + ':' + PORT);
  console.log('  Kaynak    : ' + ROOT);
  console.log('  Firmware  : v' + s + ' (config.h\'den okundu)');
  console.log('  Esikler   : uyari ' + TH.warn + ' ppm / tehlike ' + TH.danger + ' ppm');
  console.log('');
  console.log('  Bu bir SAHTE cihazdir. Gerçek donanim yok, veriler uretilir.');
  console.log('  Durdurmak icin Ctrl+C');
  console.log('');
});