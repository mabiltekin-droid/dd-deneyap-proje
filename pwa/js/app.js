/* ==========================================================================
   app.js — ana panel (Sensörler) denetleyicisi.
   Sorumluluklar: periyodik durum çekme, arayüzü güncelleme, kumandaları
   cihaza iletme, bağlantı kesintisinde kademeli bekleyip uyarı gösterme.
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
  let prevGasState = 'unknown';   // bildirim sadece durum değişiminde gitsin

  /* ------------------------------------------------------------ yardımcılar */

  function clampPct(ppm) {
    const max = App.GAS_FS_MAX;
    return Math.max(0, Math.min(100, (Number(ppm) || 0) / max * 100));
  }

  function gasStateOf(data) {
    /* Cihaz kendi histerezisli durumunu bildiriyorsa ona güven;
       bildirmiyorsa panel eşikleriyle tahmin et. */
    if (data && typeof data.state === 'string' && STATE_LABEL[data.state]) return data.state;
    const s = App.settings();
    const ppm = data ? Number(data.gasPpm) || 0 : 0;
    if (ppm >= Number(s.gasDanger)) return 'danger';
    if (ppm >= Number(s.gasWarn)) return 'warning';
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

  /* --------------------------------------------------------------- render */

  function renderGas(data, state) {
    const s = App.settings();
    const ppm = Number(data.gasPpm) || 0;

    setText('gasPpm', ppm.toLocaleString('tr-TR'));
    setText('gasRaw', 'ham: ' + (Number(data.gasRaw) || 0));
    setText('gasBase', 'taban: ' + (Number(data.gasBase) || 0));

    const card = $('gasCard');
    if (card) card.setAttribute('data-state', state);

    const fill = $('gasFill');
    if (fill) fill.style.width = clampPct(ppm) + '%';

    setChip('gasChip', state, STATE_LABEL[state]);

    /* Eşik işaretlerini panel ayarına göre konumlandır */
    const warnMark = $('markWarn');
    const dangerMark = $('markDanger');
    if (warnMark) warnMark.style.left = clampPct(s.gasWarn) + '%';
    if (dangerMark) dangerMark.style.left = clampPct(s.gasDanger) + '%';
  }

  function renderRain(data) {
    const s = App.settings();
    const wet = s.rainInvert ? !data.rain : !!data.rain;
    setText('rainValue', wet ? 'IŞLAK' : 'KURU');
    setText('rainRaw', 'ham: ' + (Number(data.rainRaw) || 0));
    setChip('rainChip', wet ? 'wet' : 'normal', wet ? 'IŞLAK' : 'KURU');
  }

  function renderSystem(data, state) {
    App.renderDeviceInfo(data);
    setChip('sysChip', state, STATE_LABEL[state]);

    const hint = $('controlHint');
    if (hint) hint.textContent = online ? '' : 'bağlantı bekleniyor…';
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
        if (pumpArmed && p[0] === 'pump') return;      /* onay beklerken metni bozma */
        btn.classList.toggle('on', !!p[1]);
      }
    });

    /* Hareket eden servoları geçici olarak vurgula */
    document.querySelectorAll('.btn[data-device="window"], .btn[data-device="blind"]')
      .forEach(function (b) {
        b.classList.toggle('armed', !!data.moving);
      });
  }

  function renderBanner(state) {
    const el = $('banner');
    if (!el) return;
    if (state === 'danger') {
      el.className = 'banner danger';
      el.innerHTML = '<strong>Tehlike: gaz algılandı</strong>' +
        'Fan açıldı, su motoru kilitlendi. Cihazı tahliye edin ve gaz kaynağını kapatın.';
      el.hidden = false;
    } else if (state === 'warning') {
      el.className = 'banner warn';
      el.innerHTML = '<strong>Uyarı: gaz seviyesi yükseliyor</strong>' +
        'Değer eşiğe yaklaşıyor. Odanın havalandırılmasını sağlayın.';
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
    renderBanner(state);
    setControlsEnabled(true);
    checkAlert(state, data.gasPpm);
    if (App.history) App.history.update(data);
  }

  /* Seviye değiştiğinde tek seferlik bildirim gönder.
     Aynı seviyede kalınca (ölçüm 2 sn'de bir geliyor) tekrar gönderilmez;
     bunun için App.notify kendi bekleme süresini tutar. */
  function checkAlert(state, ppm) {
    if (!App.notify) return;
    if (state === 'normal') {
      App.notify.reset();
      prevGasState = state;
      return;
    }
    if (state === prevGasState) return;
    /* sadece yükseliş yönünde bildir: tehlike -> uyarı geri dönüşünde
       ikinci bir bildirim spam olur */
    const yukseliyor = prevGasState === 'normal' ||
                       (prevGasState === 'warning' && state === 'danger');
    if (yukseliyor) App.notify.alert(state, ppm);
    prevGasState = state;
  }

  function setControlsEnabled(enabled) {
    document.querySelectorAll('.controls .btn').forEach(function (b) {
      b.disabled = !enabled;
    });
  }

  /* ------------------------------------------------------- bağlantı durumu */

  function markOnline() {
    online = true;
    failStreak = 0;
    App.setConnBadge('live', 'Bağlantı canlı');
  }

  function markOffline(err) {
    online = false;
    failStreak += 1;
    const reason = err && err.legacy ? 'eski firmware'
                 : err && err.timeout ? 'zaman aşımı'
                 : 'bağlantı yok';
    App.setConnBadge('offline', reason);

    setControlsEnabled(false);
    setChip('sysChip', 'warning', 'BAĞLANTI YOK');
    setChip('gasChip', 'unknown', '—');
    setChip('rainChip', 'unknown', '—');

    const el = $('banner');
    if (el) {
      el.className = 'banner warn';
      el.innerHTML = '<strong>Cihaza ulaşılamıyor</strong>' +
        'Son okunan değerler gösteriliyor olabilir. Cihaz açık ve aynı ağda mı? ' +
        '<a href="./settings.html">Ayarlar</a>';
      el.hidden = false;
    }

    const hint = $('controlHint');
    if (hint) hint.textContent = 'bağlantı yok — kumandalar kilitli';
  }

  /* ------------------------------------------------------------- polling */

  function nextDelay() {
    const base = Number(App.settings().pollMs) || 2000;
    if (failStreak === 0) return base;
    /* Bağlantı yokken kademeli olarak uza: 2s -> 5s -> 10s (tavan) */
    const steps = [base, base * 2.5, base * 5, 10000];
    return Math.min(10000, steps[Math.min(failStreak, steps.length - 1)]);
  }

  async function poll() {
    try {
      const data = await App.api.status();
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

  /* ------------------------------------------------------------ kumandalar */

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

  async function send(device, action) {
    const btn = document.querySelector('.btn[data-device="' + device + '"][data-action="' + action + '"]');
    if (btn) btn.classList.add('is-busy');
    try {
      const data = await App.api.control(device, action);
      markOnline();
      render(data);
      if (device === 'pump' && action === 'on') App.toast('Su motoru çalıştırıldı', { kind: 'ok' });
    } catch (err) {
      markOffline(err);
      App.toast('Komut gönderilemedi: ' + err.message, { kind: 'danger', duration: 7000 });
      /* Yeniden bağlantı kurulunca kısa süre içinde tekrar dene */
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

    /* Su motoru: kazara çalıştırmayı önlemek için iki aşamalı onay */
    if (device === 'pump' && action === 'toggle' && !pumpArmed) {
      pumpArmed = true;
      btn.classList.add('armed');
      btn.classList.remove('on');
      const lbl = $('pumpState');
      if (lbl) lbl.textContent = 'ONAYLA';
      App.toast('Su motoru 6 saniye içinde tekrar basılırsa çalışır', { duration: 4000 });
      pumpArmTimer = setTimeout(disarmPump, 6000);
      return;
    }

    if (device === 'pump') disarmPump();

    if (action === 'stop') {
      send(device, action);
      return;
    }
    send(device, action);
  }

  /* ----------------------------------------------------------------- tema */

  function setupTheme() {
    App.applyTheme();
    const btn = $('themeToggleBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      const next = App.isDark() ? 'light' : 'dark';
      App.saveSettings({ theme: next });
      App.applyTheme(next);
    });
    App.onSystemThemeChange(function () { /* DOM zaten güncellendi */ });
  }

  /* ------------------------------------------------- Service Worker akışı */

  function setupServiceWorker() {
    App.onUpdateReady = function (reg) {
      App.toast('Yeni sürüm indirildi', {
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

  /* ------------------------------------------------------------- başlatma */

  function startTicker() {
    clearInterval(tickTimer);
    tickTimer = setInterval(function () {
      if (lastUpdateTs) setText('lastUpdate', 'son güncelleme: ' + App.fmtAgo(lastUpdateTs));
    }, 1000);
  }

  function init() {
    setupTheme();
    setupServiceWorker();
    startTicker();

    const controls = document.querySelector('.controls');
    if (controls) controls.addEventListener('click', onControlClick);

    setControlsEnabled(false);
    App.setConnBadge('connecting', 'Bağlanıyor…');
    poll();

    /* Sekme arka plana alınınca boşuna istek atma */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        clearTimeout(pollTimer);
        if (App.history) App.history.flush();
      } else {
        clearTimeout(pollTimer);
        poll();
      }
    });

    /* Panelden ayrılırken su motoru kazara çalışmasın diye uyar */
    window.addEventListener('pagehide', function () {
      if (lastData && lastData.pump) disarmPump();
      if (App.history) App.history.flush();
    });

    /* Geçmiş grafiğini elle temizleme */
    const clearBtn = $('historyClearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (!App.history) return;
        App.history.clear();
        App.toast('Geçmiş temizlendi');
      });
    }

    console.info('%c[Deneyap Ev Koruma] pano v' + App.VERSION,
      'color:#2f6feb;font-weight:bold');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* F12 teşhis aracı — artık gerçek durumu okuyabilir */
  window.DeneyapDebug = {
    version: 'v' + App.VERSION,
    get settings() { return App.settings(); },
    get lastStatus() { return lastData; },
    checkEnvironment: function () {
      const g = console.groupCollapsed
        ? console.groupCollapsed.bind(console)
        : console.log.bind(console);
      g('%c[Deneyap Ev Koruma] teşhis', 'color:#2f6feb;font-weight:bold;font-size:13px');
      console.log('Sürüm      :', this.version);
      console.log('Panel adresi:', location.href);
      console.log('Cihaz tabanı:', App.baseUrl());
      console.log('Ayar        :', this.settings);
      console.log('Son durum   :', lastData);
      console.log('Bağlantı    :', online ? 'canlı' : 'yok');

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function (regs) {
          console.log('Service Worker kayıt sayısı:', regs.length);
          regs.forEach(function (r) {
            console.log('  scope:', r.scope, '| durum:', r.active && r.active.state);
            if (r.waiting) console.warn('  Bekleyen yeni sürüm var — panelde "Yenile" bildirimi görünmeli.');
          });
        });
      } else {
        console.warn('Service Worker desteklenmiyor.');
      }

      if (window.caches) {
        caches.keys().then(function (keys) {
          console.log('Cache adları:', keys.length ? keys : '(yok)');
        });
      }
      console.groupEnd();
    },
    refresh: function () { poll(); },
    send: function (device, action) { return send(device, action); },
    history: function () { return App.history ? App.history.stats() : null; },
    clearHistory: function () { if (App.history) App.history.clear(); },
    notify: function () {
      return {
        destekli: App.notify ? App.notify.supported() : false,
        izin: App.notify ? App.notify.permission() : 'yok',
        acik: App.notify ? App.notify.isOn() : false,
        iOS: App.notify ? App.notify.isIOS : false,
        anaEkran: App.notify ? App.notify.isStandalone : false
      };
    }
  };
})();