/* ==========================================================================
   offline.js — Çevrimdışı dayanıklılık
   --------------------------------------------------------------------------
   Amaç: internet/cihaz bağlantısı koptuğunda panelin boş görünmemesi.

     • Son canlı telemetri localStorage'a yazılır (5 sn'de bir).
     • Uygulama yeniden açıldığında ağ yoksa bu kayıt ekrana basılır.
     • Altta "Bağlantı yok · son veri 14:32" şeridi ve "Yeniden dene" çıkar.
     • Bağlantı dönünce şerit kendiliğinden kaybolur.

   Kayıt hesaba bağlıdır: başka bir kullanıcı giriş yaparsa önbellek
   gösterilmez ve silinir (cihaz verisi hesaplar arasında sızmasın).
   ========================================================================== */

(function () {
  'use strict';

  var App = window.App;
  if (!App) return;

  var KEY = 'dd.cache.telemetry.v1';
  var SAVE_EVERY_MS = 5000;
  var lastSave = 0;
  var bar = null;
  var barText = null;
  var barBtn = null;
  var showingCache = false;
  var offlineTimer = 0;
  var retryTimer = 0;

  function nowClock(ms) {
    try {
      return new Date(ms).toLocaleTimeString('tr-TR', {
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      return '--:--';
    }
  }

  function currentUid() {
    try {
      var s = App.Auth && App.Auth.snapshot ? App.Auth.snapshot() : null;
      return (s && s.user && s.user.id) || '';
    } catch (e) {
      return '';
    }
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || !c.data || !c.at) return null;
      return c;
    } catch (e) {
      return null;
    }
  }

  function clearCache() {
    try { localStorage.removeItem(KEY); } catch (e) { /* yoksay */ }
  }

  function saveCache(data) {
    if (!data) return;
    var t = Date.now();
    if (t - lastSave < SAVE_EVERY_MS) return;
    lastSave = t;
    try {
      localStorage.setItem(KEY, JSON.stringify({
        at: t,
        uid: currentUid(),
        data: data
      }));
    } catch (e) {
      /* Kota dolu / gizli mod: önbellek sessizce devre dışı kalır. */
    }
  }

  /* --------------------------------------------------------------- şerit */

  function ensureBar() {
    if (bar) return bar;

    bar = document.createElement('div');
    bar.id = 'ddOfflineBar';
    bar.className = 'dd-offline-bar';
    bar.hidden = true;
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');

    var dot = document.createElement('span');
    dot.className = 'dd-offline-dot';
    dot.setAttribute('aria-hidden', 'true');

    barText = document.createElement('span');
    barText.className = 'dd-offline-text';

    barBtn = document.createElement('button');
    barBtn.type = 'button';
    barBtn.className = 'dd-offline-btn';
    barBtn.textContent = 'Yeniden dene';
    barBtn.addEventListener('click', retry);

    bar.appendChild(dot);
    bar.appendChild(barText);
    bar.appendChild(barBtn);
    document.body.appendChild(bar);
    return bar;
  }

  function showBar(text, kind) {
    ensureBar();
    barText.textContent = text;
    bar.dataset.kind = kind || 'offline';
    bar.hidden = false;
  }

  function hideBar() {
    clearTimeout(offlineTimer);
    clearTimeout(retryTimer);
    offlineTimer = 0;
    if (!bar) return;
    bar.hidden = true;
    barBtn.disabled = false;
    barBtn.textContent = 'Yeniden dene';
  }

  function retry() {
    barBtn.disabled = true;
    barBtn.textContent = 'Deneniyor…';
    try {
      if (typeof App.retryConnection === 'function') App.retryConnection();
      else window.dispatchEvent(new Event('online'));
    } catch (e) { /* yoksay */ }
    clearTimeout(retryTimer);
    retryTimer = setTimeout(function () {
      if (!bar || bar.hidden) return;
      barBtn.disabled = false;
      barBtn.textContent = 'Yeniden dene';
    }, 6000);
  }

  function offlineText(reason) {
    var cached = readCache();
    var at = cached && cached.at ? cached.at : 0;

    var base = reason ? 'Bağlantı yok' : 'Çevrimdışı';
    if (!navigator.onLine) base = 'İnternet yok';
    return at ? base + ' · son veri ' + nowClock(at) : base;
  }

  function showOfflineSoon(reason) {
    if (offlineTimer || (bar && !bar.hidden && bar.dataset.kind === 'offline')) return;
    offlineTimer = setTimeout(function () {
      offlineTimer = 0;
      showBar(offlineText(reason), 'offline');
    }, 900);
  }

  /* ------------------------------------------------------------- önbellek */

  function hydrate() {
    var cached = readCache();
    if (!cached) return;

    var live = App.lastTelemetry ? App.lastTelemetry() : null;
    if (live) return;

    var uid = currentUid();
    if (cached.uid && cached.uid !== uid) {
      // Oturum henüz doğrulanmadıysa gösterme, ancak aynı hesabın verisini silme.
      if (uid) clearCache();
      return;
    }

    if (typeof App.renderCached !== 'function') return;
    if (!App.renderCached(cached.data, cached.at)) return;

    showingCache = true;
    showBar('Önbellekteki son veri · ' + nowClock(cached.at), 'cache');
  }

  function whenAuthReady(cb) {
    var done = false;
    var fallbackTimer = 0;

    function fire() {
      if (done) return;
      done = true;
      clearTimeout(fallbackTimer);
      cb();
    }

    try {
      var snap = App.Auth && App.Auth.snapshot ? App.Auth.snapshot() : null;
      if (snap && snap.ready) {
        fire();
        return;
      }
      if (App.Auth && App.Auth.onChange) {
        var off = App.Auth.onChange(function (s) {
          if (!s || !s.ready) return;
          try { off(); } catch (e) { /* yoksay */ }
          if (done) cb();
          else fire();
        });
      }
    } catch (e) { /* yoksay */ }

    /* Oturum yoksa da bir süre sonra önbelleği göstermeyi dene. */
    fallbackTimer = setTimeout(fire, 2600);
  }

  /* -------------------------------------------------------------- olaylar */

  document.addEventListener('deneyap:telemetry', function (e) {
    saveCache(e.detail);

    if (showingCache) {
      showingCache = false;
      hideBar();
    }
  });

  document.addEventListener('deneyap:connection', function (e) {
    var d = e.detail || {};
    if (d.online) {
      hideBar();
      return;
    }
    showOfflineSoon(d.reason);
  });

  window.addEventListener('offline', function () {
    showOfflineSoon('internet');
  });

  /* Uygulama ilk açılışında: önce önbellek, sonra canlı veri. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      whenAuthReady(hydrate);
    });
  } else {
    whenAuthReady(hydrate);
  }

  App.Offline = {
    cache: readCache,
    clear: clearCache,
    hydrate: hydrate
  };
})();
