/* ==========================================================================
   earthquake.js — Canlı deprem akışı ve konuma göre S dalgası geri sayımı
   --------------------------------------------------------------------------
   • Veri: /api/earthquakes (EMSC son depremler, Vercel üzerinden önbellekli).
   • Konum yalnızca bu cihazda saklanır; sunucuya gönderilmez.
   • Uyarı, EMSC kaydı geldikten SONRA dalga varışına kalan süreyi gösterir.
     Deprem tahmini değildir ve 30 saniye garantisi yoktur.
   ========================================================================== */

(function () {
  'use strict';

  const API = './api/earthquakes';
  const SOURCE = 'EMSC';
  const STORE_KEY = 'deneyap.quake.v1';
  const S_WAVE_KMS = 3.5;
  const POLL_MS = 30000;
  const ALERT_MIN_MAG = 3.5;
  const ALERT_MAX_SEC = 120;
  const FRESH_MS = 5 * 60 * 1000;
  const MAX_SEEN = 600;

  const $ = function (id) { return document.getElementById(id); };

  const state = {
    lat: null,
    lng: null,
    accuracy: null,
    notify: false,
    minMag: 2.5,
    hours: 24,
    seen: [],
    seenSet: new Set(),
    initialized: false,
    needsSourceBaseline: false,
    events: [],
    lastFetch: 0,
    loading: false,
    active: null,
    alertHideTimer: 0
  };

  let pollTimer = 0;
  let tickTimer = 0;

  /* ------------------------------------------------------------ yardımcılar */

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      if (ch === '&') return '&amp;';
      if (ch === '<') return '&lt;';
      if (ch === '>') return '&gt;';
      if (ch === '"') return '&quot;';
      return '&#39;';
    });
  }

  function clampNumber(value, min, max) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, n));
  }

  function loadStore() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object') return;

    const lat = clampNumber(raw.lat, -90, 90);
    const lng = clampNumber(raw.lng, -180, 180);
    if (lat !== null && lng !== null) {
      state.lat = lat;
      state.lng = lng;
      state.accuracy = clampNumber(raw.accuracy, 0, 100000);
    }

    state.notify = raw.notify === true;
    state.minMag = clampNumber(raw.minMag, 2, 4) || 2.5;
    state.hours = [6, 24, 48, 72].indexOf(Number(raw.hours)) !== -1 ? Number(raw.hours) : 24;
    state.seen = Array.isArray(raw.seen)
      ? raw.seen.filter(function (id) { return typeof id === 'string'; }).slice(-MAX_SEEN)
      : [];
    state.seenSet = new Set(state.seen);
    state.initialized = raw.initialized === true;
    state.needsSourceBaseline = state.initialized && raw.source !== SOURCE;
    if (state.needsSourceBaseline) {
      state.seen = [];
      state.seenSet.clear();
    }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        lat: state.lat,
        lng: state.lng,
        accuracy: state.accuracy,
        notify: state.notify,
        minMag: state.minMag,
        hours: state.hours,
        seen: state.seen.slice(-MAX_SEEN),
        source: state.needsSourceBaseline ? null : SOURCE,
        initialized: state.initialized
      }));
    } catch (e) {
      /* Gizli mod / kota dolu: akış çalışmaya devam eder. */
    }
  }

  function markSeen(events) {
    let changed = false;
    events.forEach(function (event) {
      if (!event.id || state.seenSet.has(event.id)) return;
      state.seenSet.add(event.id);
      state.seen.push(event.id);
      changed = true;
    });
    if (state.seen.length > MAX_SEEN) {
      state.seen = state.seen.slice(-MAX_SEEN);
      state.seenSet = new Set(state.seen);
    }
    if (changed) saveStore();
  }

  function setStatus(text, kind) {
    const el = $('quakeStatus');
    if (!el) return;
    el.textContent = text || '';
    if (kind) el.setAttribute('data-kind', kind);
    else el.removeAttribute('data-kind');
  }

  function setLive(kind, text) {
    const el = $('quakeLive');
    if (el) {
      el.setAttribute('data-state', kind);
      el.textContent = text;
    }
    const conn = $('quakeConn');
    const connText = $('quakeConnText');
    if (conn) {
      conn.setAttribute('data-state',
        kind === 'online' ? 'live' : kind === 'error' ? 'offline' : 'connecting');
    }
    if (connText) {
      if (kind === 'online') connText.textContent = 'EMSC akışı canlı';
      else if (kind === 'loading') connText.textContent = 'EMSC akışı güncelleniyor…';
      else connText.textContent = 'EMSC akışına ulaşılamıyor';
    }
  }

  function fmtDate(ms) {
    try {
      return new Intl.DateTimeFormat('tr-TR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).format(new Date(ms));
    } catch (e) {
      return new Date(ms).toLocaleString('tr-TR');
    }
  }

  function fmtClock(ms) {
    try {
      return new Intl.DateTimeFormat('tr-TR', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).format(new Date(ms));
    } catch (e) {
      return new Date(ms).toLocaleTimeString('tr-TR');
    }
  }

  function fmtDistance(km) {
    if (km == null || !Number.isFinite(km)) return '';
    if (km < 1) return Math.round(km * 1000) + ' m';
    if (km < 10) return km.toFixed(1) + ' km';
    return Math.round(km) + ' km';
  }

  /* İki nokta arasındaki yüzey mesafesi (km). */
  function distanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* Odak (hiposantr) uzaklığı: yüzey mesafesi + derinlik. */
  function hypocentralKm(event) {
    if (state.lat == null || state.lng == null) return null;
    const surface = distanceKm(state.lat, state.lng, event.latitude, event.longitude);
    const depth = Number.isFinite(Number(event.depth_km)) ? Number(event.depth_km) : 0;
    return Math.sqrt(surface * surface + depth * depth);
  }

  /* S dalgası varışına kalan saniye. Negatifse dalga geçmiş demektir. */
  function etaSeconds(event) {
    const hypocentral = hypocentralKm(event);
    if (hypocentral == null) return null;
    const arrival = event.origin_ms + (hypocentral / S_WAVE_KMS) * 1000;
    return (arrival - Date.now()) / 1000;
  }

  function levelFor(mag) {
    if (mag >= 5) return 'critical';
    if (mag >= 4) return 'high';
    if (mag >= 3) return 'mid';
    return 'low';
  }

  function etaLabel(seconds) {
    if (seconds == null) return null;
    if (seconds <= 0) return { text: 'S dalgası geçti', cls: 'is-past' };
    if (seconds < 120) return { text: 'Tahmini varış ' + Math.ceil(seconds) + ' sn', cls: seconds <= 30 ? 'is-soon' : '' };
    const minutes = Math.round(seconds / 60);
    return { text: 'Tahmini varış ' + minutes + ' dk', cls: '' };
  }

  /* ----------------------------------------------------------------- tema */

  function initChrome() {
    if (window.App) {
      if (typeof App.applyTheme === 'function') App.applyTheme();
      if (typeof App.setupPwaInstall === 'function') App.setupPwaInstall();
      if (typeof App.registerServiceWorker === 'function') App.registerServiceWorker();
      if (typeof App.onSystemThemeChange === 'function') {
        App.onSystemThemeChange(function () {
          if (typeof App.applyTheme === 'function') App.applyTheme();
        });
      }
    }

    const themeBtn = $('themeToggleBtn');
    if (themeBtn && window.App) {
      themeBtn.addEventListener('click', function () {
        const cur = (App.settings && App.settings().theme) || 'light';
        const next = (cur === 'dark' || cur === 'amoled') ? 'light' : 'dark';
        if (App.saveSettings) App.saveSettings({ theme: next });
        if (App.applyTheme) App.applyTheme(next);
        if (App.sound && App.sound.click) App.sound.click();
      });
    }
  }

  /* ------------------------------------------------------------- görünüm */

  function render() {
    const list = $('quakeList');
    const count = $('quakeFeedCount');
    if (!list) return;

    if (count) {
      count.textContent = state.events.length + ' kayıt · son ' + state.hours +
        ' saat · M ≥ ' + state.minMag.toFixed(1);
    }

    if (!state.events.length) {
      list.innerHTML =
        '<div class="quake-empty">' +
          '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M2 12h4l2-7 4 14 2-7h8"/>' +
          '</svg>' +
          '<strong>Bu aralıkta kayıt yok</strong>' +
          '<p>Büyüklük eşiğini düşürün veya zaman aralığını genişletin.</p>' +
        '</div>';
      return;
    }

    list.innerHTML = state.events.map(function (event) {
      const mag = Number(event.magnitude);
      const level = levelFor(mag);
      const distance = hypocentralKm(event);
      const eta = etaLabel(etaSeconds(event));
      const mapUrl = 'https://www.google.com/maps/search/?api=1&query=' +
        encodeURIComponent(event.latitude + ',' + event.longitude);
      const updated = event.updated ? ' · güncellendi' : '';

      return '<article class="quake-item" data-level="' + level + '">' +
        '<div class="quake-mag" aria-label="Büyüklük ' + esc(mag.toFixed(1)) + '">' +
          '<strong>' + esc(mag.toFixed(1)) + '</strong><small>' + esc(event.type || '—') + '</small>' +
        '</div>' +
        '<div class="quake-item-main">' +
          '<div class="quake-item-title" title="' + esc(event.location) + '">' + esc(event.location) + '</div>' +
          '<div class="quake-item-meta">' +
            '<span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>' +
              esc(fmtDate(event.origin_ms)) + updated + '</span>' +
            (Number.isFinite(event.depth_km)
              ? '<span>Derinlik ' + esc(event.depth_km.toFixed(1)) + ' km</span>' : '') +
            (distance != null ? '<span>Size ' + esc(fmtDistance(distance)) + '</span>' : '') +
          '</div>' +
          (eta ? '<span class="quake-eta ' + eta.cls + '">' + esc(eta.text) + '</span>' : '') +
        '</div>' +
        '<a class="quake-map" href="' + mapUrl + '" target="_blank" rel="noopener noreferrer" aria-label="Haritada aç" title="Haritada aç">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>' +
        '</a>' +
      '</article>';
    }).join('');
  }

  function updateLocationUi() {
    const text = $('quakeLocText');
    const clear = $('quakeLocClear');
    const btn = $('quakeLocBtn');
    const has = state.lat != null && state.lng != null;

    if (text) {
      text.textContent = has
        ? state.lat.toFixed(3) + '°, ' + state.lng.toFixed(3) + '°' +
          (state.accuracy ? ' · ±' + Math.round(state.accuracy) + ' m' : '')
        : 'Kapalı — varış süresi hesaplanmıyor';
    }
    if (clear) clear.hidden = !has;
    if (btn) {
      const label = btn.querySelector('span');
      if (label) label.textContent = has ? 'Konumu yenile' : 'Konumu kullan';
    }
  }

  function applyControls() {
    const mag = $('quakeMag');
    const hours = $('quakeHours');
    const notify = $('quakeNotify');
    if (mag) mag.value = String(state.minMag);
    if (hours) hours.value = String(state.hours);
    if (notify) notify.checked = state.notify;
    updateLocationUi();
  }

  /* ---------------------------------------------------------------- uyarı */

  function clearActiveAlert() {
    if (state.alertHideTimer) {
      clearTimeout(state.alertHideTimer);
      state.alertHideTimer = 0;
    }
    state.active = null;
    const alert = $('quakeAlert');
    if (alert) alert.hidden = true;
    const radar = $('quakeRadarValue');
    if (radar) radar.textContent = '—';
  }

  function showAlert(event, seconds) {
    state.active = {
      event: event,
      arrivalMs: seconds != null ? Date.now() + seconds * 1000 : null,
      noLocation: seconds == null
    };

    const alert = $('quakeAlert');
    const title = $('quakeAlertTitle');
    const body = $('quakeAlertBody');
    const meta = $('quakeAlertMeta');
    if (!alert) return;

    if (title) title.textContent = 'M' + Number(event.magnitude).toFixed(1) + ' · ' + event.location;
    if (body) {
      body.textContent = seconds != null
        ? 'Tahmini S dalgası size ' + Math.ceil(seconds) + ' saniye içinde ulaşabilir.'
        : 'Yeni bir deprem kaydedildi. Konum eklenmediği için varış süresi hesaplanamadı.';
    }
    if (meta) {
      const dist = hypocentralKm(event);
      meta.textContent = (dist != null ? 'Odak uzaklığı ' + fmtDistance(dist) + ' · ' : '') +
        'EMSC kaydı ' + fmtClock(event.origin_ms);
    }

    alert.hidden = false;
    updateCountdown();
    sendNotification(event, seconds);

    if (state.alertHideTimer) clearTimeout(state.alertHideTimer);
    state.alertHideTimer = setTimeout(function () {
      if (state.active && state.active.event.id === event.id) clearActiveAlert();
    }, seconds != null ? 14000 : 45000);
  }

  function updateCountdown() {
    const active = state.active;
    if (!active) return;

    const countdown = $('quakeCountdown');
    const radar = $('quakeRadarValue');
    const title = $('quakeAlertTitle');
    const body = $('quakeAlertBody');

    if (active.arrivalMs == null) {
      if (countdown) countdown.textContent = '!';
      if (radar) radar.textContent = '—';
      return;
    }

    const seconds = (active.arrivalMs - Date.now()) / 1000;
    if (seconds > 0) {
      const shown = Math.ceil(seconds);
      if (countdown) countdown.textContent = String(shown);
      if (radar) radar.textContent = String(shown);
      if (title) title.textContent = 'M' + Number(active.event.magnitude).toFixed(1) + ' · ' + active.event.location;
      if (body) body.textContent = 'Tahmini S dalgası size ' + shown + ' saniye içinde ulaşabilir.';
    } else {
      if (countdown) countdown.textContent = '0';
      if (radar) radar.textContent = '0';
      if (title) title.textContent = 'S dalgası geçti · M' + Number(active.event.magnitude).toFixed(1);
      if (body) body.textContent = 'Tahmini varış süresi doldu. Çevrenizi kontrol edin ve resmî uyarıları izleyin.';
    }
  }

  function findAlertCandidate(events, previousSeen) {
    const now = Date.now();
    let best = null;

    events.forEach(function (event) {
      if (!event.id || previousSeen.has(event.id)) return;
      if (Number(event.magnitude) < ALERT_MIN_MAG) return;
      if (now - event.origin_ms > FRESH_MS) return;

      if (state.lat != null && state.lng != null) {
        const seconds = etaSeconds(event);
        if (seconds == null || seconds <= 1 || seconds > ALERT_MAX_SEC) return;
        if (!best || seconds < best.seconds ||
            (Math.abs(seconds - best.seconds) < 2 && Number(event.magnitude) > Number(best.event.magnitude))) {
          best = { event: event, seconds: seconds };
        }
      } else if (Number(event.magnitude) >= 4.5 && now - event.origin_ms <= 120000) {
        if (!best || Number(event.magnitude) > Number(best.event.magnitude)) {
          best = { event: event, seconds: null };
        }
      }
    });

    return best;
  }

  /* ------------------------------------------------------------- bildirim */

  async function sendNotification(event, seconds) {
    if (!state.notify) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const title = 'Deprem uyarısı · M' + Number(event.magnitude).toFixed(1);
    const body = seconds != null
      ? event.location + ' · tahmini S dalgası ' + Math.ceil(seconds) + ' sn içinde'
      : event.location + ' · konum kapalı, varış süresi hesaplanamadı';
    const options = {
      body: body,
      tag: 'dd-quake-' + event.id,
      renotify: true,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      vibrate: [220, 100, 220],
      requireInteraction: true,
      data: { url: './earthquake.html', kind: 'earthquake' }
    };

    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.showNotification) {
          await reg.showNotification(title, options);
          return;
        }
      }
      new Notification(title, options);
    } catch (err) {
      /* Bildirim izni var ama gösterim engellendi; sayfa içi uyarı yeterli. */
    }
  }

  async function onNotifyChange() {
    const box = $('quakeNotify');
    if (!box) return;

    if (!('Notification' in window)) {
      box.checked = false;
      state.notify = false;
      saveStore();
      setStatus('Bu tarayıcı masaüstü bildirimlerini desteklemiyor. Sayfa içi uyarı bandı yine çalışır.', 'error');
      return;
    }

    if (box.checked) {
      let permission = Notification.permission;
      if (permission === 'default') {
        try { permission = await Notification.requestPermission(); } catch (e) { permission = 'denied'; }
      }
      if (permission !== 'granted') {
        box.checked = false;
        state.notify = false;
        saveStore();
        setStatus('Bildirim izni verilmedi. Tarayıcı adres çubuğundan izin verebilirsiniz.', 'error');
        return;
      }
      state.notify = true;
      saveStore();
      setStatus('Bildirimler açık. Bu sayfa açıkken yeni ve yakın depremler için uyarı gösterilir.', 'ok');
    } else {
      state.notify = false;
      saveStore();
      setStatus('Bildirimler kapalı. Sayfa içi uyarı bandı çalışmaya devam eder.', '');
    }
  }

  /* --------------------------------------------------------------- konum */

  function onLocation() {
    if (!navigator.geolocation) {
      setStatus('Bu tarayıcı konum servisini desteklemiyor.', 'error');
      return;
    }

    const btn = $('quakeLocBtn');
    if (btn) btn.disabled = true;
    setStatus('Konum izni isteniyor… Tarayıcı izin penceresini onaylayın.');

    navigator.geolocation.getCurrentPosition(function (pos) {
      state.lat = clampNumber(pos.coords.latitude, -90, 90);
      state.lng = clampNumber(pos.coords.longitude, -180, 180);
      state.accuracy = clampNumber(pos.coords.accuracy, 0, 100000);
      saveStore();
      updateLocationUi();
      render();
      setStatus('Konum eklendi. Mesafeler ve tahmini S dalgası varışları güncellendi. Konum yalnızca bu cihazda saklanır.', 'ok');
      if (btn) btn.disabled = false;
    }, function (err) {
      const message = err && err.code === 1
        ? 'Konum izni verilmedi. Adres çubuğundaki konum simgesinden izin verebilirsiniz.'
        : 'Konum alınamadı. Açık alanda veya GPS açıkken yeniden deneyin.';
      setStatus(message, 'error');
      if (btn) btn.disabled = false;
    }, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 60000
    });
  }

  function clearLocation() {
    state.lat = null;
    state.lng = null;
    state.accuracy = null;
    saveStore();
    updateLocationUi();
    render();
    setStatus('Konum kaldırıldı. Varış süresi hesaplanmıyor.', '');
  }

  /* ---------------------------------------------------------------- veri */

  let filterPending = false;

  async function poll(filterChanged = false) {
    if (state.loading) {
      filterPending = filterPending || filterChanged;
      return;
    }
    state.loading = true;

    setLive('loading', 'Güncelleniyor');

    const controller = new AbortController();
    const timeout = setTimeout(function () { controller.abort(); }, 12000);
    const previousSeen = new Set(state.seen);
    const {hours, minMag} = state;

    try {
      const url = API + '?hours=' + encodeURIComponent(hours) +
        '&minmag=' + encodeURIComponent(minMag.toFixed(1)) +
        '&limit=200';
      const res = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });

      if (!res.ok) {
        throw new Error('API HTTP ' + res.status);
      }

      const data = await res.json();
      if (!data || data.ok !== true || data.source !== SOURCE || !Array.isArray(data.events)) {
        throw new Error((data && data.error) || 'Veri biçimi beklenmedik');
      }

      if (state.hours !== hours || state.minMag !== minMag) return;
      const events = data.events.filter(function (event) {
        return event && Number.isFinite(Number(event.origin_ms)) &&
          Number.isFinite(Number(event.magnitude)) &&
          Number.isFinite(Number(event.latitude)) &&
          Number.isFinite(Number(event.longitude));
      });

      const candidate = state.needsSourceBaseline ? null : findAlertCandidate(events, previousSeen);
      if (candidate) showAlert(candidate.event, candidate.seconds);

      state.events = events;
      state.lastFetch = Date.now();
      state.initialized = true;
      const sourceChanged = state.needsSourceBaseline;
      state.needsSourceBaseline = false;
      markSeen(events);
      if (sourceChanged) saveStore();
      render();

      setLive('online', 'Canlı');
      setStatus('EMSC’den ' + events.length + ' kayıt alındı · ' +
        fmtClock(state.lastFetch), 'ok');
    } catch (err) {
      setLive('error', 'Bağlantı yok');
      const aborted = err && err.name === 'AbortError';
      setStatus(aborted
        ? 'EMSC isteği zaman aşımına uğradı. Birkaç saniye sonra yeniden deneyin.'
        : 'Deprem akışı alınamadı. İnternet bağlantısını kontrol edin; son liste korunuyor.',
        'error');
    } finally {
      clearTimeout(timeout);
      state.loading = false;
      if (filterPending) {
        filterPending = false;
        poll();
      }
    }
  }

  /* ---------------------------------------------------------------- başlat */

  function bindEvents() {
    const mag = $('quakeMag');
    if (mag) {
      mag.addEventListener('change', function () {
        state.minMag = Number(mag.value) || 2.5;
        saveStore();
        poll(true);
      });
    }

    const hours = $('quakeHours');
    if (hours) {
      hours.addEventListener('change', function () {
        state.hours = Number(hours.value) || 24;
        saveStore();
        poll(true);
      });
    }

    const locBtn = $('quakeLocBtn');
    if (locBtn) locBtn.addEventListener('click', onLocation);

    const locClear = $('quakeLocClear');
    if (locClear) locClear.addEventListener('click', clearLocation);

    const notify = $('quakeNotify');
    if (notify) notify.addEventListener('change', onNotifyChange);

    window.addEventListener('online', function () {
      setStatus('İnternet bağlantısı geri geldi, akış yenileniyor…');
      poll();
    });

    window.addEventListener('offline', function () {
      setLive('error', 'Çevrimdışı');
      setStatus('İnternet bağlantısı yok. Son liste gösteriliyor.', 'error');
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && Date.now() - state.lastFetch > 15000) {
        poll();
      }
    });
  }

  function init() {
    loadStore();
    initChrome();
    applyControls();
    bindEvents();
    render();

    poll();
    pollTimer = setInterval(function () {
      if (document.visibilityState === 'visible') poll();
    }, POLL_MS);

    tickTimer = setInterval(updateCountdown, 250);

    window.addEventListener('pagehide', function () {
      clearInterval(pollTimer);
      clearInterval(tickTimer);
    }, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
