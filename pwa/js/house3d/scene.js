/* ==========================================================================
   house3d/scene.js — Three.js 3D ev sahnesi yöneticisi, ışık, HUD ve döngü
   --------------------------------------------------------------------------
   - Three.js ESM paketini CDN üzerinden dinamik olarak yükler.
   - #noDevice ve #homeWidget içindeki aktif kapsayıcıya otomatik taşınır.
   - ResizeObserver, IntersectionObserver, Gündüz/Gece ve oda odaklama sunar.
   - Canlı telemetri ve çalışma modlarını effects.js motoruna aktarır.
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});
  const House3D = (App.House3D = App.House3D || {});

  const THREE_CDN = 'https://unpkg.com/three@0.170.0/build/three.module.js';

  const CAMERA_PRESETS = {
    overview: { label: 'Genel', pos: [-5.8, 4.85, 10.25], target: [0.05, 2.7, -0.15] },
    salon:    { label: 'Salon', pos: [-2.45, 2.4, 5.45], target: [-1.85, 1.65, -0.65] },
    kitchen:  { label: 'Mutfak', pos: [1.55, 2.45, 5.35], target: [2.25, 1.7, -1.05] },
    bedroom:  { label: 'Yatak Odası', pos: [1.65, 4.95, 5.3], target: [2.25, 4.15, -1.2] },
    garden:   { label: 'Bahçe', pos: [-8.3, 4.05, 7.65], target: [-2.85, 1.85, 0.9] }
  };

  let THREE = null;
  let booted = false;
  let loading = false;
  let stageEl = null;
  let canvasEl = null;
  let fallbackEl = null;
  let statusEl = null;
  let statusDotEl = null;
  let statusTextEl = null;
  let badgesEl = null;
  let dayNightBtn = null;

  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let lib = null;
  let arch = null;
  let effects = null;
  let lights = null;

  let rafId = 0;
  let lastFrameTs = 0;
  let isIntersecting = true;
  let currentSlot = null;
  let lastTelemetry = null;
  let lastMeta = { state: 'unknown', online: false };
  let activePreset = 'overview';

  function reducedMotionEnabled() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function findActiveSlot() {
    const widget = document.getElementById('homeWidget');
    const widgetSlot = document.querySelector('#homeWidget [data-house3d-slot]');
    const idleSlot = document.querySelector('#noDevice [data-house3d-slot]');
    if (widget && !widget.hidden && widgetSlot) return widgetSlot;
    return idleSlot || widgetSlot;
  }

  function buildStageDom() {
    if (stageEl) return stageEl;

    stageEl = document.createElement('div');
    stageEl.className = 'house3d-stage';
    stageEl.setAttribute('role', 'region');
    stageEl.setAttribute('aria-label', '3D İnteraktif Ev Görünümü');

    stageEl.innerHTML =
      '<div class="house3d-fallback" id="house3dFallback">3D ev sahnesi yükleniyor…</div>' +
      '<div class="house3d-top">' +
        '<div class="house3d-status" id="house3dStatusBadge" data-level="offline">' +
          '<span class="house3d-dot" aria-hidden="true"></span>' +
          '<span id="house3dStatusText">Bağlantı bekleniyor</span>' +
        '</div>' +
        '<div class="house3d-badges" id="house3dBadges" aria-live="polite"></div>' +
      '</div>' +
      '<div class="house3d-toolbar" role="toolbar" aria-label="3D kamera ve ortam kontrolleri">' +
        '<div class="house3d-controls-pill">' +
          '<button type="button" class="house3d-cam-btn" data-house-view="overview" aria-pressed="true">Genel</button>' +
          '<button type="button" class="house3d-cam-btn" data-house-view="salon" aria-pressed="false">Salon</button>' +
          '<button type="button" class="house3d-cam-btn" data-house-view="kitchen" aria-pressed="false">Mutfak</button>' +
          '<button type="button" class="house3d-cam-btn" data-house-view="bedroom" aria-pressed="false">Yatak Odası</button>' +
          '<button type="button" class="house3d-cam-btn" data-house-view="garden" aria-pressed="false">Bahçe</button>' +
          '<span class="house3d-sep" aria-hidden="true"></span>' +
          '<button type="button" class="house3d-cam-btn" id="house3dDayNightBtn" aria-pressed="false" title="Gündüz / Gece görünümü">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>' +
            '<span>Gündüz</span>' +
          '</button>' +
          '<button type="button" class="house3d-cam-btn" id="house3dResetBtn" title="Varsayılan kamera açısına dön" aria-label="Kamerayı sıfırla">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>';

    canvasEl = document.createElement('canvas');
    canvasEl.className = 'house3d-canvas';
    canvasEl.setAttribute('aria-label', '3D etkileşimli ev kesiti: döndürmek için sürükleyin, yakınlaştırmak için kaydırın');
    stageEl.insertBefore(canvasEl, stageEl.firstChild);

    fallbackEl = stageEl.querySelector('#house3dFallback');
    statusEl = stageEl.querySelector('#house3dStatusBadge');
    statusTextEl = stageEl.querySelector('#house3dStatusText');
    badgesEl = stageEl.querySelector('#house3dBadges');
    dayNightBtn = stageEl.querySelector('#house3dDayNightBtn');

    const toolbar = stageEl.querySelector('.house3d-toolbar');
    toolbar.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    toolbar.addEventListener('click', function (e) {
      const viewBtn = e.target.closest('[data-house-view]');
      if (viewBtn) {
        const key = viewBtn.getAttribute('data-house-view');
        focusPreset(key);
        return;
      }
      if (e.target.closest('#house3dDayNightBtn')) {
        toggleDayNight();
        return;
      }
      if (e.target.closest('#house3dResetBtn')) {
        focusPreset('overview');
      }
    });

    return stageEl;
  }

  function focusPreset(key) {
    const preset = CAMERA_PRESETS[key] || CAMERA_PRESETS.overview;
    activePreset = CAMERA_PRESETS[key] ? key : 'overview';
    if (stageEl) {
      stageEl.querySelectorAll('[data-house-view]').forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-house-view') === activePreset ? 'true' : 'false');
      });
    }
    if (controls) {
      if (activePreset === 'overview') controls.reset();
      else controls.flyTo(preset.pos, preset.target, 620);
    }
  }

  function syncSkyUi() {
    if (!stageEl || !dayNightBtn) return;
    const night = effects ? effects.isNightMode() : false;
    stageEl.dataset.sky = night ? 'night' : 'day';
    dayNightBtn.setAttribute('aria-pressed', night ? 'true' : 'false');
    const lbl = dayNightBtn.querySelector('span');
    if (lbl) lbl.textContent = night ? 'Gece' : 'Gündüz';
  }

  function toggleDayNight() {
    if (!effects) return;
    const next = !effects.isNightMode();
    effects.setNightOverride(next);
    syncSkyUi();
  }

  function updateHud(data, meta) {
    if (!statusEl || !statusTextEl || !badgesEl) return;
    const d = data || {};
    const m = meta || {};
    const online = !!m.online;
    const gs = m.state || d.state || 'normal';

    let level = 'ok';
    let text = 'Normal';
    if (!data && !online) {
      level = 'offline';
      text = 'Bağlantı bekleniyor';
    } else if (d.flame) {
      level = 'danger';
      text = 'Yangın / Alev algılandı';
    } else if (d.vib) {
      level = 'danger';
      text = 'Sarsıntı / Deprem alarmı';
    } else if (gs === 'danger') {
      level = 'danger';
      text = 'Gaz kaçağı (' + (Number(d.gasPpm) || 0) + ' PPM)';
    } else if (d.flood) {
      level = 'flood';
      text = 'Su baskını algılandı';
    } else if (gs === 'warning') {
      level = 'warn';
      text = 'Gaz uyarısı (' + (Number(d.gasPpm) || 0) + ' PPM)';
    } else if (!online) {
      level = 'offline';
      text = 'Önbellek / Çevrimdışı';
    }

    statusEl.setAttribute('data-level', level);
    statusTextEl.textContent = text;

    const tags = [];
    if (typeof d.window === 'number') {
      tags.push('Pencere ' + (d.window <= 5 ? 'Kapalı' : d.window + '°'));
    }
    if (typeof d.blind === 'number' && d.blind < 175) {
      tags.push('Panjur ' + (d.blind <= 5 ? 'Kapalı' : d.blind + '°'));
    }
    if (d.fan) tags.push('Fan Açık');
    if (d.pump) tags.push('Pompa Aktif');
    if (d.buzzer) tags.push('Siren Açık');
    if (d.rain && !d.flood) tags.push('Yağmur');

    badgesEl.replaceChildren();
    tags.slice(0, 4).forEach(function (t) {
      const span = document.createElement('span');
      span.className = 'house3d-tag';
      span.textContent = t;
      badgesEl.appendChild(span);
    });
  }

  function resize() {
    if (!renderer || !camera || !stageEl) return;
    const w = stageEl.clientWidth || 0;
    const h = stageEl.clientHeight || 0;
    if (w < 10 || h < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function shouldAnimate() {
    if (!booted || document.hidden || !isIntersecting) return false;
    const main = document.querySelector('[data-panel-view]');
    if (main && main.dataset.panelView && main.dataset.panelView !== 'hero') return false;
    return !!(currentSlot && currentSlot.offsetParent !== null);
  }

  function loop(ts) {
    if (!shouldAnimate()) {
      rafId = 0;
      return;
    }
    rafId = requestAnimationFrame(loop);

    const dt = lastFrameTs ? (ts - lastFrameTs) / 1000 : 0.016;
    lastFrameTs = ts;

    if (controls) controls.update();
    if (effects) {
      effects.update(dt, camera, reducedMotionEnabled());
    }
    renderer.render(scene, camera);
    if (effects && effects.clearCameraShake) {
      effects.clearCameraShake(camera);
    }
  }

  function startLoop() {
    if (rafId || !shouldAnimate()) return;
    lastFrameTs = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function consumePendingFocus() {
    try {
      const pending = window.sessionStorage && window.sessionStorage.getItem('deneyap_house3d_focus');
      if (pending) {
        window.sessionStorage.removeItem('deneyap_house3d_focus');
        if (CAMERA_PRESETS[pending]) focusPreset(pending);
      }
    } catch (e) { /* yoksay */ }
  }

  function syncMount() {
    const slot = findActiveSlot();
    if (!slot) return;
    buildStageDom();
    if (stageEl.parentNode !== slot) {
      slot.replaceChildren(stageEl);
    }
    currentSlot = slot;
    if (booted) {
      resize();
      syncSkyUi();
      consumePendingFocus();
      startLoop();
    }
  }

  function initObservers() {
    if ('ResizeObserver' in window && stageEl) {
      const ro = new ResizeObserver(function () {
        resize();
        startLoop();
      });
      ro.observe(stageEl);
    }

    if ('IntersectionObserver' in window && stageEl) {
      const io = new IntersectionObserver(function (entries) {
        isIntersecting = !!(entries[0] && entries[0].isIntersecting);
        if (isIntersecting) startLoop();
        else stopLoop();
      }, { threshold: 0.05 });
      io.observe(stageEl);
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopLoop();
      else startLoop();
    });

    document.addEventListener('deneyap:panel-view', function (e) {
      if (e && e.detail === 'hero') {
        resize();
        startLoop();
      } else {
        stopLoop();
      }
    });

    document.addEventListener('deneyap:mode', function (e) {
      if (effects && e && e.detail) {
        effects.setMode(e.detail.mode);
        syncSkyUi();
      }
    });

    if ('MutationObserver' in window) {
      const mo = new MutationObserver(function () {
        syncSkyUi();
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
  }

  async function init() {
    if (booted || loading) return;
    syncMount();
    if (!stageEl || !canvasEl) return;

    loading = true;
    try {
      THREE = await import(THREE_CDN);

      renderer = new THREE.WebGLRenderer({
        canvas: canvasEl,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      });
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      if (THREE.ACESFilmicToneMapping !== undefined) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.06;
      }
      if (THREE.SRGBColorSpace) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      }

      scene = new THREE.Scene();

      const w = stageEl.clientWidth || 600;
      const h = stageEl.clientHeight || 400;
      camera = new THREE.PerspectiveCamera(34, w / h, 0.25, 80);
      camera.position.set(-5.8, 4.85, 10.25);

      // Warm Mediterranean key sunlight + soft hemisphere ambient fill
      const hemiLight = new THREE.HemisphereLight(0xfff7e6, 0x5c7243, 1.02);
      scene.add(hemiLight);

      const sunLight = new THREE.DirectionalLight(0xfff1d8, 2.05);
      sunLight.position.set(-9.5, 13.5, 9.2);
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(1024, 1024);
      sunLight.shadow.camera.near = 2;
      sunLight.shadow.camera.far = 36;
      sunLight.shadow.camera.left = -9.5;
      sunLight.shadow.camera.right = 9.5;
      sunLight.shadow.camera.top = 9.5;
      sunLight.shadow.camera.bottom = -8.5;
      sunLight.shadow.bias = -0.0006;
      sunLight.shadow.normalBias = 0.025;
      scene.add(sunLight);

      const rimLight = new THREE.DirectionalLight(0xd9e8ff, 0.42);
      rimLight.position.set(10, 6.5, -7);
      scene.add(rimLight);

      lights = { hemi: hemiLight, sun: sunLight, rim: rimLight };

      lib = House3D.Textures.createLibrary(THREE);
      arch = House3D.buildArchitecture(THREE, lib);
      scene.add(arch.root);

      controls = House3D.createOrbitControls(THREE, camera, canvasEl);
      effects = House3D.createEffects(THREE, scene, arch, lib, lights);

      if (App.settings) {
        const s = App.settings();
        if (s && s.mode) effects.setMode(s.mode);
      }
      if (lastTelemetry) {
        effects.setState(lastTelemetry, lastMeta);
      }

      canvasEl.addEventListener('webglcontextlost', function (e) {
        e.preventDefault();
        stopLoop();
        if (fallbackEl) {
          fallbackEl.textContent = '3D WebGL bağlamı duraklatıldı.';
          fallbackEl.hidden = false;
        }
      });
      canvasEl.addEventListener('webglcontextrestored', function () {
        if (fallbackEl) fallbackEl.hidden = true;
        startLoop();
      });

      booted = true;
      loading = false;
      if (fallbackEl) fallbackEl.hidden = true;
      resize();
      syncSkyUi();
      consumePendingFocus();
      updateHud(lastTelemetry, lastMeta);
      initObservers();
      startLoop();
    } catch (err) {
      loading = false;
      console.warn('[house3d] 3D sahne başlatılamadı:', err);
      if (fallbackEl) {
        fallbackEl.textContent = '3D görünüm şu anda yüklenemedi (çevrimdışı veya WebGL devre dışı).';
        fallbackEl.hidden = false;
      }
    }
  }

  House3D.init = init;
  House3D.syncMount = syncMount;
  House3D.focusView = focusPreset;
  House3D.setNightMode = function (night) {
    if (!effects) return;
    effects.setNightOverride(!!night);
    syncSkyUi();
  };
  House3D.toggleDayNight = toggleDayNight;
  House3D.updateTelemetry = function (data, meta) {
    lastTelemetry = data || null;
    lastMeta = meta || lastMeta;
    if (effects) effects.setState(lastTelemetry, lastMeta);
    updateHud(lastTelemetry, lastMeta);
  };
  House3D.setMode = function (mode) {
    if (effects) {
      effects.setMode(mode);
      syncSkyUi();
    }
  };
  House3D.getState = function () {
    return {
      booted: booted,
      activePreset: activePreset,
      sky: stageEl ? stageEl.dataset.sky : 'day',
      statusText: statusTextEl ? statusTextEl.textContent : ''
    };
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
