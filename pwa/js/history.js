/* ==========================================================================
   history.js — sensör geçmişi.
   Ölçümler cihazdan geldikçe localStorage'a yazılır, panel üzerinde
   sparkline olarak çizilir. Cihaz geçmiş tutmaz (RAM sınırlı), geçmiş
   yalnızca bu tarayıcıda ve yalnızca son 30 dakika saklanır.

   Bağımlılık notu: Grafik elle çizilir, kütüphane yok. Cihazda build
   olmadığı için modül dosyası olduğu gibi servis edilir.
   ========================================================================== */

(function () {
  'use strict';

  const App = window.App;

  const STORAGE_KEY = 'deneyap.history.v1';
  const WINDOW_MS = 30 * 60 * 1000;   // geriye bakış penceresi
  const SAMPLE_MS = 5000;             // iki ölçüm arası en az 5 sn
  const MAX_SAMPLES = 400;            // 30 dk / 5 sn = 360, biraz pay bırak

  /* SVG çizim alanı (viewBox). preserveAspectRatio="none" ile ekrana
     yayılır; stroke-width'un bozulmaması için non-scaling-stroke kullanılır. */
  const VB_W = 320, VB_H = 64, VB_PAD = 2;

  let samples = load();
  let lastSampleTs = 0;
  let dirty = false;

  /* --------------------------------------------------------------- kayıt */

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return []; }
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter(isValid).slice(-MAX_SAMPLES) : [];
    } catch (e) {
      return [];
    }
  }

  /* Kayıt biçimi: [zaman(ms), ppm, yağmur(0|1)] — kısa tutmak için dizi */
  function isValid(s) {
    return Array.isArray(s) && s.length === 3 &&
           typeof s[0] === 'number' && typeof s[1] === 'number';
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(samples));
      dirty = false;
    } catch (e) {
      /* Kota dolu olabilir; sessizce geç, eski veriyi koru */
      samples = samples.slice(-Math.floor(MAX_SAMPLES / 2));
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(samples)); } catch (e2) { /* yoksay */ }
    }
  }

  function prune(now) {
    const cut = now - WINDOW_MS;
    let i = 0;
    while (i < samples.length && samples[i][0] < cut) i += 1;
    if (i > 0) {
      samples = samples.slice(i);
      dirty = true;
    }
    if (samples.length > MAX_SAMPLES) {
      samples = samples.slice(samples.length - MAX_SAMPLES);
      dirty = true;
    }
  }

  /* -------------------------------------------------------------- istatistik */

  function stats() {
    const out = { count: samples.length, min: 0, max: 0, avg: 0, wetCount: 0, from: 0, to: 0 };
    if (!samples.length) return out;
    let sum = 0, min = Infinity, max = -Infinity, wet = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const v = samples[i][1];
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
      if (samples[i][2]) wet += 1;
    }
    out.min = min; out.max = max; out.avg = Math.round(sum / samples.length);
    out.wetCount = wet;
    out.from = samples[0][0];
    out.to = samples[samples.length - 1][0];
    return out;
  }

  /* Ölçüm ekle. Çok sık gelen verilerde (pollMs 2000) her turda yazmaz,
     böylece localStorage gereksiz yere büyümez. */
  function record(data) {
    const now = Date.now();
    prune(now);
    if (now - lastSampleTs < SAMPLE_MS) return false;
    lastSampleTs = now;
    samples.push([now, Math.max(0, Number(data.gasPpm) || 0), data.rain ? 1 : 0]);
    dirty = true;
    return true;
  }

  /* --------------------------------------------------------------- çizim */

  const $ = function (id) { return document.getElementById(id); };

  /* Y ekseni tavanı: tehlike eşiğinin biraz üstü ve penceredeki en yüksek
     değer. Böylece eşik çizgileri hep görünür, ama normal değerler de
     grafikte okunur kalır. */
  function scaleTop() {
    const s = App.settings();
    const st = stats();
    let top = Math.max(Number(s.gasDanger) * 1.6, st.max || 0);
    /* Yuvarlak sayıya çek: 100'ün katı */
    top = Math.max(100, Math.ceil(top / 100) * 100);
    return top;
  }

  function yOf(v, top) {
    const usable = VB_H - VB_PAD * 2;
    return VB_PAD + usable - (Math.max(0, Math.min(top, v)) / top) * usable;
  }

  function render() {
    const svg = $('sparkGas');
    if (!svg) return;
    const st = stats();

    const line = $('sparkLine');
    const area = $('sparkArea');
    const marks = $('sparkMarks');
    const grid = $('sparkGrid');
    const top = scaleTop();

    if (!st.count) {
      setLineAttrs(line, '');
      setLineAttrs(area, '');
      if (marks) marks.setAttribute('d', '');
      if (grid) grid.innerHTML = '';
      $('sparkEmpty').hidden = false;
      setText('sparkScale', '');
      setText('histMin', '—');
      setText('histAvg', '—');
      setText('histMax', '—');
      setText('histRain', '—');
      $('sparkGas').setAttribute('aria-label', 'Henüz geçmiş veri yok');
      return;
    }

    $('sparkEmpty').hidden = true;

    const n = st.count;
    const step = n > 1 ? VB_W / (n - 1) : VB_W;
    const pts = samples.map(function (s, i) {
      return (n > 1 ? i * step : VB_W / 2).toFixed(1) + ',' + yOf(s[1], top).toFixed(1);
    });

    /* Çizgi ve altındaki soluk alan */
    setLineAttrs(line, pts.join(' '));
    setLineAttrs(area, '0,' + VB_H + ' ' + pts.join(' ') + ' ' + VB_W + ',' + VB_H);

    /* Yağmur gözleri: alt kenarda birer çubuk */
    if (marks) {
      let d = '';
      for (let i = 0; i < n; i += 1) {
        if (!samples[i][2]) continue;
        const x = (n > 1 ? i * step : VB_W / 2).toFixed(1);
        d += 'M' + x + ' ' + (VB_H - 1) + 'V' + (VB_H - 5);
      }
      /* SVG yolunda textContent işe yaramaz, "d" niteliği gerekir */
      marks.setAttribute('d', d);
    }

    /* Eşik çizgileri ve sol üstte ölçek */
    if (grid) {
      const s = App.settings();
      const warnY = yOf(s.gasWarn, top).toFixed(1);
      const dangerY = yOf(s.gasDanger, top).toFixed(1);
      /* <g> içine markup eklemek için textContent değil innerHTML gerekir */
      grid.innerHTML =
        '<line x1="0" y1="' + warnY + '" x2="' + VB_W + '" y2="' + warnY + '" class="spark-th warn"></line>' +
        '<line x1="0" y1="' + dangerY + '" x2="' + VB_W + '" y2="' + dangerY + '" class="spark-th danger"></line>';
    }

    /* Grafiğin rengi son ölçümün durumuna göre değişsin */
    svg.setAttribute('data-state', currentState());

    setText('sparkScale', '0 – ' + top + ' ppm');
    setText('histMin', st.min + ' ppm');
    setText('histAvg', st.avg + ' ppm');
    setText('histMax', st.max + ' ppm');
    setText('histRain', st.wetCount > 0 ? st.wetCount + ' ölçüm' : 'yok');

    svg.setAttribute('aria-label',
      'Gaz seviyesi geçmişi: en düşük ' + st.min + ', ortalama ' + st.avg +
      ', en yüksek ' + st.max + ' ppm');
  }

  function currentState() {
    const last = samples[samples.length - 1];
    if (!last) return 'unknown';
    const s = App.settings();
    const ppm = last[1];
    if (ppm >= Number(s.gasDanger)) return 'danger';
    if (ppm >= Number(s.gasWarn)) return 'warning';
    return 'normal';
  }

  function setLineAttrs(el, points) {
    if (!el) return;
    el.setAttribute('points', points);
  }

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  /* ------------------------------------------------------------------ API */

  App.history = {
    /* Uygulama her başarılı poll'dan sonra çağırır */
    update: function (data) {
      const eklendi = record(data);
      if (eklendi) render();
      else if (dirty && samples.length) render();
      return eklendi;
    },

    render: render,

    stats: stats,

    clear: function () {
      samples = [];
      lastSampleTs = 0;
      dirty = false;
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* yoksay */ }
      render();
    },

    /* Sekme kapanırken yazılmamış veriyi kaybetme */
    flush: function () {
      prune(Date.now());
      if (dirty) save();
    },

    /* Tema/eşik değişince yeniden çiz */
    refresh: render,

    WINDOW_MS: WINDOW_MS,
    SAMPLE_MS: SAMPLE_MS
  };
})();