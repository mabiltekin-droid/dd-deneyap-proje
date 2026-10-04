/* ==========================================================================
   app.js — Cyber-Console Ana Pano (Sensörler & Kontrol) Denetleyicisi
   - 20 Segmentli Cyber LED Gaz Göstergesi
   - Canlı Çalışan Dinamik Uptime Sayacı & Sinyal (RSSI) Çubukları
   - RAM/Heap İlerleme Çubuğu & Anlık Latency (Ping) Göstergesi
   - 3D Kart Eğim (Tilt), Yansıma (Glare), Parallaks ve Ripple Motoru
   - Ekran Kenarı Ambient Işık Darbesi & Web Audio / Haptik Geri Bildirim
   - Servo Hassas Açı Kaydırıcıları (0°–180°)
   ========================================================================== */

(function () {
  'use strict';

  const App = window.App;
  const $ = function (id) { return document.getElementById(id); };

  const STATE_LABEL = {
    normal:  'GÜVENDE',
    warning: 'UYARI',
    danger:  'TEHLİKE'
  };

  let pollTimer = null;
  let tickTimer = null;
  let failStreak = 0;
  let lastData = null;
  let lastUpdateTs = 0;
  let online = false;
  let pumpArmed = false;
  let pumpArmTimer = null;

  /* Canlı Uptime Takibi (Cihaz sorguları arasında saniye saniye artar) */
  let baseUptimeMs = 0;
  let baseUptimeStamp = 0;

  /* ------------------------------------------------------------ Yardımcılar */

  function clampPct(val, max) {
    const m = max || App.GAS_FS_MAX;
    return Math.max(0, Math.min(100, (Number(val) || 0) / m * 100));
  }

  function gasStateOf(data) {
    if (data && typeof data.state === 'string' && STATE_LABEL[data.state]) return data.state;
    const s = App.settings();
    const ppm = data ? Number(data.gasPpm) || 0 : 0;
    const dangerTh = (data && typeof data.gasDanger === 'number') ? data.gasDanger : Number(s.gasDanger);
    const warnTh = (data && typeof data.gasWarn === 'number') ? data.gasWarn : Number(s.gasWarn);
    if (ppm >= dangerTh) return 'danger';
    if (ppm >= warnTh) return 'warning';
    return 'normal';
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function setChip(id, state, text) {
    const el = $(id);
    if (!el) return;
    el.setAttribute('data-state', state);
    el.textContent = text;
  }

  /* --------------------------------------------------------------- Render */

  /* 20 Segmentli Cyber LED ve Enerji Barı Güncellemesi */
  function renderGas(data, state) {
    const s = App.settings();
    const ppm = Number(data.gasPpm) || 0;
    const warnTh = (data && typeof data.gasWarn === 'number') ? data.gasWarn : Number(s.gasWarn);
    const dangerTh = (data && typeof data.gasDanger === 'number') ? data.gasDanger : Number(s.gasDanger);

    setText('gasPpm', ppm.toLocaleString('tr-TR'));
    const rawTxt = 'ham: ' + (Number(data.gasRaw) || 0) + (data.gasFiltered !== undefined ? ' · filtre: ' + data.gasFiltered : '');
    setText('gasRaw', rawTxt);
    setText('gasBase', 'taban: ' + (Number(data.gasBase) || 0));

    const card = $('gasCard');
    if (card) card.setAttribute('data-state', state);

    /* Sürekli enerji çubuğu */
    const fill = $('gasFill');
    if (fill) fill.style.width = clampPct(ppm) + '%';

    setChip('gasChip', state, STATE_LABEL[state]);

    /* Donanım dinamik eşik işaretçileri */
    const warnMark = $('markWarn');
    const dangerMark = $('markDanger');
    if (warnMark) {
      warnMark.style.left = clampPct(warnTh) + '%';
      warnMark.title = 'Uyarı: ' + warnTh + ' PPM';
    }
    if (dangerMark) {
      dangerMark.style.left = clampPct(dangerTh) + '%';
      dangerMark.title = 'Tehlike: ' + dangerTh + ' PPM';
    }

    setText('labelWarn', warnTh + ' UYARI');
    setText('labelDanger', dangerTh + ' TEHLİKE');

    /* 20 Segmentli LED Matrisinin Aydınlatılması */
    const segments = document.querySelectorAll('#gasSegMeter .seg');
    if (segments.length) {
      const activeCount = Math.round((clampPct(ppm) / 100) * segments.length);
      const warnIndex = Math.round((clampPct(warnTh) / 100) * segments.length);
      const dangerIndex = Math.round((clampPct(dangerTh) / 100) * segments.length);

      segments.forEach(function (seg, idx) {
        seg.className = 'seg';
        if (idx < activeCount) {
          if (idx >= dangerIndex) seg.classList.add('active-danger');
          else if (idx >= warnIndex) seg.classList.add('active-warn');
          else seg.classList.add('active-normal');
        }
      });
    }
  }

  function renderRain(data) {
    const s = App.settings();
    const wet = (data && data.rainInvert !== undefined)
      ? !!data.rain
      : (s.rainInvert ? !data.rain : !!data.rain);

    setText('rainValue', wet ? 'ISLAK' : 'KURU');
    const rainTxt = 'ham: ' + (Number(data.rainRaw) || 0) + (data.rainFiltered !== undefined ? ' · filtre: ' + data.rainFiltered : '');
    setText('rainRaw', rainTxt);
    setChip('rainChip', wet ? 'wet' : 'normal', wet ? 'ISLAK' : 'KURU');

    const modeTxt = $('rainMode');
    if (modeTxt) {
      modeTxt.textContent = data.auto ? 'otomatik kapama: aktif' : 'otomatik kapama: kapalı';
    }
  }

  function renderSystem(data, state) {
    App.renderDeviceInfo(data);
    setChip('sysChip', state, STATE_LABEL[state]);

    /* Uptime sayacı için başlangıç referansını güncelle */
    if (typeof data.uptime === 'number') {
      baseUptimeMs = data.uptime;
      baseUptimeStamp = Date.now();
    }

    /* RSSI 4 Kademeli Sinyal SVG Çubuğu */
    const rssiSvg = $('rssiSvg');
    if (rssiSvg && typeof data.rssi === 'number') {
      let level = 1;
      if (data.rssi >= -60) level = 4;
      else if (data.rssi >= -70) level = 3;
      else if (data.rssi >= -82) level = 2;
      rssiSvg.setAttribute('data-level', String(level));
    }

    /* RAM / Heap Mini Bar */
    const heapFill = $('heapFill');
    if (heapFill && typeof data.heap === 'number') {
      // ESP32 toplam heap yaklaşık 320 KB civarındadır
      const pct = Math.max(5, Math.min(100, Math.round((data.heap / 320000) * 100)));
      heapFill.style.width = pct + '%';
    }

    /* Bağlı İstemci Sayısı */
    setText('clientCount', 'bağlı istemci: ' + (data.clients !== undefined ? data.clients : 1));

    const hint = $('controlHint');
    if (hint) hint.textContent = online ? '' : 'cihaz aranıyor…';
  }

  function renderOutlets(data) {
    const pairs = [
      ['fan', data.fan, 'fanState'],
      ['pump', data.pump, 'pumpState'],
      ['buzzer', data.buzzer, 'buzzerState'],
      ['auto', data.auto, 'autoState']
    ];

    pairs.forEach(function (p) {
      const btn = document.querySelector('.btn[data-device="' + p[0] + '"][data-action="toggle"]');
      const lbl = $(p[2]);
      const text = p[1] ? 'AÇIK' : 'KAPALI';
      if (lbl) lbl.textContent = text;
      if (btn) {
        if (pumpArmed && p[0] === 'pump') return; // Onay beklerken metni koru
        btn.classList.toggle('on', !!p[1]);
      }
    });

    /* Servolar: Açı kaydırıcılarını donanım pozisyonuyla senkronize et (kullanıcı çekmiyorsa) */
    if (typeof data.window === 'number' && !windowSliderActive) {
      const ws = $('windowSlider');
      if (ws) ws.value = data.window;
      setText('windowAngleVal', data.window + '°');
    }
    if (typeof data.blind === 'number' && !blindSliderActive) {
      const bs = $('blindSlider');
      if (bs) bs.value = data.blind;
      setText('blindAngleVal', data.blind + '°');
    }

    /* Hareket eden servoları vurgula */
    document.querySelectorAll('.btn[data-device="window"], .btn[data-device="blind"]')
      .forEach(function (b) {
        b.classList.toggle('armed', !!data.moving);
      });
  }

  /* Ambient Ekran Kenarı Darbesi & Sesli Uyarılar */
  function renderAmbientAlarm(state) {
    const glow = $('ambientGlow');
    if (glow) {
      glow.className = '';
      if (state === 'danger') {
        glow.classList.add('state-danger');
        App.sound.alarm();
        App.haptic(60);
      } else if (state === 'warning') {
        glow.classList.add('state-warning');
      }
    }
  }

  function renderBanner(state) {
    const el = $('banner');
    if (!el) return;
    if (state === 'danger') {
      el.className = 'banner danger';
      el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
        '<div><strong>KRİTİK TEHLİKE: Gaz Kaçağı Algılandı</strong>' +
        'Tahliye fanı tam güçte çalışıyor, su pompası kilitlendi ve pencere kapatıldı. Gaz vanasını kapatın ve ortamı tahliye edin.</div>';
      el.hidden = false;
    } else if (state === 'warning') {
      el.className = 'banner warn';
      el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
        '<div><strong>DİKKAT: Gaz Yoğunluğu Yükseliyor</strong>' +
        'Sensör değeri uyarı eşiğini aştı. Odanın havalandırılmasını sağlayın.</div>';
      el.hidden = false;
    } else if (online) {
      el.hidden = true;
    }
  }

  function render(data) {
    lastData = data;
    lastUpdateTs = Date.now();
    const state = gasStateOf(data);
    renderGas(data, state);
    renderRain(data);
    renderSystem(data, state);
    renderOutlets(data);
    renderAmbientAlarm(state);
    renderBanner(state);
    setControlsEnabled(true);
  }

  function setControlsEnabled(enabled) {
    document.querySelectorAll('.controls .btn, .servo-slider').forEach(function (b) {
      b.disabled = !enabled;
    });
  }

  /* ------------------------------------------------------- Bağlantı Durumu */

  function markOnline() {
    online = true;
    failStreak = 0;
    App.setConnBadge('live', 'Canlı Telemetri');
  }

  function markOffline(err) {
    online = false;
    failStreak += 1;
    const reason = err && err.legacy ? 'Eski Firmware'
                 : err && err.timeout ? 'Zaman Aşımı'
                 : 'Bağlantı Yok';
    App.setConnBadge('offline', reason);

    setControlsEnabled(false);
    setChip('sysChip', 'warning', 'BAĞLANTI YOK');
    setChip('gasChip', 'unknown', '—');
    setChip('rainChip', 'unknown', '—');

    const el = $('banner');
    if (el) {
      el.className = 'banner warn';
      el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
        '<div><strong>Cihaza Ulaşılamıyor</strong>' +
        'Cihazın açık ve "DeneyapEvGuvenlik" ağına bağlı olduğundan emin olun. ' +
        '<a href="./settings.html" style="color:var(--primary); font-weight:700;">Ayarları Kontrol Et</a></div>';
      el.hidden = false;
    }

    const hint = $('controlHint');
    if (hint) hint.textContent = 'bağlantı bekleniyor — kumandalar kilitli';
  }

  /* ------------------------------------------------------------- Polling */

  function nextDelay() {
    const base = Number(App.settings().pollMs) || 2000;
    if (failStreak === 0) return base;
    const steps = [base, base * 2, base * 4, 10000];
    return Math.min(10000, steps[Math.min(failStreak, steps.length - 1)]);
  }

  async function poll() {
    const t0 = performance.now();
    try {
      const data = await App.api.status();
      const latency = Math.round(performance.now() - t0);
      setText('pingMs', latency + ' ms');
      markOnline();
      render(data);
    } catch (err) {
      markOffline(err);
      if (err && err.legacy) {
        App.toast(err.message, { kind: 'danger', duration: 9000 });
      }
    } finally {
      schedule();
    }
  }

  function schedule() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, nextDelay());
  }

  /* ------------------------------------------------------------ Kumandalar */

  function disarmPump() {
    pumpArmed = false;
    clearTimeout(pumpArmTimer);
    const btn = document.querySelector('.btn[data-device="pump"][data-action="toggle"]');
    if (btn) btn.classList.remove('armed');
    if (lastData) {
      const lbl = $('pumpState');
      if (lbl) lbl.textContent = lastData.pump ? 'AÇIK' : 'KAPALI';
      if (btn) btn.classList.toggle('on', !!lastData.pump);
    }
  }

  async function send(device, action, value) {
    const btn = document.querySelector('.btn[data-device="' + device + '"][data-action="' + action + '"]');
    if (btn) btn.classList.add('is-busy');
    try {
      const data = await App.api.control(device, action, value);
      markOnline();
      render(data);
      App.sound.chime();
      App.haptic(25);
      if (device === 'pump' && action === 'on') App.toast('Su motoru çalıştırıldı', { kind: 'ok' });
      if (device === 'test' && action === 'simulate_alarm') App.toast('5 saniyelik alarm simülasyonu başlatıldı', { kind: 'warn' });
      if (action === 'set') App.toast(device === 'window' ? 'Pencere açısı güncellendi' : 'Panjur açısı güncellendi', { kind: 'ok' });
    } catch (err) {
      markOffline(err);
      App.sound.alarm();
      App.toast('Komut iletilemedi: ' + err.message, { kind: 'danger', duration: 7000 });
      setTimeout(poll, 1200);
    } finally {
      if (btn) btn.classList.remove('is-busy');
    }
  }

  function onControlClick(e) {
    const btn = e.target.closest('.btn[data-device]');
    if (!btn || btn.disabled) return;

    const device = btn.dataset.device;
    const action = btn.dataset.action;
    const value = btn.dataset.value;

    /* Su motoru kazara açılmasın diye 2 aşamalı dokunma onayı */
    if (device === 'pump' && action === 'toggle' && !pumpArmed) {
      pumpArmed = true;
      btn.classList.add('armed');
      btn.classList.remove('on');
      const lbl = $('pumpState');
      if (lbl) lbl.textContent = 'ONAYLA';
      App.toast('Su motorunu çalıştırmak için 6 saniye içinde tekrar basın', { kind: 'warn', duration: 4000 });
      App.sound.click();
      App.haptic(35);
      pumpArmTimer = setTimeout(disarmPump, 6000);
      return;
    }

    if (device === 'pump') disarmPump();

    send(device, action, value);
  }

  /* ---------------------------------------------------- Hassas Açı Kaydırıcıları */
  let windowSliderActive = false;
  let blindSliderActive = false;

  function setupServoSliders() {
    const wSlider = $('windowSlider');
    const wVal = $('windowAngleVal');
    const wBtn = $('applyWindowBtn');

    if (wSlider && wVal && wBtn) {
      wSlider.addEventListener('input', function () {
        windowSliderActive = true;
        wVal.textContent = wSlider.value + '°';
      });
      wSlider.addEventListener('change', function () {
        windowSliderActive = false;
      });
      wBtn.addEventListener('click', function () {
        windowSliderActive = false;
        send('window', 'set', Number(wSlider.value));
      });
    }

    const bSlider = $('blindSlider');
    const bVal = $('blindAngleVal');
    const bBtn = $('applyBlindBtn');

    if (bSlider && bVal && bBtn) {
      bSlider.addEventListener('input', function () {
        blindSliderActive = true;
        bVal.textContent = bSlider.value + '°';
      });
      bSlider.addEventListener('change', function () {
        blindSliderActive = false;
      });
      bBtn.addEventListener('click', function () {
        blindSliderActive = false;
        send('blind', 'set', Number(bSlider.value));
      });
    }
  }

  /* ----------------------------------------------------------------- Tema */

  function setupTheme() {
    App.applyTheme();
    const btn = $('themeToggleBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      const cur = App.settings().theme || 'dark';
      const next = (cur === 'dark' || cur === 'amoled') ? 'light' : 'dark';
      App.saveSettings({ theme: next });
      App.applyTheme(next);
      App.sound.click();
      App.haptic(20);
    });
    App.onSystemThemeChange(function () { /* Otomatik güncellendi */ });
  }

  /* ------------------------------------------------- Service Worker Akışı */

  function setupServiceWorker() {
    App.onUpdateReady = function (reg) {
      App.toast('Konsolun yeni sürümü hazır', {
        kind: 'ok',
        sticky: true,
        actionLabel: 'Yenile',
        onAction: function () {
          App.reloadOnControllerChange();
          App.activateUpdate(reg);
        }
      });
    };
    App.registerServiceWorker();
  }

  /* ---------------------------------------------------- Canlı Uptime Sayacı */

  function startTicker() {
    clearInterval(tickTimer);
    tickTimer = setInterval(function () {
      if (lastUpdateTs) {
        setText('lastUpdate', 'son veri: ' + App.fmtAgo(lastUpdateTs));
      }
      if (baseUptimeMs > 0 && online) {
        const liveUptime = baseUptimeMs + (Date.now() - baseUptimeStamp);
        setText('uptime', App.fmtDuration(liveUptime));
      }
    }, 1000);
  }

  /* ------------------------------------------------------------- Başlatma */

  function init() {
    setupTheme();
    setupServiceWorker();
    setupServoSliders();
    startTicker();

    App.init3DTilt();
    App.initParallax();
    App.initRipple();

    const controls = document.querySelector('.controls');
    if (controls) controls.addEventListener('click', onControlClick);

    setControlsEnabled(false);
    App.setConnBadge('connecting', 'Bağlanıyor…');
    poll();

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        clearTimeout(pollTimer);
      } else {
        clearTimeout(pollTimer);
        poll();
      }
    });

    window.addEventListener('pagehide', function () {
      if (lastData && lastData.pump) disarmPump();
    });

    console.info('%c[Deneyap Ev Koruma] Cyber-Console v' + App.VERSION + ' devrede',
      'color:#38bdf8;font-weight:bold;font-size:12px');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();