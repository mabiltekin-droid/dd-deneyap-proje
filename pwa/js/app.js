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
  let sndVolumeActive = false;
  let prevAlarm = { danger: false, warn: false, flood: false, vib: false, flame: false };
  /* Sistem bildirimi için ayrı kenar-durumu: sesli anons kapalıyken de
     (App.voice yoksa announceAlarms erken döner) bildirim üretilebilsin. */
  let prevNotify = { danger: false, warn: false, flood: false, vib: false, flame: false };

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

  /* Reaktif Aktüatör Radyal Geri Sayım Parametreleri (config.h) */
  const FAN_AUTO_OFF_MS = 120000;  // 120 saniye otomatik kapanma
  const PUMP_MAX_RUN_MS = 300000;  // 300 saniye (5 dk) taşma koruması
  let fanStartTime = null;
  let pumpStartTime = null;

  function updateSnrSpectrum() {
    const n = telemetryHistory.raw.length;
    if (n < 2) return;

    const diffs = [];
    let sumDiff = 0;
    for (let i = 0; i < n; i++) {
      const d = telemetryHistory.raw[i] - telemetryHistory.filt[i];
      diffs.push(d);
      sumDiff += d;
    }
    const meanDiff = sumDiff / n;
    let varSum = 0;
    for (let i = 0; i < n; i++) {
      const dev = diffs[i] - meanDiff;
      varSum += dev * dev;
    }
    const variance = varSum / n;
    const stdDev = Math.sqrt(variance);

    // SNR Değeri (dB cinsinden telemetri netliği)
    const snrDb = Math.max(15, Math.min(99, Math.round(98 - stdDev * 2.6)));

    const badge = $('snrBadge');
    if (badge) {
      if (stdDev < 3.0) {
        badge.setAttribute('data-state', 'ok');
        badge.textContent = 'SNR: ' + snrDb + ' dB · STABİL';
      } else if (stdDev < 10.0) {
        badge.setAttribute('data-state', 'noisy');
        badge.textContent = 'SNR: ' + snrDb + ' dB · PARAZİT';
      } else {
        badge.setAttribute('data-state', 'critical');
        badge.textContent = 'SNR: ' + snrDb + ' dB · YÜKSEK GÜRÜLTÜ';
      }
    }

    const barFills = document.querySelectorAll('#snrBars .snr-bar-fill');
    if (barFills && barFills.length) {
      const baseHeight = Math.min(100, Math.max(8, stdDev * 4.8));
      barFills.forEach(function (bar, idx) {
        const sliceIdx = Math.floor((idx / barFills.length) * n);
        const localDelta = Math.abs(diffs[sliceIdx] || 0);
        const jitter = Math.sin(idx * 1.6 + n) * 6;
        const h = Math.max(8, Math.min(100, Math.round(baseHeight + localDelta * 2.2 + jitter)));
        bar.style.height = h + '%';
        if (stdDev >= 10.0) {
          bar.style.background = 'linear-gradient(to top, #ef4444, #f59e0b)';
        } else if (stdDev >= 3.0) {
          bar.style.background = 'linear-gradient(to top, #f59e0b, #eab308)';
        } else {
          bar.style.background = 'linear-gradient(to top, #10b981, #00e5ff)';
        }
      });
    }
  }

  function tickActuatorRings() {
    const CIRCUMFERENCE = 276.46;

    // 1. Fan Geri Sayım Halkası (120 saniye)
    const fanCircle = $('fanRingCircle');
    const fanBadge = $('fanTimeBadge');
    if (fanCircle && fanBadge) {
      if (lastData && lastData.fan && fanStartTime) {
        const elapsed = Date.now() - fanStartTime;
        const remaining = Math.max(0, FAN_AUTO_OFF_MS - elapsed);
        const fraction = remaining / FAN_AUTO_OFF_MS;
        const offset = CIRCUMFERENCE * (1 - fraction);
        fanCircle.style.strokeDashoffset = offset.toFixed(1);
        fanBadge.textContent = Math.ceil(remaining / 1000) + 's';
        fanBadge.hidden = false;
      } else {
        fanCircle.style.strokeDashoffset = CIRCUMFERENCE.toString();
        fanBadge.hidden = true;
      }
    }

    // 2. Su Motoru Taşma Koruması (300 saniye = 5 dakika)
    const pumpCircle = $('pumpRingCircle');
    const pumpBadge = $('pumpTimeBadge');
    if (pumpCircle && pumpBadge) {
      if (lastData && lastData.pump && pumpStartTime) {
        const elapsed = Date.now() - pumpStartTime;
        const remaining = Math.max(0, PUMP_MAX_RUN_MS - elapsed);
        const fraction = remaining / PUMP_MAX_RUN_MS;
        const offset = CIRCUMFERENCE * (1 - fraction);
        pumpCircle.style.strokeDashoffset = offset.toFixed(1);
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        pumpBadge.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
        pumpBadge.hidden = false;
      } else {
        pumpCircle.style.strokeDashoffset = CIRCUMFERENCE.toString();
        pumpBadge.hidden = true;
      }
    }
  }

  function updateActuatorTimers(data) {
    if (!data) return;
    if (data.fan) {
      if (!fanStartTime) fanStartTime = Date.now();
    } else {
      fanStartTime = null;
    }

    if (data.pump) {
      if (!pumpStartTime) pumpStartTime = Date.now();
    } else {
      pumpStartTime = null;
    }

    tickActuatorRings();
  }

  function updateTelemetryWave(rawVal, filtVal) {
    telemetryHistory.raw.push(rawVal);
    telemetryHistory.filt.push(filtVal);
    if (telemetryHistory.raw.length > telemetryHistory.maxPoints) {
      telemetryHistory.raw.shift();
      telemetryHistory.filt.shift();
    }

    updateSnrSpectrum();

    const rawPath = $('gasRawWave');
    const filtPath = $('gasFiltWave');
    if (!rawPath || !filtPath) return;

    const svg = rawPath.closest('svg');
    if (svg) {
      if (svg.getAttribute('viewBox') !== '0 0 100 40') {
        svg.setAttribute('viewBox', '0 0 100 40');
      }
      if (svg.getAttribute('preserveAspectRatio') !== 'none') {
        svg.setAttribute('preserveAspectRatio', 'none');
      }
    }

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
    const stepX = 100 / (count - 1);

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
       son hâliyle gönderiyor (firmware.ino: rainWet = rainInvert ? ... : ...),
       status JSON'u da her zaman "rainInvert" içeriyor. Eski koddaki
       "rainInvert gelmemişse yerel ayarla tersle" dalı hiçbir firmware
       sürümünde erişilemiyordu; "s" değişkeni de yalnızca onun için
       tanımlanmıştı. */
    const wet = !!(data && data.rain);
    /* Ham değer mantıksızsa (sensör kopuk/kısa) firmware rainOk=false yollar.
       Bu durumda "KURU" demek yanıltıcı olur; ayrıca sel de üretilmez. */
    const ok = !(data && data.rainOk === false);

    const card = $('rainCard');
    if (card) card.setAttribute('data-state', !ok ? 'unknown' : (wet ? 'wet' : 'normal'));

    setText('rainValue', !ok ? 'SENSÖR YOK' : (wet ? 'ISLAK' : 'KURU'));
    const rainTxt = 'ham: ' + (Number(data.rainRaw) || 0) + (data.rainFiltered !== undefined ? ' · filtre: ' + data.rainFiltered : '');
    setText('rainRaw', rainTxt);
    setChip('rainChip', !ok ? 'unknown' : (wet ? 'wet' : 'normal'),
      !ok ? 'KOPUK' : (wet ? 'ISLAK' : 'KURU'));

    const modeTxt = $('rainMode');
    if (modeTxt) {
      modeTxt.textContent = !ok ? 'yağmur sensörü: kopuk/kısa'
        : (data.auto ? 'otomatik kapama: aktif' : 'otomatik kapama: kapalı');
    }
  }

  /* Titreşim / sarsıntı sensörü (SW-420 / 801S sınıfı) */
  function renderVibration(data) {
    if (!$('vibCard')) return;
    const active = !!(data && data.vib);
    const enabled = !(data && data.vibEnabled === false);
    const raw = Number(data && data.vibRaw) || 0;
    const base = Number(data && data.vibBase) || 0;
    const digital = !!(data && (data.vibDigital === true || data.vibDigital === 'true'));

    const card = $('vibCard');
    if (card) card.setAttribute('data-state', active ? 'danger' : (enabled ? 'normal' : 'unknown'));
    setText('vibValue', active ? 'SARSINTI!' : (enabled ? 'SAKİN' : 'PASİF'));
    setChip('vibChip', active ? 'danger' : (enabled ? 'normal' : 'unknown'),
      active ? 'ALARM' : (enabled ? 'İZLENİYOR' : 'KAPALI'));
    setText('vibRaw', 'ham ' + raw + ' · taban ' + base + ' · DO ' + (digital ? '1' : '0'));

    const fill = $('vibFill');
    if (fill) {
      const dev = Math.min(100, Math.abs(raw - base) / 4);
      fill.style.width = (active ? 100 : dev) + '%';
      fill.style.background = active ? 'var(--danger)' : 'var(--primary)';
    }
    const note = $('vibMode');
    if (note) note.textContent = enabled ? 'sarsıntı izleme: aktif' : 'sarsıntı izleme: kapalı';
  }

  /* Alev / yangın sensörü (IR flame sınıfı, ör. KY-026) */
  function renderFlame(data) {
    if (!$('flameCard')) return;
    const active = !!(data && data.flame);
    const enabled = !(data && data.flameEnabled === false);
    const raw = Number(data && data.flameRaw) || 0;
    const base = Number(data && data.flameBase) || 0;
    const digital = !!(data && (data.flameDigital === true || data.flameDigital === 'true'));

    const card = $('flameCard');
    if (card) card.setAttribute('data-state', active ? 'danger' : (enabled ? 'normal' : 'unknown'));
    setText('flameValue', active ? 'ALEV!' : (enabled ? 'GÜVENDE' : 'PASİF'));
    setChip('flameChip', active ? 'danger' : (enabled ? 'normal' : 'unknown'),
      active ? 'YANGIN' : (enabled ? 'İZLENİYOR' : 'KAPALI'));
    setText('flameRaw', 'ham ' + raw + ' · taban ' + base + ' · DO ' + (digital ? '1' : '0'));

    const fill = $('flameFill');
    if (fill) {
      const dev = Math.min(100, Math.abs(raw - base) / 4);
      fill.style.width = (active ? 100 : dev) + '%';
      fill.style.background = active ? 'var(--danger)' : 'var(--primary)';
    }
    const note = $('flameMode');
    if (note) note.textContent = enabled ? 'alev izleme: aktif' : 'alev izleme: kapalı';
  }

  /* Cihaz hoparlörü (I2S / MAX98357A) durumu ve ses seviyesi */
  function renderSound(data) {
    const on = !!(data && (data.buzzer === true || data.buzzer === 'true'));
    const btn = document.querySelector('.btn[data-device="sound"][data-action="toggle"]');
    const lbl = $('soundState');
    if (lbl) lbl.textContent = on ? 'ÇALIYOR' : 'SESSİZ';
    if (btn) btn.classList.toggle('on', on);

    const vol = (data && typeof data.sndVol === 'number') ? data.sndVol : Number(App.settings().sndVolume);
    const sl = $('sndVolume');
    if (sl && !sndVolumeActive) sl.value = vol;
    setText('sndVolumeVal', vol + '%');

    const info = $('sndModeInfo');
    if (info) {
      const ready = data ? (data.sndReady !== false) : false;
      info.textContent = ready
        ? ('hoparlör hazır · desen: ' + (data.sndMode || 'kapali'))
        : 'hoparlör: hazır değil';
    }
  }

  /* Alarm geçişlerinde Türkçe sesli anons (AI ses). Aynı durumda her
     yoklamada tekrar konuşmasın diye yalnızca yükselen kenarda tetiklenir. */
  function announceAlarms(data, state) {
    if (!App.voice || !App.voice.available()) return;
    /* Gece / izleme modunda yalnızca kritik (force) anonslar çalar;
       uyarı seviyesindeki sesli bildirim bastırılır. */
    const silent = !!(App.Automation && App.Automation.isQuiet && App.Automation.isQuiet());
    const danger = state === 'danger';
    const warn = state === 'warning';
    const flood = !!(data && data.flood);
    const vib = !!(data && data.vib);
    const flame = !!(data && data.flame);

    if (danger && !prevAlarm.danger) {
      App.voice.speak('Dikkat! Gaz kaçağı algılandı. Tahliye fanı çalıştırıldı, su motoru kilitlendi ve pencere kapatıldı. Gaz vanasını kapatıp ortamı havalandırın.', { force: true });
    } else if (warn && !prevAlarm.warn && !danger && !silent) {
      App.voice.speak('Uyarı. Gaz yoğunluğu yükseliyor. Lütfen ortamı havalandırın.');
    }
    if (flood && !prevAlarm.flood) {
      App.voice.speak('Su baskını algılandı. Pencere kapatıldı. Su motorunu ve tahliye önlemlerini kontrol edin.', { force: true });
    }
    if (vib && !prevAlarm.vib) {
      App.voice.speak('Sarsıntı veya kurcalama algılandı. Siren çalıyor ve pencere kapatıldı. Evdeki durumu kontrol edin.', { force: true });
    }
    if (flame && !prevAlarm.flame) {
      App.voice.speak('Alev algılandı. Siren çalıyor ve önlemler devreye girdi. Yangın güvenliğinizi kontrol edin.', { force: true });
    }
    prevAlarm = { danger: danger, warn: warn, flood: flood, vib: vib, flame: flame };
  }

  /* Alarm geçişlerinde masaüstü/telefon sistem bildirimi (App.notify).
     Sesli anonstan (App.voice) bağımsızdır: ses kapalı olsa da bildirim gider.
     Aynı anda birden çok olay varsa en kritik olan bildirilir. */
  function notifyAlarms(data, state) {
    if (!App.notify || !App.notify.supported()) return;
    const danger = state === 'danger';
    const warn = state === 'warning';
    const flood = !!(data && data.flood);
    const vib = !!(data && data.vib);
    const flame = !!(data && data.flame);

    if (flame && !prevNotify.flame) {
      App.notify.alarm('flame', 'ALEV / YANGIN ALGILANDI',
        'Siren çalıyor, pencere kapatıldı; fan ve su motoru durduruldu. Yangın güvenliğinizi kontrol edin.',
        { urgent: true });
    } else if (danger && !prevNotify.danger) {
      App.notify.alarm('gas', 'GAZ KAÇAĞI (TEHLİKE)',
        'Tahliye fanı çalıştırıldı, su motoru kilitlendi ve pencere kapatıldı.',
        { urgent: true });
    } else if (flood && !prevNotify.flood) {
      App.notify.alarm('flood', 'SU BASKINI ALGILANDI',
        'Pencere kapatıldı. Su motorunu ve tahliye önlemlerini kontrol edin.',
        { urgent: true });
    } else if (vib && !prevNotify.vib) {
      App.notify.alarm('vib', 'SARSINTI / KURCALAMA ALGILANDI',
        'Siren çalıyor. Evdeki durumu kontrol edin.',
        { urgent: true });
    } else if (warn && !prevNotify.warn) {
      App.notify.alarm('warn', 'Gaz Yoğunluğu Yükseliyor',
        'Uyarı eşiği aşıldı. Ortamı havalandırın.', {});
    }

    prevNotify = { danger: danger, warn: warn, flood: flood, vib: vib, flame: flame };
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
      ['vibration', !(data.vibEnabled === false), 'vibEnableState'],
      ['flame', !(data.flameEnabled === false), 'flameEnableState'],
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

    /* Radyal Aktüatör Geri Sayım Sayaçları */
    updateActuatorTimers(data);
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
        const ppm = Number(lastData && lastData.gasPpm) || 0;
        const dangerTh = (lastData && typeof lastData.gasDanger === 'number') ? lastData.gasDanger : 400;
        const normPpm = Math.min(1.0, ppm / Math.max(dangerTh * 1.5, 100));
        /* Gece / izleme modunda panel hoparlörü susar (cihaz sireni zaten kısık/kapalı). */
        const quiet = !!(App.Automation && App.Automation.isQuiet && App.Automation.isQuiet());
        if (!quiet) App.sound.alarm(normPpm);
        App.haptic(60);
      } else if (state === 'warning') {
        glow.classList.add('state-warning');
      }
    }
  }

  function renderBanner(state) {
    const el = $('banner');
    if (!el) return;
    if (lastData && lastData.flame) {
      el.className = 'banner danger';
      el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 14.5A3.5 3.5 0 0 0 12 18a3.5 3.5 0 0 0 3.5-3.5c0-2-1.5-3-2-4.5-.5 1.5-1.5 2-1.5 2s-.5-1.5-1-2.5c-.8 1.5-2.5 3-2.5 5Z"/><path d="M12 2c1 3 4 5.5 5.5 8.5a7 7 0 1 1-13 3.5c0-4 3.5-7.5 5-10.5.5 2 2 3 2.5 3 .5-.5 1-2.5 0-4.5Z"/></svg>' +
        '<div><strong>ALEV / YANGIN ALARMI</strong>' +
        'Alev sensörü yangın algıladı. Siren (hoparlör) çalıyor, pencere oksijeni kesmek için kapatıldı ve fan/su motoru durduruldu. Yangın güvenliğinizi derhal kontrol edin.</div>';
      el.hidden = false;
      return;
    }
    if (lastData && lastData.vib) {
      el.className = 'banner danger';
      el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
        '<div><strong>SARSINTI / KURCALAMA ALARMI</strong>' +
        'Sarsıntı sensörü tetiklendi. Siren (hoparlör) çalıyor ve pencere kapatıldı. Ortamı ve evinizi kontrol edin.</div>';
      el.hidden = false;
      return;
    }
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

  /* Cihaz erişimi henüz doğrulanmadıysa (giriş/çıkış sonrası) yetkili
     kontrolden geçir ve sonucu gelince ekranı yeniden çiz. */
  let accessChecking = null;
  function ensureDeviceAccess(dev) {
    if (!dev || !App.Auth || !App.Auth.needsCheck || !App.Auth.checkDevice) return;
    if (!App.Auth.needsCheck(dev)) return;
    if (accessChecking === dev) return;
    accessChecking = dev;
    App.Auth.checkDevice(dev).then(function () {
      accessChecking = null;
      if (lastData && lastData.dev === dev) render(lastData);
    }).catch(function () { accessChecking = null; });
  }

  /* --- Cihaz görünürlüğü --------------------------------------------------
     Başka bir hesaba bağlı cihaz; farklı bir hesapta ya da oturum yokken
     "hiç yokmuş" gibi gösterilir: telemetri, kumanda ve alarmlar gizlenir. */
  const DEVICE_SECTIONS = ['homeWidget', 'telemetry', 'command-center', 'analytics', 'eventLog', 'diagnostics'];

  function deviceVisible(dev) {
    if (!dev) return false;
    if (App.Auth && typeof App.Auth.canView === 'function') return App.Auth.canView(dev);
    return true;
  }

  function hideDeviceSections() {
    DEVICE_SECTIONS.forEach(function (id) { const el = $(id); if (el) el.hidden = true; });
    const b = $('banner'); if (b) b.hidden = true;
    const hint = $('controlHint'); if (hint) hint.textContent = '';
  }

  function showDeviceSections() {
    DEVICE_SECTIONS.forEach(function (id) { const el = $(id); if (el) el.hidden = false; });
  }

  function paintNoDevice(dev) {
    hideDeviceSections();
    setControlsEnabled(false);
    if (App.setConnBadge) App.setConnBadge('connecting', 'Cihaz yok');

    const nd = $('noDevice');
    if (!nd) return;
    nd.hidden = false;

    const snap = (App.Auth && App.Auth.snapshot) ? App.Auth.snapshot() : {};
    const devState = (App.Auth && App.Auth.deviceState) ? App.Auth.deviceState(dev) : null;
    let msg;
    if (!dev) {
      msg = 'Cihaz bağlantısı bekleniyor…';
    } else if (App.Auth && App.Auth.needsCheck && App.Auth.needsCheck(dev)) {
      msg = 'Cihaz durumu kontrol ediliyor…';
    } else if (devState === 'free') {
      msg = 'Bu cihaz henüz bir hesaba bağlı değil; telemetri gösterilmiyor. ' +
            'Ayarlar → Hesap & Roller → "Mülkiyet & Erişim" bölümünden aktivasyon ' +
            'kodunu girerek cihazı hesabınıza bağlayın.';
    } else if (!snap.signedIn) {
      msg = 'Bağlı bir cihaz yalnızca sahibine ve admine görünür. ' +
            'Kendi cihazınızı görmek için giriş yapın.';
    } else {
      msg = 'Bu cihaz başka bir hesaba bağlı olduğu için burada görünmüyor. ' +
            'Kendinize ait bir cihazı bağlamak için Ayarlar → Hesap & Roller bölümünü kullanın.';
    }
    const msgEl = $('noDeviceMsg');
    if (msgEl) msgEl.textContent = msg;
  }

  function render(data) {
    lastData = data;
    lastUpdateTs = Date.now();
    ensureDeviceAccess(data && data.dev);

    /* Çoklu cihaz: görülen cihazın MQTT konusunu öğren; aktif cihaz yoksa
       bu cihazı aktif yap (tek cihazlı kurulumda davranış değişmez). */
    if (data && data.dev && App.Devices && App.Devices.learn) {
      try { App.Devices.learn(data.dev, App.settings().mqttTopic); } catch (e) { /* yoksay */ }
    }

    /* Erişim yoksa hiçbir telemetri/kumanda/alarm gösterilmez. */
    if (!deviceVisible(data && data.dev)) {
      paintNoDevice(data && data.dev);
      return;
    }
    const nd = $('noDevice');
    if (nd) nd.hidden = true;
    showDeviceSections();

    const state = gasStateOf(data);
    renderGas(data, state);
    renderRain(data);
    renderVibration(data);
    renderFlame(data);
    renderSound(data);
    renderSystem(data, state);
    renderOutlets(data);
    renderAmbientAlarm(state);
    renderBanner(state);
    renderWidget(data, state);
    renderLockHint();
    setControlsEnabled(controlsAllowed());
    announceAlarms(data, state);
    notifyAlarms(data, state);

    /* Olay günlüğü: alarm/olay geçişlerini kalıcı kayda al */
    if (window.App.Events && window.App.Events.note) {
      try { window.App.Events.note(data, state); } catch (e) { /* günlük hatası çizimi bozmasın */ }
    }

    /* SCADA WebGL Shader Motoru & Telemetri Kara Kutusu */
    if (window.App.Shaders && window.App.Shaders.update) {
      window.App.Shaders.update(data);
    }
    if (window.App.Blackbox && window.App.Blackbox.ingest) {
      window.App.Blackbox.ingest(data);
    }
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
    if (data && data.flame && st !== 'offline') {
      st = 'danger';
      label = 'ALEV ALARMI';
    } else if (data && data.vib && st !== 'offline') {
      st = 'danger';
      label = 'SARSINTI / KURCALAMA';
    } else if (data && data.flood && st !== 'offline') {
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
    if (window.App.Events && window.App.Events.setOnline) { try { window.App.Events.setOnline(true); } catch (e) {} }
  }

  function markOffline(err) {
    online = false;
    failStreak += 1;
    const reason = err && err.legacy ? 'Eski Firmware'
                 : err && err.timeout ? 'Zaman Aşımı'
                 : App.api.transport() && App.deviceOnline === false ? 'Cihaz Çevrimdışı'
                 : 'Bağlantı Yok';
    App.setConnBadge('offline', reason);
    if (window.App.Events && window.App.Events.setOnline) { try { window.App.Events.setOnline(false, reason); } catch (e) {} }

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
      if (device === 'gas' && action === 'recalibrate') App.toast('Gaz tabanı yeniden kalibre edildi', { kind: 'ok' });
      if (action === 'set' && (device === 'window' || device === 'blind')) App.toast(device === 'window' ? 'Pencere açısı güncellendi' : 'Panjur açısı güncellendi', { kind: 'ok' });
      if (device === 'sound' || device === 'speaker' || device === 'buzzer') {
        if (action === 'test') App.toast('Hoparlör test tonu çalınıyor', { kind: 'ok' });
        else if (action === 'siren') { App.toast('Siren çalınıyor', { kind: 'warn' }); App.voice.speak('Dikkat! Siren testi çalıştırıldı.'); }
        else if (action === 'beep') App.toast('Kısa bip', { kind: 'ok' });
        else if (action === 'set') App.toast('Ses seviyesi güncellendi', { kind: 'ok' });
        else App.toast(action === 'on' ? 'Sesli alarm açıldı (hoparlör)' : 'Sesli alarm kapatıldı', { kind: 'ok' });
      }
      if (device === 'vibration' || device === 'vib') {
        if (action === 'test') App.toast('Titreşim alarmı simüle edildi', { kind: 'warn' });
        else if (action === 'clear') App.toast('Titreşim olayı temizlendi', { kind: 'ok' });
        else App.toast('Titreşim sensörü ' + (action === 'on' ? 'açıldı' : action === 'off' ? 'kapatıldı' : 'güncellendi'), { kind: 'ok' });
      }
      if (device === 'flame' || device === 'fire') {
        if (action === 'test') App.toast('Alev alarmı simüle edildi', { kind: 'warn' });
        else if (action === 'clear') App.toast('Alev olayı temizlendi', { kind: 'ok' });
        else App.toast('Alev sensörü ' + (action === 'on' ? 'açıldı' : action === 'off' ? 'kapatıldı' : 'güncellendi'), { kind: 'ok' });
      }
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

  /* ---------------------------------------------- Hoparlör (I2S) ses seviyesi */
  function setupSpeaker() {
    const sl = $('sndVolume');
    const val = $('sndVolumeVal');
    if (!sl) return;
    sl.addEventListener('input', function () {
      sndVolumeActive = true;
      if (val) val.textContent = sl.value + '%';
    });
    sl.addEventListener('change', function () {
      sndVolumeActive = false;
      if (val) val.textContent = sl.value + '%';
      App.saveSettings({ sndVolume: Number(sl.value) });
      send('sound', 'set', Number(sl.value));
    });
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
      tickActuatorRings();
    }, 1000);
  }

  /* ------------------------------------------------------------- Hesap */

  /* Başlıktaki "Hesap" rozeti + cihaz mülkiyeti bilgisi. */
  function setupAccountPill() {
    const btn = document.getElementById('accountBtn');
    const txt = document.getElementById('accountBtnText');
    if (!App.Auth) return;

    function paint(snap) {
      if (btn && txt) {
        if (snap.setupRequired) { btn.dataset.state = ''; txt.textContent = 'Kurulum'; }
        else if (snap.isAdmin) { btn.dataset.state = 'admin'; txt.textContent = 'Admin'; }
        else if (snap.signedIn) {
          btn.dataset.state = 'user';
          txt.textContent = ((snap.user && snap.user.email) || 'Hesap').split('@')[0];
        } else {
          btn.dataset.state = '';
          txt.textContent = 'Hesap';
        }
      }
      /* Oturum/rol değişince cihaz görünürlüğünü yeniden hesapla:
         ör. admin çıkış yapınca başkasının cihazı anında gizlenir. */
      if (lastData) render(lastData);
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

  let dashboardEventsBound = false;

  function destroy() {
    clearTimeout(pollTimer);
    clearInterval(tickTimer);
    clearTimeout(pumpArmTimer);
    pollTimer = null;
    tickTimer = null;
    pumpArmTimer = null;
    pumpArmed = false;
    online = false;
    pushUnsubs.forEach(function (u) {
      try {
        if (typeof u === 'function') u();
      } catch (e) {}
    });
    pushUnsubs = [];
    if (lastData && lastData.pump) disarmPump();

    /* WebGL Shader Motoru & Kara Kutu Yaşam Döngüsü Temizliği */
    if (window.App.Shaders && window.App.Shaders.destroy) {
      window.App.Shaders.destroy();
    }
    if (window.App.Blackbox && window.App.Blackbox.destroy) {
      window.App.Blackbox.destroy();
    }

    fanStartTime = null;
    pumpStartTime = null;
    const fanCircle = $('fanRingCircle');
    const fanBadge = $('fanTimeBadge');
    if (fanCircle) fanCircle.style.strokeDashoffset = '276.46';
    if (fanBadge) fanBadge.hidden = true;
    const pumpCircle = $('pumpRingCircle');
    const pumpBadge = $('pumpTimeBadge');
    if (pumpCircle) pumpCircle.style.strokeDashoffset = '276.46';
    if (pumpBadge) pumpBadge.hidden = true;
  }

  function init() {
    destroy();
    if (!$('homeWidget')) return;
    setupTheme();
    setupServiceWorker();
    App.setupPwaInstall();
    setupServoSliders();
    setupSpeaker();
    setupAccountPill();
    startTicker();

    if (App.init3DTilt) App.init3DTilt();
    /* Eski App.initParallax() kaldırıldı; tüm scroll/lerp yönetimi parallax.js motorunda */
    if (App.initRipple) App.initRipple();
    if (App.initHistory) App.initHistory();

    /* Donanım Gücüne Duyarlı WebGL Shader Motoru ve Olay Kara Kutusu */
    if (window.App.Shaders && window.App.Shaders.init) {
      window.App.Shaders.init(window.App.Tier && window.App.Tier.get());
    }
    if (window.App.Blackbox && window.App.Blackbox.init) {
      window.App.Blackbox.init();
    }

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

    if (!dashboardEventsBound) {
      dashboardEventsBound = true;
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          clearTimeout(pollTimer);
        } else {
          clearTimeout(pollTimer);
          if ($('homeWidget')) poll();
        }
      });

      window.addEventListener('pagehide', function () {
        if (lastData && lastData.pump) disarmPump();
      });
    }

    console.info('%c[Deneyap Ev Koruma] Cyber-Console v' + App.VERSION + ' devrede',
      'color:#38bdf8;font-weight:bold;font-size:12px');
    /* Hero sürüm etiketini tek kaynaktan güncelle (bayat etiketi önler) */
    const heroVer = document.getElementById('heroVersion');
    if (heroVer) heroVer.textContent = 'SCADA v' + App.VERSION;
  }

  /* --------------------------------- Sanal Klavye Yönetimi (Virtual Keyboard) */
  function setupVirtualKeyboardHandler() {
    if (!window.visualViewport) return;

    let initialHeight = window.visualViewport.height;

    window.visualViewport.addEventListener('resize', function () {
      const bottomNav = document.querySelector('.bottom-nav');
      if (!bottomNav) return;
      const currentHeight = window.visualViewport.height;
      // Yükseklik 160px'ten fazla azaldıysa sanal klavye açılmıştır
      const isKeyboardOpen = (initialHeight - currentHeight) > 160;
      if (isKeyboardOpen) {
        bottomNav.classList.add('nav-hidden-keyboard');
      } else {
        bottomNav.classList.remove('nav-hidden-keyboard');
        initialHeight = currentHeight;
      }
    });
  }

  /* -------------------------------- Ağ Durumu Senkronizasyonu (Online / Offline) */
  function setupNetworkSyncHandler() {
    window.addEventListener('offline', function () {
      online = false;
      App.setConnBadge('offline', 'Çevrimdışı (Önbellek)');
      App.toast('İnternet bağlantısı kesildi. Veriler yerel önbellekten okunuyor.', { kind: 'warn', duration: 4000 });
    });

    window.addEventListener('online', function () {
      App.setConnBadge('connecting', 'Canlıya Geçiliyor…');
      App.toast('Ağ bağlantısı kuruldu. Telemetri senkronize ediliyor...', { kind: 'ok', duration: 3000 });
      if (App.api && typeof App.api.status === 'function') {
        App.api.status().then(function (data) {
          markOnline();
          render(data);
        }).catch(function (err) {
          markOffline(err);
        });
      }
      if (App.api && App.api.transport() && typeof App.api.startMqtt === 'function') {
        try { App.api.startMqtt(); } catch (e) {}
      }
    });
  }

  /* ------------------------------- Akıllı PWA Yükleme Butonu Yönetimi */
  function setupSmartInstallButton() {
    const btn = document.getElementById('pwaInstallBtn');
    if (!btn) return;
    if (App.isStandalone) {
      btn.hidden = true;
      btn.style.display = 'none';
      return;
    }
    if (typeof App.setupPwaInstall === 'function') {
      App.setupPwaInstall();
    }
  }

  /* ---------------------- Evrensel Buton Etkileşim ve Dinamik Geri Bildirim */
  function setupUniversalButtonFeedback() {
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('.btn[data-action], .mode-btn, .drill-btn, [data-sched="del"]');
      if (!btn || btn.classList.contains('is-busy')) return;

      btn.classList.add('is-busy');
      if (typeof App.haptic === 'function') App.haptic(15);
      setTimeout(function () {
        btn.classList.remove('is-busy');
      }, 700); // 700ms debounce kilidi
    }, true);
  }

  function bootGlobalFeatures() {
    setupVirtualKeyboardHandler();
    setupNetworkSyncHandler();
    setupSmartInstallButton();
    setupUniversalButtonFeedback();
  }

  window.App.initDashboard = init;
  window.App.destroyDashboard = destroy;
  window.App.setupVirtualKeyboardHandler = setupVirtualKeyboardHandler;
  /* Sesli komut / otomasyon modülleri için son telemetri erişimi */
  window.App.lastTelemetry = function () { return lastData; };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bootGlobalFeatures();
      if ($('homeWidget')) init();
    });
  } else {
    bootGlobalFeatures();
    if ($('homeWidget')) init();
  }
})();