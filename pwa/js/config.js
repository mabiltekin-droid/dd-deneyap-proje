/* ==========================================================================
   config.js — Cyber-Console Yapılandırması, Tema, Ses Sentezleyici,
   Haptik Geri Bildirim ve Etkileşim Motoru.
   Bu dosya diğer tüm modüllerden önce yüklenir.
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});

  App.VERSION = '2.5.0';
  App.STORAGE_KEY = 'deneyap.settings.v2';

  App.DEFAULTS = {
    /* --- Taşıma (transport) seçimi ---
       'http' : Cihazın kendi web sunucusuna doğrudan fetch.
                Yalnızca cihazın kendi ağından (http://192.168.4.1) açılınca
                çalışır; bu panel https üzerinden açıldığında tarayıcı mixed
                content engeline takılır.
       'mqtt' : Cihaz bir MQTT yayıncısına bağlanır, panel de aynı yayıncıya
                WebSocket ile bağlanır. https üzerinden de sorunsuz çalışır.
       Boş bırakılırsa mqttUrl varsa otomatik 'mqtt' seçilir.            */
    transport: 'mqtt',

    /* --- MQTT / bulut rölesi ---
       Bu ayarlar firmware'deki MQTT_HOST / MQTT_USER / MQTT_PASS /
       MQTT_TOPIC değerleriyle AYNI olmalı. */
    mqttUrl: 'wss://broker.emqx.io:8084/mqtt',  /* yayıncının WebSocket adresi */
    mqttUser: '',
    mqttPass: '',
    mqttTopic: 'deneyap/kart1',    /* firmware'deki MQTT_TOPIC ile aynı olmalı */

    host: '',          // yalnızca 'http' taşımasında kullanılır
    token: '',         // config.h içinde API_TOKEN tanımlıysa gerekli
    pollMs: 2000,      // http taşımasında yoklama periyodu (ms); mqtt'te itme kullanılır

    /* --- Supabase (hesaplar, roller, cihaz mülkiyeti) ---
       Bu iki değer GİZLİ DEĞİLDİR: "publishable" anahtar yalnızca
       RLS politikalarıyla korunan tablolara erişir. service_role anahtarı
       asla buraya yazılmaz. Şema için bkz. supabase/schema.sql */
    sbUrl: 'https://zinchrmvfdbbvhwhrcly.supabase.co',
    sbKey: 'sb_publishable_hIJx397mqbvbebU5t_lgmg_8bKIWagS',

    gasWarn: 250,      // donanım eşikleriyle senkronize
    gasDanger: 400,
    rainInvert: false, // true = ters mantık
    autoControl: true, // otomatik fan, servo ve güvenlik müdahalesi
    theme: 'dark',     // 'dark' | 'amoled' | 'light' | 'system'
    soundEnabled: true,// Web Audio API sesli geri bildirim
    vibrateEnabled: true // Haptik titreşim desteği
  };

  App.GAS_FS_MAX = 10000; // Sensör tam skalası (10.000 PPM)

  /* ------------------------------------------------------------ ayar deposu */

  function loadSettings() {
    let raw = null;
    try {
      raw = localStorage.getItem(App.STORAGE_KEY);
    } catch (e) {
      console.warn('[ayarlar] localStorage erişilemiyor, varsayılanlar kullanılacak.', e);
      return Object.assign({}, App.DEFAULTS);
    }
    if (!raw) return Object.assign({}, App.DEFAULTS);
    try {
      const parsed = JSON.parse(raw);
      const out = Object.assign({}, App.DEFAULTS);
      Object.keys(App.DEFAULTS).forEach((k) => {
        if (parsed[k] !== undefined && parsed[k] !== null) out[k] = parsed[k];
      });
      return out;
    } catch (e) {
      console.warn('[ayarlar] bozuk JSON, varsayılanlara dönülüyor.', e);
      return Object.assign({}, App.DEFAULTS);
    }
  }

  let settings = loadSettings();

  App.settings = function () { return Object.assign({}, settings); };

  App.saveSettings = function (patch) {
    settings = Object.assign({}, settings, patch || {});
    try {
      localStorage.setItem(App.STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn('[ayarlar] kaydedilemedi.', e);
    }
    return App.settings();
  };

  App.resetSettings = function () {
    try { localStorage.removeItem(App.STORAGE_KEY); } catch (e) { /* yoksay */ }
    settings = Object.assign({}, App.DEFAULTS);
    return App.settings();
  };

  App.baseUrl = function () {
    return (settings.host || location.origin).replace(/\/+$/, '');
  };

  /* ------------------------------------------------------------ SVG ikonları */
  /* Harici font/CDN bağımlılığı olmaksızın hafif, yüksek netlikte SVG kütüphanesi */
  App.ICONS = {
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/><path d="M19 3v4M21 5h-4"/></svg>',
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 14.5A3.5 3.5 0 0 0 12 18a3.5 3.5 0 0 0 3.5-3.5c0-2-1.5-3-2-4.5-.5 1.5-1.5 2-1.5 2s-.5-1.5-1-2.5c-.8 1.5-2.5 3-2.5 5Z"/><path d="M12 2c1 3 4 5.5 5.5 8.5a7 7 0 1 1-13 3.5c0-4 3.5-7.5 5-10.5.5 2 2 3 2.5 3 .5-.5 1-2.5 0-4.5Z"/></svg>',
    cloudRain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6M8 14v6M12 16v6"/></svg>',
    fan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M12 10a4 4 0 0 0-4-4c-2.2 0-3 1.8-1.5 3.5L10 12"/><path d="M14 12a4 4 0 0 0 4-4c0-2.2-1.8-3-3.5-1.5L12 10"/><path d="M12 14a4 4 0 0 0 4 4c2.2 0 3-1.8 1.5-3.5L14 12"/><path d="M10 12a4 4 0 0 0-4 4c0 2.2 1.8 3 3.5 1.5L12 14"/></svg>',
    pump: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/><path d="M8 14h2l2-3 2 5 2-2h2"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M2 8c.5-1.5 1.5-2.5 3-3M22 8c-.5-1.5-1.5-2.5-3-3"/></svg>',
    zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    window: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/></svg>',
    blinds: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M12 3v18M17 3v18"/></svg>',
    shieldAlert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    chip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/><line x1="4" y1="9" x2="2" y2="9"/><line x1="4" y1="15" x2="2" y2="15"/><line x1="20" y1="9" x2="22" y2="9"/><line x1="20" y1="15" x2="22" y2="15"/><line x1="9" y1="4" x2="9" y2="2"/><line x1="15" y1="4" x2="15" y2="2"/><line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/></svg>',
    terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
    database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'
  };

  /* ------------------------------------------------------------------ tema */

  function prefersDark() {
    return window.matchMedia &&
           window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  App.isDark = function (mode) {
    const m = mode || settings.theme || 'dark';
    if (m === 'amoled' || m === 'dark') return true;
    if (m === 'light') return false;
    return prefersDark();
  };

  App.applyTheme = function (mode) {
    const target = mode || settings.theme || 'dark';
    const isDarkTheme = App.isDark(target);
    const resolved = (target === 'system') ? (prefersDark() ? 'dark' : 'light') : target;

    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-color-scheme', isDarkTheme ? 'dark' : 'light');

    const meta = document.getElementById('metaThemeColor');
    if (meta) {
      if (resolved === 'amoled') meta.setAttribute('content', '#000000');
      else if (isDarkTheme) meta.setAttribute('content', '#0a0d14');
      else meta.setAttribute('content', '#f0f4f9');
    }

    const toggleBtn = document.getElementById('themeToggleBtn');
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-checked', isDarkTheme ? 'true' : 'false');
      toggleBtn.setAttribute('aria-label', isDarkTheme ? 'Aydınlık temaya geç' : 'Karanlık temaya geç');
    }

    /* NOT: Eski kod burada #themeIcon adlı bir element arayıp içine
       güneş/ay SVG'si yazıyordu; o element hiçbir HTML'de yok ve tema
       düğmesi zaten animasyonlu .sky-pill (sun-orb / moon-orb + aria-checked)
       ile durumu gösteriyor. Ölü kod kaldırıldı. */

    return isDarkTheme;
  };

  App.onSystemThemeChange = function (cb) {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = function () {
      if ((App.settings().theme || 'system') === 'system') {
        const isDark = App.applyTheme('system');
        if (typeof cb === 'function') cb(isDark);
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  };

  /* ------------------------------------------- Web Audio API Sentezleyici */
  /* Harici ses dosyası indirmeden tarayıcının yerleşik osilatörü ile ses üretir */

  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtx();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  App.sound = {
    click: function () {
      if (!settings.soundEnabled) return;
      try {
        const ctx = getAudioCtx();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const now = ctx.currentTime;
        osc.frequency.setValueAtTime(820, now);
        osc.frequency.exponentialRampToValueAtTime(360, now + 0.035);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.035);
      } catch (e) { /* yoksay */ }
    },

    chime: function () {
      if (!settings.soundEnabled) return;
      try {
        const ctx = getAudioCtx();
        if (!ctx) return;
        const freqs = [523.25, 659.25, 783.99]; // C5, E5, G5 akoru
        freqs.forEach(function (f, i) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          const t = ctx.currentTime + i * 0.055;
          osc.frequency.setValueAtTime(f, t);
          gain.gain.setValueAtTime(0.05, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.16);
        });
      } catch (e) { /* yoksay */ }
    },

    alarm: function () {
      if (!settings.soundEnabled) return;
      try {
        const ctx = getAudioCtx();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        const now = ctx.currentTime;
        osc.frequency.setValueAtTime(940, now);
        osc.frequency.setValueAtTime(520, now + 0.1);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.22);
      } catch (e) { /* yoksay */ }
    }
  };

  App.haptic = function (ms) {
    if (settings.vibrateEnabled && navigator.vibrate) {
      try { navigator.vibrate(ms || 15); } catch (e) { /* yoksay */ }
    }
  };

  /* ---------------------------------- 3D Card Tilt, Glare & Parallaks */

  App.init3DTilt = function () {
    const reducedMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return;

    const cards = document.querySelectorAll('.tilt-card');
    cards.forEach(function (card) {
      let glare = card.querySelector('.card-glare');
      if (!glare) {
        glare = document.createElement('div');
        glare.className = 'card-glare';
        card.appendChild(glare);
      }

      function onMouseMove(e) {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const px = (x / rect.width) * 2 - 1;   // -1 .. +1
        const py = (y / rect.height) * 2 - 1;  // -1 .. +1

        const rotX = -py * 5;  // max 5 derece
        const rotY = px * 5;

        card.style.transform = 'perspective(900px) rotateX(' + rotX.toFixed(2) + 'deg) rotateY(' + rotY.toFixed(2) + 'deg) translateZ(4px)';
        glare.style.background = 'radial-gradient(circle at ' + (x) + 'px ' + (y) + 'px, rgba(255,255,255,0.14) 0%, transparent 60%)';
        glare.style.opacity = '1';
      }

      function onMouseLeave() {
        card.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg) translateZ(0)';
        glare.style.opacity = '0';
      }

      card.addEventListener('mousemove', onMouseMove, { passive: true });
      card.addEventListener('mouseleave', onMouseLeave, { passive: true });
    });
  };

  App.initParallax = function () {
    const reducedMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return;

    let ticking = false;
    window.addEventListener('scroll', function () {
      if (!ticking) {
        window.requestAnimationFrame(function () {
          const sy = window.scrollY || window.pageYOffset || 0;
          document.documentElement.style.setProperty('--scroll-y', sy + 'px');
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  };

  App.initRipple = function () {
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('.btn, .icon-btn');
      if (!btn) return;
      App.sound.click();
      App.haptic(15);

      const circle = document.createElement('span');
      circle.className = 'ripple-effect';
      const rect = btn.getBoundingClientRect();
      const diameter = Math.max(rect.width, rect.height);
      circle.style.width = circle.style.height = diameter + 'px';
      circle.style.left = (e.clientX - rect.left - diameter / 2) + 'px';
      circle.style.top = (e.clientY - rect.top - diameter / 2) + 'px';
      btn.appendChild(circle);

      setTimeout(function () {
        if (circle.parentNode) circle.parentNode.removeChild(circle);
      }, 550);
    }, { passive: true });
  };

  /* ------------------------------------------------------- Service Worker */

  App.onUpdateReady = null;

  App.registerServiceWorker = function () {
    if (!('serviceWorker' in navigator)) {
      return Promise.resolve(null);
    }
    return navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(function (reg) {
        reg.addEventListener('updatefound', function () {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', function () {
            if (sw.state === 'installed' && navigator.serviceWorker.controller &&
                typeof App.onUpdateReady === 'function') {
              App.onUpdateReady(reg, sw);
            }
          });
        });
        return reg;
      })
      .catch(function (err) {
        console.error('[sw] kayıt hatası:', err);
        return null;
      });
  };

  App.activateUpdate = function (reg) {
    if (!reg) return false;
    const waiting = reg.waiting || reg.installing;
    if (!waiting) return false;
    waiting.postMessage({ type: 'SKIP_WAITING' });
    return true;
  };

  App.reloadOnControllerChange = function () {
    if (!('serviceWorker' in navigator)) { location.reload(); return; }
    let done = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (done) return;
      done = true;
      location.reload();
    });
  };

  /* ----------------------------------------------------------- biçimlendirme */

  App.fmtDuration = function (ms) {
    if (typeof ms !== 'number' || ms < 0) return '—';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d) return d + 'g ' + h + 's ' + m + 'd';
    if (h) return h + 's ' + m + 'd ' + sec + 'sn';
    if (m) return m + 'd ' + sec + 'sn';
    return sec + 'sn';
  };

  App.fmtBytes = function (b) {
    if (typeof b !== 'number' || b <= 0) return '—';
    if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
    if (b >= 1024) return Math.round(b / 1024) + ' KB';
    return b + ' B';
  };

  App.fmtAgo = function (ts) {
    if (!ts) return '—';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 2) return 'az önce';
    if (s < 60) return s + ' sn önce';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' dk önce';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' sa önce';
    return Math.floor(h / 24) + ' gün önce';
  };

  /* --------------------------------------------------------------- toast */

  let toastTimer = null;
  App.toast = function (message, opts) {
    const o = opts || {};
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = '';
    el.className = 'toast' + (o.kind ? ' ' + o.kind : '');

    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    if (o.kind === 'danger') iconSpan.innerHTML = App.ICONS.shieldAlert;
    else if (o.kind === 'warn') iconSpan.innerHTML = App.ICONS.bell;
    else iconSpan.innerHTML = App.ICONS.zap;
    el.appendChild(iconSpan);

    const txtSpan = document.createElement('span');
    txtSpan.className = 'toast-msg';
    txtSpan.textContent = message;
    el.appendChild(txtSpan);

    if (o.actionLabel && typeof o.onAction === 'function') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn sm primary';
      b.textContent = o.actionLabel;
      b.addEventListener('click', function () {
        o.onAction();
        App.toast('');
      });
      el.appendChild(b);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    if (!o.sticky) {
      toastTimer = setTimeout(function () { el.hidden = true; }, o.duration || 4000);
    }
  };

  App.hideToast = function () {
    const el = document.getElementById('toast');
    if (el) el.hidden = true;
    clearTimeout(toastTimer);
  };

  /* Bağlantı rozetini güncelle */
  App.setConnBadge = function (state, text) {
    const badge = document.getElementById('conn');
    if (!badge) return;
    badge.setAttribute('data-state', state);
    const label = badge.querySelector('#connText');
    if (label) {
      label.textContent = text;
      return;
    }
    badge.innerHTML = '<span class="dot" aria-hidden="true"></span><span id="connText">' + String(text).replace(/</g, '&lt;') + '</span>';
  };

  App.renderDeviceInfo = function (s) {
    const put = function (id, value) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    put('fw', s.fw ? 'v' + s.fw : '—');
    put('ip', s.ip || '—');
    put('rssi', typeof s.rssi === 'number' ? s.rssi + ' dBm' : '—');
    put('heap', App.fmtBytes(s.heap));
    put('uptime', App.fmtDuration(s.uptime));
    put('fsState', s.fs ? 'LittleFS Aktif' : 'API-Only');
  };

  /* -------------------------------------------------- PWA İndirme / Yükleme */
  App.setupPwaInstall = function (btnId) {
    const btn = document.getElementById(btnId || 'pwaInstallBtn');
    if (!btn) return;

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      window.__pwaDeferredPrompt = e;
      btn.classList.add('has-prompt');
    });

    window.addEventListener('appinstalled', function () {
      window.__pwaDeferredPrompt = null;
      btn.classList.remove('has-prompt');
      App.toast('Ev Koruma başarıyla yüklendi! 🎉', { kind: 'ok' });
    });

    btn.addEventListener('click', async function () {
      if (typeof App.haptic === 'function') App.haptic(25);
      if (typeof App.sound === 'function') App.sound('toggle');

      const promptEvent = window.__pwaDeferredPrompt;
      if (promptEvent) {
        promptEvent.prompt();
        try {
          const choice = await promptEvent.userChoice;
          if (choice && choice.outcome === 'accepted') {
            App.toast('Uygulama yükleniyor...', { kind: 'ok' });
          }
        } catch (err) {
          console.warn('[pwa] seçim hatası:', err);
        }
        window.__pwaDeferredPrompt = null;
        btn.classList.remove('has-prompt');
        return;
      }

      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
      if (isStandalone) {
        App.toast('Uygulama zaten cihazınızda kurulu ve bağımsız çalışıyor.', { kind: 'ok' });
        return;
      }

      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (isIos) {
        App.toast('iOS Safari: "Paylaş" ➔ "Ana Ekrana Ekle" butonuna dokunun.', { kind: 'warn', duration: 6000 });
      } else {
        App.toast('Tarayıcı menüsünden (⋮) "Uygulamayı Yükle" veya "Ana ekrana ekle"yi seçebilirsiniz.', { kind: 'ok', duration: 5000 });
      }
    });
  };
})();

