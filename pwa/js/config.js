/* ==========================================================================
   config.js — sürüm bilgisi, varsayılanlar, kalıcı ayar deposu, tema yönetimi
   ve Service Worker kayıt akışı.
   Bu dosya diğer modüllerden (api.js, app.js, settings.js) önce yüklenir.
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});

  App.VERSION = '2.3.0';
  App.STORAGE_KEY = 'deneyap.settings.v2';

  App.DEFAULTS = {
    host: '',          // boş = panelin açıldığı adres (cihazın kendi sunucusu)
    token: '',         // firmware'de API_TOKEN tanımlıysa gerekli
    pollMs: 2000,
    gasWarn: 250,      // paneldeki gösterge eşiği (cihaz kendi eşiğini kullanır)
    gasDanger: 400,
    rainInvert: false, // true = yüksek analog değer "kuru" demek
    autoControl: true,
    notifyDanger: true, // gaz eşiği aşılınca tarayıcı bildirimi
    theme: 'system'    // light | dark | system
  };

  App.GAS_FS_MAX = 10000;   // gauge'ın tam skalası (firmware/config.h ile aynı)

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
      console.warn('[ayarlar] bozuk JSON kaydedilmiş, varsayılanlara dönülüyor.', e);
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

  /* Cihazın temel adresi. Sondaki eğik çizgiyi at — istekler "path" ile birleşiyor. */
  App.baseUrl = function () {
    return (settings.host || location.origin).replace(/\/+$/, '');
  };

  /* ------------------------------------------------------------------ tema */

  function prefersDark() {
    return window.matchMedia &&
           window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  App.isDark = function (mode) {
    const m = mode || settings.theme || 'system';
    return m === 'dark' || (m === 'system' && prefersDark());
  };

  App.applyTheme = function (mode) {
    const dark = App.isDark(mode);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const meta = document.getElementById('metaThemeColor');
    if (meta) meta.setAttribute('content', dark ? '#121212' : '#f4f6f9');
    const icon = document.getElementById('themeIcon');
    if (icon) icon.textContent = dark ? '🌙' : '☀️';
    return dark;
  };

  /* Sistem teması canlı takip edilsin (ayarlar açıkken değişirse) */
  App.onSystemThemeChange = function (cb) {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = function () {
      if ((App.settings().theme || 'system') === 'system') cb(App.applyTheme('system'));
    };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  };

  /* ------------------------------------------------------- Service Worker */

  /* Yeni sürüm hazır olduğunda çağrılacak geri çağrım.
     app.js bu noktaya "Yeniden yükle" sunan bir bildirim bağlar. */
  App.onUpdateReady = null;

  App.registerServiceWorker = function () {
    if (!('serviceWorker' in navigator)) {
      console.warn('[sw] bu tarayıcı Service Worker desteklemiyor.');
      return Promise.resolve(null);
    }
    return navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(function (reg) {
        reg.addEventListener('updatefound', function () {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', function () {
            /* "installed" + halihazırda bir kontrolör varsa yeni sürüm bekliyor demektir */
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

  /* Bekleyen sürümü hemen etkinleştir */
  App.activateUpdate = function (reg) {
    if (!reg) return false;
    const waiting = reg.waiting || reg.installing;
    if (!waiting) return false;
    waiting.postMessage({ type: 'SKIP_WAITING' });
    return true;
  };

  /* Etkin worker değişince sayfayı bir kez yeniden yükle */
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
    if (d) return d + 'g ' + h + 's';
    if (h) return h + 's ' + m + 'd';
    if (m) return m + 'd ' + (s % 60) + 's';
    return s + 's';
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
    el.appendChild(document.createTextNode(message));
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

  /* Bağlantı rozetini güncelle (hem index hem settings sayfası kullanır) */
  App.setConnBadge = function (state, text) {
    const badge = document.getElementById('conn');
    const label = document.getElementById('connText');
    if (badge) badge.setAttribute('data-state', state);
    if (label) label.textContent = text;
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
    put('fsState', s.fs ? 'yüklü' : 'yok (API-only)');
  };
})();