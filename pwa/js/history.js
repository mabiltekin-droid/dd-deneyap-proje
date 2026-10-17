/* ==========================================================================
   history.js — Geçmiş & Grafikler

   İki kaynak birleştirilir:

   1) KART (asıl kaynak): firmware'in RAM halka tamponu, açılıştan itibaren
      24 saatlik örnek tutar (60 sn aralıkla).  HTTP /api/history  veya
      MQTT <T>/histreq → <T>/hist ile alınır. Kayıt `t` alanı AÇILIŞTAN
      İTİBAREN SANİYEDİR; gerçek saate çevirmek için durumdaki `uptime`
      (ms) gerekir:  duvar = simdi - (uptimeSn - t) * 1000

   2) YEREL ÖNBELLEK: panel açıkken status itmelerinden dakikada bir örnek
      localStorage'a yazılır. Kart yeniden başladığında halka boşaldığı için
      bu önbellek son saatleri tamamlar.

   Kart hiç yanıt VEREMİYORSA (fişte değil) grafik yine de yerel önbellekle
   çizilir; "kaynak" satırı hangisinin kullanıldığını söyler.
   ========================================================================== */

(function () {
  'use strict';

  const App = window.App;
  const $ = function (id) { return document.getElementById(id); };

  const LOCAL_KEY = 'deneyap.history.v1';
  const LOCAL_MAX = 6000;      /* en fazla bu kadar yerel örnek saklanır */
  const LOCAL_STEP = 60000;    /* yerel örnek aralığı (ms) */
  const STEP_SEC = 60;         /* kartın örnek aralığı (sn) */

  let spanMin = 1440;          /* seçili aralık (dakika) */
  let busy = false;
  let lastUptimeSec = null;    /* son durumdan okunan cihaz ömrü (sn) */

  /* ---------------------------------------------------- yerel önbellek --- */

  function readLocal() {
    try {
      const a = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }

  function writeLocal(arr) {
    try {
      if (arr.length > LOCAL_MAX) arr = arr.slice(arr.length - LOCAL_MAX);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(arr));
    } catch (e) { /* kota dolu — sessiz geç */ }
  }

  /* Her status itmesinde çağrılır; dakikada bir yazar. */
  function noteSample(s) {
    if (!s || typeof s.gasPpm !== 'number') return;
    if (typeof s.uptime === 'number') lastUptimeSec = s.uptime / 1000;

    const now = Date.now();
    const arr = readLocal();
    const last = arr[arr.length - 1];
    if (last && now - last.e < LOCAL_STEP) return;

    let state = 0;
    if (s.state === 'danger') state = 2;
    else if (s.state === 'warning') state = 1;
    if (s.gasFault && state === 0) state = 3;
    if (s.vib && state === 0) state = 2;   /* sarsıntı/kurcalama da tehlike bandı */

    let flags = 0;
    if (s.fan) flags |= 1;
    if (s.pump) flags |= 2;
    if (s.buzzer) flags |= 4;
    if (Number(s.window) > 150) flags |= 8;
    if (Number(s.blind) > 30) flags |= 16;
    if (s.flood) flags |= 32;
    if (s.auto) flags |= 64;
    if (s.vib) flags |= 128;   /* firmware historyPush ile aynı bit */
    if (s.flame) flags |= 256; /* alev alarmı */

    arr.push({
      e: now,
      p: Math.max(0, Math.round(Number(s.gasPpm) || 0)),
      r: Math.max(0, Math.min(100, Math.round(Number(s.rainPct) || 0))),
      s: state, f: flags
    });
    writeLocal(arr);
  }

  /* ------------------------------------------------------ kart verisi ---- */

  async function fetchDevice() {
    /* span dk, 60 sn'lik ham örnek demek: 1440 dk = 1440 ham örnek = 24 saat */
    const lastRaw = Math.min(1440, Math.max(1, spanMin));
    const n = Math.min(140, lastRaw);
    return App.api.history({ n: n, last: lastRaw });
  }

  /* Kart kayıtlarını gerçek saate çevirir. */
  function devicePoints(h, uptimeSec) {
    if (!h || !Array.isArray(h.recs)) return [];
    const now = Date.now();
    const out = [];
    for (let i = 0; i < h.recs.length; i++) {
      const r = h.recs[i];
      if (!Array.isArray(r) || r.length < 5) continue;
      const t = Number(r[0]);
      let epoch;
      if (uptimeSec != null && uptimeSec >= t) epoch = now - (uptimeSec - t) * 1000;
      else epoch = now - (h.recs.length - 1 - i) * STEP_SEC * 1000; /* göreli */
      out.push({ e: epoch, p: Number(r[1]), r: Number(r[2]), s: Number(r[3]), f: Number(r[4]) });
    }
    return out;
  }

  /* Kart + yerel örnekleri tek zaman ekseni üzerinde birleştirir. */
  function merge(dev, local, from) {
    const seen = [];
    const all = dev.concat(local).filter(function (p) {
      if (!p || p.e < from) return false;
      /* 45 sn içindeki tekrarları ele (kaynak farkı yüzünden aynı an) */
      for (let i = seen.length - 1; i >= 0 && i > seen.length - 6; i--) {
        if (Math.abs(seen[i] - p.e) < 45000) return false;
      }
      seen.push(p.e);
      return true;
    });
    all.sort(function (a, b) { return a.e - b.e; });
    return all;
  }

  /* --------------------------------------------------------- çizim ------- */

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  function fmtClock(ms) {
    try {
      return new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  let activeScrubberPoint = null;

  function draw(pts, activePt) {
    const cv = $('histCanvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(240, cv.clientWidth || (cv.parentNode && cv.parentNode.clientWidth) || 320);
    const h = cv.clientHeight || 240;

    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padL = 46, padR = 34, padT = 12, padB = 24;
    const iw = w - padL - padR, ih = h - padT - padB;

    const cText = cssVar('--text-muted', '#8b93a7');
    /* --border-subtle %4 opaklıktadır; ızgara için fazla soluk kalır. */
    const cGrid = hexA(cText, 0.17);
    const cGas = cssVar('--primary', '#38bdf8');
    const cRain = cssVar('--accent', '#a78bfa');
    const cDanger = cssVar('--danger', '#f87171');
    const cWarn = cssVar('--warn', '#fbbf24');

    ctx.font = '10px ' + (cssVar('--font-mono', 'monospace') || 'monospace');
    ctx.textBaseline = 'middle';

    if (!pts.length) return;

    const t0 = pts[0].e, t1 = pts[pts.length - 1].e;
    const span = Math.max(1, t1 - t0);

    /* Y eksenleri: gaz (sol) 0..max, yağmur (sağ) 0..100 */
    let maxP = 100;
    for (let i = 0; i < pts.length; i++) if (pts[i].p > maxP) maxP = pts[i].p;
    maxP = Math.ceil(maxP / 50) * 50;          /* yuvarla */

    const X = function (e) { return padL + ((e - t0) / span) * iw; };
    const Yg = function (p) { return padT + ih - (p / maxP) * ih; };
    const Yr = function (r) { return padT + ih - (r / 100) * ih; };

    /* --- alarm / arıza bantları -------------------------------------- */
    for (let i = 1; i < pts.length; i++) {
      const st = pts[i].s;
      if (st < 2 && st !== 3) continue;
      const xa = X(pts[i - 1].e), xb = X(pts[i].e);
      ctx.fillStyle = (st === 3)
        ? hexA(cWarn, 0.16)
        : hexA(cDanger, 0.20);
      ctx.fillRect(xa, padT, Math.max(2, xb - xa), ih);
    }

    /* --- ızgara ------------------------------------------------------- */
    ctx.strokeStyle = cGrid;
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = padT + (ih * g) / 4;
      ctx.beginPath(); ctx.moveTo(padL, y + 0.5); ctx.lineTo(padL + iw, y + 0.5); ctx.stroke();
      /* sol etiket: ppm */
      ctx.fillStyle = cText; ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(maxP * (1 - g / 4))), padL - 6, y);
      /* sağ etiket: % */
      ctx.textAlign = 'left';
      ctx.fillText('%' + Math.round(100 * (1 - g / 4)), padL + iw + 6, y);
    }

    /* --- yağmur dolgu -------------------------------------------------- */
    ctx.beginPath();
    ctx.moveTo(X(pts[0].e), padT + ih);
    for (let i = 0; i < pts.length; i++) ctx.lineTo(X(pts[i].e), Yr(pts[i].r));
    ctx.lineTo(X(pts[pts.length - 1].e), padT + ih);
    ctx.closePath();
    ctx.fillStyle = hexA(cRain, 0.18);
    ctx.fill();
    ctx.strokeStyle = hexA(cRain, 0.85);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = X(pts[i].e), y = Yr(pts[i].r);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    /* --- gaz çizgisi ----------------------------------------------------
       strokeStyle DÖNGÜDEN ÖNCE belirlenmeli: döngü içindeki stroke()
       çağrıları o anki rengi kullanır. Sensör arızalıysa çizgi ORADA
       kesilir (0'a düşüp "temiz hava" sanılmasın); boşluk zaten üstteki
       amber bantla gösteriliyor. */
    ctx.strokeStyle = cGas;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    let pen = false;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].s === 3) { if (pen) { ctx.stroke(); pen = false; } continue; }
      const x = X(pts[i].e), y = Yg(pts[i].p);
      if (!pen) { ctx.beginPath(); ctx.moveTo(x, y); pen = true; }
      else ctx.lineTo(x, y);
    }
    if (pen) ctx.stroke();

    /* tehlike eşiği çizgisi */
    const warnT = (App.settings() && App.settings().gasWarn) || 250;
    const danT = (App.settings() && App.settings().gasDanger) || 400;
    if (danT <= maxP) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = hexA(cDanger, 0.75);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, Yg(danT)); ctx.lineTo(padL + iw, Yg(danT)); ctx.stroke();
    }
    if (warnT <= maxP) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = hexA(cWarn, 0.6);
      ctx.beginPath(); ctx.moveTo(padL, Yg(warnT)); ctx.lineTo(padL + iw, Yg(warnT)); ctx.stroke();
    }
    ctx.setLineDash([]);

    /* --- x ekseni saati ------------------------------------------------ */
    ctx.fillStyle = cText;
    ctx.textAlign = 'center';
    const ticks = Math.max(2, Math.min(6, Math.floor(iw / 78)));
    for (let k = 0; k <= ticks; k++) {
      const e = t0 + (span * k) / ticks;
      ctx.fillText(fmtClock(e), padL + (iw * k) / ticks, padT + ih + 12);
    }

    /* --- Dokunmatik Parmak Gezintisi / Scrubber Overlay (Crosshair & HUD) --- */
    if (activePt) {
      const x = Math.max(padL, Math.min(padL + iw, X(activePt.e)));
      const yg = Math.max(padT, Math.min(padT + ih, Yg(activePt.p)));
      const yr = Math.max(padT, Math.min(padT + ih, Yr(activePt.r)));

      ctx.save();

      // 1. Düşey kılcal çizgi (crosshair line)
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
      ctx.lineWidth = 1.2;
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + ih);
      ctx.stroke();

      // 2. Eğriler üzerindeki vurgu noktaları
      // Yağmur noktası
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, yr, 4, 0, Math.PI * 2);
      ctx.fillStyle = cRain;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Gaz noktası
      ctx.beginPath();
      ctx.arc(x, yg, 5.5, 0, Math.PI * 2);
      const ptColor = (activePt.s === 2) ? cDanger : (activePt.s === 1 ? cWarn : cGas);
      ctx.fillStyle = ptColor;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 3. HUD Bilgi Kartı (Tooltip Box)
      const timeStr = fmtClock(activePt.e);
      const dateStr = new Date(activePt.e).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
      const gasStr = 'Gaz: ' + activePt.p + ' PPM';
      const rainStr = 'Yağmur: %' + activePt.r + (activePt.r > 20 ? ' (Islak)' : ' (Kuru)');
      const stateStr = activePt.s === 2 ? 'TEHLİKE' : (activePt.s === 1 ? 'UYARI' : (activePt.s === 3 ? 'ARIZA' : 'GÜVENDE'));

      const boxW = 144;
      const boxH = 68;
      // Dokunulan nokta sağ yarıdaysa sola, sol yarıdaysa sağa yerleştir
      let boxX = (x > padL + iw / 2) ? (x - boxW - 14) : (x + 14);
      let boxY = Math.max(padT + 4, Math.min(padT + ih - boxH - 4, yg - boxH / 2));

      ctx.fillStyle = 'rgba(10, 15, 26, 0.94)';
      ctx.strokeStyle = hexA(ptColor, 0.65);
      ctx.lineWidth = 1.2;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 8);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeRect(boxX, boxY, boxW, boxH);
      }

      // HUD Metinleri
      ctx.font = 'bold 10px ' + (cssVar('--font-mono', 'monospace') || 'monospace');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      // Başlık: Tarih & Saat
      ctx.fillStyle = cText;
      ctx.fillText(dateStr + ' ' + timeStr, boxX + 8, boxY + 7);

      // Durum rozeti metni sağ üst
      ctx.textAlign = 'right';
      ctx.fillStyle = ptColor;
      ctx.fillText(stateStr, boxX + boxW - 8, boxY + 7);

      // Değer satırları
      ctx.textAlign = 'left';
      ctx.fillStyle = ptColor;
      ctx.fillText('• ' + gasStr, boxX + 8, boxY + 26);

      ctx.fillStyle = cRain;
      ctx.fillText('• ' + rainStr, boxX + 8, boxY + 44);

      ctx.restore();
    }
  }

  function hexA(c, a) {
    if (!c) return c;
    c = String(c).trim();
    if (c.charAt(0) === '#') {
      const n = parseInt(c.slice(1), 16);
      if (isNaN(n)) return c;
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }
    const rgba = c.match(/^rgba?\(([^)]+)\)$/i);
    if (rgba) {
      const parts = rgba[1].split(',').map(function (x) { return x.trim(); });
      const r = Number(parts[0]) || 0, g = Number(parts[1]) || 0, b = Number(parts[2]) || 0;
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }
    return c;
  }

  /* ------------------------------------------------------- metrikler ----- */

  function paintMetrics(pts, span, source) {
    /* Kart, 24 saati 140 noktaya sıkıştırır; bu yüzden noktalar arası süre
       sabit 60 sn DEĞİLDİR. Gerçek aralık kullanılırsa alarm süresi
       yaklaşık doğru çıkar. */
    let stepMs = STEP_SEC * 1000;
    if (pts.length > 1) {
      const s = (pts[pts.length - 1].e - pts[0].e) / (pts.length - 1);
      if (s > 0) stepMs = s;
    }
    let maxP = 0, maxR = 0, alarmMs = 0, fault = false;

    for (let i = 0; i < pts.length; i++) {
      if (pts[i].p > maxP) maxP = pts[i].p;
      if (pts[i].r > maxR) maxR = pts[i].r;
      if (pts[i].s === 2) alarmMs += stepMs;
      if (pts[i].s === 3) fault = true;
    }

    $('histMaxPpm').textContent = pts.length ? (maxP + ' ppm') : '—';
    $('histMaxRain').textContent = pts.length ? ('%' + maxR) : '—';
    $('histAlarmTime').textContent = alarmMs
      ? (alarmMs >= 3600000
          ? (Math.round(alarmMs / 3600000) + ' sa')
          : (Math.max(1, Math.round(alarmMs / 60000)) + ' dk'))
      : 'yok';
    $('histCount').textContent = pts.length || '—';

    const chip = $('histChip');
    if (chip) {
      if (!pts.length) { chip.dataset.state = 'unknown'; chip.textContent = 'VERİ YOK'; }
      else if (fault) { chip.dataset.state = 'warning'; chip.textContent = 'ARIZA VAR'; }
      else if (alarmMs) { chip.dataset.state = 'danger'; chip.textContent = 'ALARM'; }
      else { chip.dataset.state = 'normal'; chip.textContent = 'NORMAL'; }
    }

    $('histRange').textContent = pts.length
      ? ('aralık: ' + (span >= 1440 ? '24 saat' : Math.round(span / 60) + ' saat') +
         ' · ' + pts.length + ' nokta')
      : 'aralık: —';

    $('histSource').textContent = 'kaynak: ' + source;

    $('histEmpty').hidden = pts.length > 0;
  }

  /* --------------------------------------------------------- yükle ------- */

  async function load(force) {
    if (busy) return;
    busy = true;
    const chip = $('histChip');
    if (chip && force) { chip.dataset.state = 'unknown'; chip.textContent = 'ÇEKİLİYOR'; }

    const now = Date.now();
    const from = now - spanMin * 60000;

    let devPts = [], src = '';
    try {
      const st = await App.api.status();
      if (st && typeof st.uptime === 'number') lastUptimeSec = st.uptime / 1000;
    } catch (e) { /* durum yok — göreli zamanla devam */ }

    try {
      const h = await fetchDevice();
      devPts = devicePoints(h, lastUptimeSec);
      src = App.api.transport() ? 'kart (MQTT)' : 'kart (HTTP)';
    } catch (e) {
      devPts = [];
    }

    const local = readLocal().filter(function (p) { return p.e >= from; })
      .map(function (p) { return { e: p.e, p: p.p, r: p.r, s: p.s, f: p.f }; });

    let pts = merge(devPts, local, from);
    if (!devPts.length && local.length) src = 'yerel önbellek (kart çevrimdışı)';
    else if (devPts.length && local.length) src += ' + yerel önbellek';
    else if (!devPts.length && !local.length) src = 'kaynak yok';

    lastPts = pts;
    paintMetrics(pts, spanMin * 60000, src);
    draw(pts, activeScrubberPoint);
    busy = false;
  }

  let lastPts = [];
  let eventsBound = false;

  /* ---------------------- Dokunmatik Parmak Gezintisi (Touch Scrubber) --- */

  function findNearestPoint(clientX) {
    if (!lastPts || !lastPts.length) return null;
    const cv = $('histCanvas');
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    const xInCanvas = clientX - rect.left;
    const padL = 46, padR = 34;
    const iw = rect.width - padL - padR;
    if (iw <= 0) return null;

    const t0 = lastPts[0].e, t1 = lastPts[lastPts.length - 1].e;
    const span = Math.max(1, t1 - t0);
    const clampedX = Math.max(padL, Math.min(padL + iw, xInCanvas));
    const targetEpoch = t0 + ((clampedX - padL) / iw) * span;

    let closest = lastPts[0];
    let minDiff = Math.abs(closest.e - targetEpoch);
    for (let i = 1; i < lastPts.length; i++) {
      const diff = Math.abs(lastPts[i].e - targetEpoch);
      if (diff < minDiff) {
        minDiff = diff;
        closest = lastPts[i];
      }
    }
    return closest;
  }

  function setupTouchScrubber() {
    const cv = $('histCanvas');
    if (!cv || cv._scrubberBound) return;
    cv._scrubberBound = true;
    cv.style.touchAction = 'pan-y';

    function onPointerMove(e) {
      if (!lastPts || !lastPts.length) return;
      activeScrubberPoint = findNearestPoint(e.clientX);
      if (activeScrubberPoint) {
        draw(lastPts, activeScrubberPoint);
      }
    }

    function onPointerEnd() {
      if (activeScrubberPoint !== null) {
        activeScrubberPoint = null;
        if (lastPts && lastPts.length) {
          draw(lastPts, null);
        }
      }
    }

    cv.addEventListener('pointerdown', function (e) {
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      onPointerMove(e);
    }, { passive: true });

    cv.addEventListener('pointermove', function (e) {
      if (e.buttons > 0 || e.pointerType === 'mouse' || e.pointerType === 'pen' || activeScrubberPoint !== null) {
        onPointerMove(e);
      }
    }, { passive: true });

    cv.addEventListener('pointerup', function (e) {
      try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
      onPointerEnd();
    }, { passive: true });

    cv.addEventListener('pointercancel', onPointerEnd, { passive: true });
    cv.addEventListener('pointerleave', onPointerEnd, { passive: true });
  }

  /* ----------------------------------------------------------- init ------ */

  function init() {
    if (!$('historyCard')) return;

    setupTouchScrubber();

    const rangeBtns = document.querySelectorAll('.hist-range [data-span]');
    rangeBtns.forEach(function (b) {
      if (b._histBound) return;
      b._histBound = true;
      b.addEventListener('click', function () {
        spanMin = Number(b.getAttribute('data-span')) || 1440;
        rangeBtns.forEach(function (o) { o.classList.remove('primary'); });
        b.classList.add('primary');
        load(true);
      });
    });

    const rb = $('histRefreshBtn');
    if (rb && !rb._histBound) {
      rb._histBound = true;
      rb.addEventListener('click', function () { load(true); });
    }

    if (!eventsBound) {
      eventsBound = true;
      /* Cihazdan gelen her durum örneğe dönüşsün (yerel önbellek). */
      if (App.api && typeof App.api.onStatus === 'function') {
        App.api.onStatus(function (s) { if (s && s.ok) noteSample(s); });
      }

      /* Sekme görünür olunca grafiği tazele; ayrıca ilk çizim için. */
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && $('historyCard')) load(false);
      });

      /* 150ms debounced resize ve orientationchange ile DPR & rAF yeniden boyutlandırma */
      let rt = null;
      function handleResize() {
        clearTimeout(rt);
        rt = setTimeout(function () {
          if ($('historyCard')) {
            requestAnimationFrame(function () {
              if (lastPts.length) draw(lastPts, activeScrubberPoint);
            });
          }
        }, 150);
      }
      window.addEventListener('resize', handleResize, { passive: true });
      window.addEventListener('orientationchange', handleResize, { passive: true });
    }

    load(false);
  }

  App.initHistory = init;
  App.History = {
    init: init,
    reload: function () { load(true); },
    noteSample: noteSample
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
