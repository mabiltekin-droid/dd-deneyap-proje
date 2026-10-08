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

  /* Canlı Telemetri DSP Dalga Tamponu */
  const telemetryHistory = {
    raw: [],
    filt: [],
    maxPoints: 16
  };

  function updateTelemetryWave(rawVal, filtVal) {
    telemetryHistory.raw.push(rawVal);
    telemetryHistory.filt.push(filtVal);
    if (telemetryHistory.raw.length > telemetryHistory.maxPoints) {
      telemetryHistory.raw.shift();
      telemetryHistory.filt.shift();
    }

    const rawPath = $('gasRawWave');
    const filtPath = $('gasFiltWave');
    if (!rawPath || !filtPath) return;

    const count = telemetryHistory.raw.length;
    if (count < 2) return;

    let min = Infinity, max = -Infinity;
    for (let i = 0; i < count; i++) {
      if (telemetryHistory.raw[i] < min) min = telemetryHistory.raw[i];
      if (telemetryHistory.filt[i] < min) min = telemetryHistory.filt[i];
      if (telemetryHistory.raw[i] > max) max = telemetryHistory.raw[i];
      if (telemetryHistory.filt[i] > max) max = telemetryHistory.filt[i];
    }
    const span = Math.max(16, max - min);
    const mid = (max + min) / 2;
    const stepX = 320 / (count - 1);

    let dRaw = '', dFilt = '';
    for (let i = 0; i < count; i++) {
      const x = (i * stepX).toFixed(1);
      const yRaw = (20 - ((telemetryHistory.raw[i] - mid) / span) * 15).toFixed(1);
      const yFilt = (20 - ((telemetryHistory.filt[i] - mid) / span) * 15).toFixed(1);
      dRaw += (i === 0 ? 'M' : 'L') + x + ',' + yRaw + ' ';
      dFilt += (i === 0 ? 'M' : 'L') + x + ',' + yFilt + ' ';
    }
    rawPath.setAttribute('d', dRaw.trim());
    filtPath.setAttribute('d', dFilt.trim());
  }

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
    const rawVal = Number(data.gasRaw) || 0;
    const filtVal = (data.gasFiltered !== undefined) ? Number(data.gasFiltered) : rawVal;
    const rawTxt = 'ham: ' + rawVal + (data.gasFiltered !== undefined ? ' · filtre: ' + filtVal : '');
    setText('gasRaw', rawTxt);
    setText('gasBase', 'taban: ' + (Number(data.gasBase) || 0));

    /* Canlı Telemetri Osiloskop & DSP Delta Rozeti */
    const diff = Math.abs(rawVal - filtVal);
    const deltaBadge = $('gasDeltaBadge');
    if (deltaBadge) {
      deltaBadge.textContent = 'Δ ' + diff.toFixed(0) + ' PPM';
      if (diff > 25) {
        deltaBadge.setAttribute('data-state', 'warn');
      } else {
        deltaBadge.removeAttribute('data-state');
      }
    }
    if (!App.Tier || !App.Tier.isLow()) {
      updateTelemetryWave(rawVal, filtVal);
    }

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
    /* Firmware yağmur terslemesini zaten kendisi uygulayıp "rain" alanını
       son hâliyle gönderiyor (main.ino: rainWet = rainInvert ? ... : ...),
       status JSON'u da her zaman "rainInvert" içeriyor. Eski koddaki
       "rainInvert gelmemişse yerel ayarla tersle" dalı hiçbir firmware
       sürümünde erişilemiyordu; "s" değişkeni de yalnızca onun için
       tanımlanmıştı. */
    const wet = !!(data && data.rain);

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
    document.body.classList.toggle('state-danger', state === 'danger');
    document.body.setAttribute('data-state', state);

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

  /* Kumandalar yalnızca cihaz gerçekten yanıt verebiliyorsa açık olsun:
     saklanmış durum mesajı gelse bile LWT "çevrimdışı" diyorsa tuşlar
     kapalı kalmalıdır.
     Ek koşul (münhasırlık): cihaz bir hesaba bağlanmışsa yalnız sahibi
     veya admin kumanda gönderebilir; başkası görünüm alır ama kilitlidir. */
  function controlsAllowed() {
    if (App.api.transport() && App.deviceOnline === false) return false;
    if (App.Auth && App.Auth.bindingOf && lastData && lastData.dev) {
      if (!App.Auth.canControl(lastData.dev)) return false;
    }
    return true;
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
    renderWidget(data, state);
    renderLockHint();
    setControlsEnabled(controlsAllowed());
  }

  /* Cihaz başka hesaba bağlıysa kumanda bölgesinde açıklayıcı not. */
  function renderLockHint() {
    const hint = document.getElementById('controlHint');
    if (!hint) return;
    const locked = lastData && lastData.dev &&
                   App.Auth && App.Auth.bindingOf &&
                   !App.Auth.canControl(lastData.dev);
    hint.textContent = locked
      ? 'Bu cihaz başka bir hesaba bağlı — kumanda kilitli (Ayarlar → Hesap).'
      : '';
  }

  /* ------------------------------------------- Ana ekran özeti (widget) -- */
  /* Sayfanın en başında duran kompakt şerit: telefonda ana ekrana eklenen
     PWA'da ilk görülan yer burasıdır. Karmaşık grafikler yerine yalnızca
     dört değer ve tek satırlık durum gösterir. */
  const W_STATE = {
    unknown: 'Bağlanıyor',
    offline: 'Cihaz çevrimdışı',
    danger: 'GAZ TEHLİKESİ',
    warning: 'Gaz uyarısı',
    normal: 'Güvende'
  };

  function renderWidget(data, state) {
    const el = document.getElementById('homeWidget');
    if (!el) return;

    let st = 'unknown';
    if (App.api.transport() && App.deviceOnline === false) st = 'offline';
    else if (state === 'danger') st = 'danger';
    else if (state === 'warning') st = 'warning';
    else if (state === 'normal') st = 'normal';

    let label = W_STATE[st];

    /* Sel, gazdan bağımsız ve daha acildir. */
    if (data && data.flood && st !== 'offline') {
      st = 'danger';
      label = 'SEL TEHLİKESİ';
    } else if (data && data.gasFault && st !== 'offline') {
      /* ppm okunamıyor; "0 = temiz" dememek için ayrıca söylenir. */
      st = 'warning';
      label = 'Gaz sensörü arızalı';
    }

    el.dataset.state = st;
    setText('wState', label);
    setText('wSince', (data && data.dev) ? String(data.dev) : '');

    const ppm = Number(data && data.gasPpm) || 0;
    setText('wGas', data && data.gasFault ? 'okunamıyor'
      : ppm.toLocaleString('tr-TR') + ' ppm');
    setText('wRain', '%' + (Number(data && data.rainPct) || 0));

    const wp = Number(data && data.window);
    setText('wWindow', isNaN(wp) ? '—'
      : (wp > 150 ? 'Açık' : (wp > 30 ? 'Ayar' : 'Kapalı')));

    if (lastUpdateTs) setText('wAge', App.fmtAgo(lastUpdateTs));
  }

  function setControlsEnabled(enabled) {
    document.querySelectorAll('.controls .btn, .servo-slider').forEach(function (b) {
      b.disabled = !enabled;
    });
  }

  /* ------------------------------------------------------- Bağlantı Durumu */

  function markOnline() {
    /* Durum mesajı tek başına "canlı" kanıtı DEĞİLDİR: saklanmış (retained)
       paket, cihaz koptuktan sonra da broker'da kalır ve panele taze
       veri gibi gelir. Cihazın gerçekten bağlı olduğunu LWT (/online
       konusu) söyler; o "çevrimdışı" dediyse hiçbir durum mesajı rozeti
       "Canlı Telemetri"ye çeviremez. */
    if (App.api.transport() && App.deviceOnline === false) return;
    online = true;
    failStreak = 0;
    App.setConnBadge('live', 'Canlı Telemetri');
  }

  function markOffline(err) {
    online = false;
    failStreak += 1;
    const reason = err && err.legacy ? 'Eski Firmware'
                 : err && err.timeout ? 'Zaman Aşımı'
                 : App.api.transport() && App.deviceOnline === false ? 'Cihaz Çevrimdışı'
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

  /* --- MQTT modu: itme tabanlı -------------------------------------------
     Yayıncı üzerinden durum her geldiğinde anında çizilir; periyodik
     yoklama yapılmaz. Polling yalnızca "cihaz hâlâ konuşuyor mu" denetimi
     ve tekrar bağlanma tetikleyicisi olarak kalır. */
  let pushUnsubs = [];

  function startPush() {
    pushUnsubs.forEach(function (u) { try { u(); } catch (e) {} });
    pushUnsubs = [];

    pushUnsubs.push(
      App.api.onStatus(function (msg) {
        if (!msg || msg.__relay || msg.__device) return;  /* bağlantı olayları ayrı ele alınır */
        const at = Date.now();
        if (lastData && Number(msg.t) && Number(msg.t) <= Number(lastData.t) &&
            Number(msg.uptime) <= Number(lastData.uptime)) return;  /* eski kopyayı yut */
        setText('pingMs', Math.max(0, Date.now() - at + (msg.__rtt || 0)) + ' ms');
        lastData = msg;
        markOnline();
        render(msg);
      }),
      App.api.onStatus(function (msg) {
        if (!msg || !msg.__relay || msg.online) return;
        failStreak += 1;
        App.setConnBadge('offline', msg.msg || 'Bağlantı Yok');
        setControlsEnabled(false);
      }),
      App.api.onStatus(function (msg) {
        if (!msg || !msg.__device || msg.online) return;
        failStreak += 1;
        App.setConnBadge('offline', msg.msg || 'Cihaz Çevrimdışı');
        setControlsEnabled(false);
      })
    );

    App.api.startMqtt();
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
      /* Cihazın kendisi reddetti (HTTP 4xx/5xx ya da MQTT cmdErr) ile
         bağlantının kopması AYNI ŞEY DEĞİLDİR. Eski kod her hatada
         markOffline() çağırıyordu; pompa gaz alarmında 409 döndüğünde
         panel "Cihaza Ulaşılamıyor" deyip tüm kumandaları kilitliyordu. */
      const rejected = !!(err && (typeof err.status === 'number' || err.device));
      if (rejected) {
        App.sound.alarm();
        App.toast('Komut reddedildi: ' + err.message, { kind: 'warn', duration: 7000 });
      } else {
        markOffline(err);
        App.sound.alarm();
        App.toast('Komut iletilemedi: ' + err.message, { kind: 'danger', duration: 7000 });
      }
      /* İzlenen zamanlayıcıyı kullan: setTimeout(poll, ...) pollTimer
         dışında bir sayaç yaratıyor ve iki ayrı yoklama döngüsüne
         yol açabiliyordu. */
      clearTimeout(pollTimer);
      pollTimer = setTimeout(poll, 1200);
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
        setText('wAge', App.fmtAgo(lastUpdateTs));
      }
      if (baseUptimeMs > 0 && online) {
        const liveUptime = baseUptimeMs + (Date.now() - baseUptimeStamp);
        setText('uptime', App.fmtDuration(liveUptime));
      }
    }, 1000);
  }

  /* ------------------------------------------------------------- Hesap */

  /* Başlıktaki "Hesap" rozeti + cihaz mülkiyeti bilgisi. */
  function setupAccountPill() {
    const btn = document.getElementById('accountBtn');
    const txt = document.getElementById('accountBtnText');
    if (!App.Auth) return;

    function paint(snap) {
      if (!btn || !txt) return;
      if (snap.setupRequired) { btn.dataset.state = ''; txt.textContent = 'Kurulum'; return; }
      if (snap.isAdmin) { btn.dataset.state = 'admin'; txt.textContent = 'Admin'; return; }
      if (snap.signedIn) {
        btn.dataset.state = 'user';
        txt.textContent = ((snap.user && snap.user.email) || 'Hesap').split('@')[0];
        return;
      }
      btn.dataset.state = '';
      txt.textContent = 'Hesap';
    }

    App.Auth.onChange(paint);
    App.Auth.init().then(async function (snap) {
      paint(snap);
      try { await App.Auth.listBindings(); } catch (e) { /* şema yoksa sessiz */ }
      paint(App.Auth.snapshot());
      if (lastData) render(lastData);
    }).catch(function () { paint(App.Auth.snapshot()); });
  }

  /* ------------------------------------------------------------- Başlatma */

  function destroy() {
    clearTimeout(pollTimer);
    clearInterval(tickTimer);
    pollTimer = null;
    tickTimer = null;
    online = false;
    pushUnsubs.forEach(function (u) { try { u(); } catch (e) {} });
    pushUnsubs = [];
    if (lastData && lastData.pump) disarmPump();
  }

  function init() {
    destroy();
    if (!$('homeWidget')) return;
    setupTheme();
    setupServiceWorker();
    App.setupPwaInstall();
    setupServoSliders();
    setupAccountPill();
    startTicker();

    if (App.init3DTilt) App.init3DTilt();
    if (App.initParallax) App.initParallax();
    if (App.initRipple) App.initRipple();
    if (App.initHistory) App.initHistory();

    const controls = document.querySelector('.controls');
    if (controls) controls.addEventListener('click', onControlClick);

    setControlsEnabled(false);
    App.setConnBadge('connecting', 'Bağlanıyor…');

    if (App.api.transport()) {
      startPush();
      poll();               /* ilk durumu iste; sonrası yayıncıdan gelir */
    } else {
      poll();
    }

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

  window.App.initDashboard = init;
  window.App.destroyDashboard = destroy;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if ($('homeWidget')) init();
    });
  } else {
    if ($('homeWidget')) init();
  }
})();