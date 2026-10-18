/* ==========================================================================
   settings.js — Cyber-Console Ayarlar Sayfası Denetleyicisi
   - Donanım / Panel Eşik Yönetimi & ESP32 NVS Flash Senkronizasyonu
   - Görsel Tema Seçici (Aydınlık / Karanlık / AMOLED / Sistem)
   - Sesli Uyarılar (Web Audio) & Haptik Titreşim Yapılandırması
   - Ayar Yedekleme: JSON İndirme (Dışa Aktar) ve Yükleme (İçe Aktar)
   - 3D Kart Eğim (Tilt), Parallaks ve Dokunsal Efektler
   ========================================================================== */

(function () {
  'use strict';

  const App = window.App;
  const $ = function (id) { return document.getElementById(id); };

  let reg = null; // Service Worker kaydı

  /* ------------------------------------------------------------ Form Doldurma */

  function fillForm() {
    const s = App.settings();
    $('transport').value = App.settings().transport || 'mqtt';
    $('mqttUrl').value = s.mqttUrl || '';
    $('mqttUrl2').value = s.mqttUrl2 || '';
    $('mqttTopic').value = s.mqttTopic || '';
    $('mqttUser').value = s.mqttUser || '';
    $('mqttPass').value = s.mqttPass || '';
    $('host').value = s.host || '';
    $('token').value = s.token || '';
    $('pollMs').value = String(s.pollMs || 2000);
    applyTransportVisibility();
    $('gasWarn').value = s.gasWarn;
    $('gasDanger').value = s.gasDanger;
    $('rainInvert').checked = !!s.rainInvert;
    $('autoControl').checked = !!s.autoControl;

    /* Telegram: token ASLA geri okunmaz ve yerelde saklanmaz — yalnızca
       kullanıcı bilerek yazdığında cihaza gider. */
    const tgEn = $('tgEnabled');
    if (tgEn) tgEn.checked = !!s.tgEnabled;
    const tgChat = $('tgChatId');
    if (tgChat) tgChat.value = s.tgChatId || '';
    const tgTok = $('tgToken');
    if (tgTok) tgTok.value = '';
    paintTgInfo(s);

    const soundEl = $('soundEnabled');
    if (soundEl) soundEl.checked = (s.soundEnabled !== false);

    const vibEl = $('vibrateEnabled');
    if (vibEl) vibEl.checked = (s.vibrateEnabled !== false);

    /* Yeni donanım özellikleri (cihaz NVS ile senkron) */
    const setChk = function (id, val, def) {
      const el = $(id);
      if (!el) return;
      el.checked = (val === undefined || val === null) ? !!def : (val === true || val === 'true');
    };
    setChk('vibEnabled', s.vibEnabled, true);
    setChk('vibAlarm', s.vibAlarm, true);
    setChk('vibUseDigital', s.vibUseDigital, true);
    setChk('vibUseAnalog', s.vibUseAnalog, false);
    setChk('vibTg', s.vibTg, true);
    setChk('flameEnabled', s.flameEnabled, true);
    setChk('flameAlarm', s.flameAlarm, true);
    setChk('flameUseDigital', s.flameUseDigital, true);
    setChk('flameUseAnalog', s.flameUseAnalog, false);
    setChk('flameTg', s.flameTg, true);
    setChk('aiVoice', s.aiVoice, true);
    const sndVolEl = $('sndVolume');
    if (sndVolEl) sndVolEl.value = String(s.sndVolume !== undefined ? s.sndVolume : 70);

    /* Panel bildirimleri — yerel tercihler; cihaza GÖNDERİLMEZ. */
    setChk('notifyEnabled', s.notifyEnabled, false);
    setChk('notifySound', s.notifySound, true);
    setChk('notifyGas', s.notifyGas, true);
    setChk('notifyWarn', s.notifyWarn, true);
    setChk('notifyFlood', s.notifyFlood, true);
    setChk('notifyFlame', s.notifyFlame, true);
    setChk('notifyVib', s.notifyVib, true);
    setChk('notifyOffline', s.notifyOffline, false);

    const themeRadio = document.querySelector('input[name="theme"][value="' + (s.theme || 'dark') + '"]');
    if (themeRadio) themeRadio.checked = true;

    const appVer = $('appVersion');
    if (appVer) appVer.textContent = 'v' + App.VERSION;
    const studioVer = $('studioVersion');
    if (studioVer) studioVer.textContent = 'v' + App.VERSION;
  }

  function readForm() {
    const themeEl = document.querySelector('input[name="theme"]:checked');
    const soundEl = $('soundEnabled');
    const vibEl = $('vibrateEnabled');

    return {
      transport: $('transport').value,
      mqttUrl: $('mqttUrl').value.trim(),
      mqttUrl2: $('mqttUrl2').value.trim(),
      mqttTopic: $('mqttTopic').value.trim(),
      mqttUser: $('mqttUser').value.trim(),
      mqttPass: $('mqttPass').value,
      host: $('host').value.trim(),
      token: $('token').value.trim(),
      pollMs: Number($('pollMs').value),
      gasWarn: Number($('gasWarn').value),
      gasDanger: Number($('gasDanger').value),
      rainInvert: $('rainInvert').checked,
      autoControl: $('autoControl').checked,
      tgEnabled: $('tgEnabled') ? $('tgEnabled').checked : false,
      tgChatId: $('tgChatId') ? $('tgChatId').value.trim() : '',
      soundEnabled: soundEl ? soundEl.checked : true,
      vibrateEnabled: vibEl ? vibEl.checked : true,
      aiVoice: $('aiVoice') ? $('aiVoice').checked : true,
      vibEnabled: $('vibEnabled') ? $('vibEnabled').checked : true,
      vibAlarm: $('vibAlarm') ? $('vibAlarm').checked : true,
      vibUseDigital: $('vibUseDigital') ? $('vibUseDigital').checked : true,
      vibUseAnalog: $('vibUseAnalog') ? $('vibUseAnalog').checked : false,
      vibTg: $('vibTg') ? $('vibTg').checked : true,
      flameEnabled: $('flameEnabled') ? $('flameEnabled').checked : true,
      flameAlarm: $('flameAlarm') ? $('flameAlarm').checked : true,
      flameUseDigital: $('flameUseDigital') ? $('flameUseDigital').checked : true,
      flameUseAnalog: $('flameUseAnalog') ? $('flameUseAnalog').checked : false,
      flameTg: $('flameTg') ? $('flameTg').checked : true,
      sndVolume: $('sndVolume') ? Number($('sndVolume').value) : 70,
      /* Panel bildirim tercihleri — cihaza gönderilmez (aşağıda hw'ye konmaz) */
      notifyEnabled: $('notifyEnabled') ? $('notifyEnabled').checked : false,
      notifySound: $('notifySound') ? $('notifySound').checked : true,
      notifyGas: $('notifyGas') ? $('notifyGas').checked : true,
      notifyWarn: $('notifyWarn') ? $('notifyWarn').checked : true,
      notifyFlood: $('notifyFlood') ? $('notifyFlood').checked : true,
      notifyFlame: $('notifyFlame') ? $('notifyFlame').checked : true,
      notifyVib: $('notifyVib') ? $('notifyVib').checked : true,
      notifyOffline: $('notifyOffline') ? $('notifyOffline').checked : false,
      theme: themeEl ? themeEl.value : 'dark'
    };
  }

  /* Yalnızca seçili yöntemin alanlarını göster: MQTT alanları ya da IP alanı.
   Karışık görünüm, hangi ayarın geçerli olduğunu bulmayı zorlaştırıyor. */
  function applyTransportVisibility() {
    const mqtt = $('transport').value === 'mqtt';
    ['mqttUrl', 'mqttUrl2', 'mqttTopic', 'mqttUser', 'mqttPass'].forEach(function (id) {
      const el = $(id);
      if (!el) return;
      const field = el.closest('.field');
      if (field) field.hidden = !mqtt;
    });
    ['host', 'token', 'pollMs'].forEach(function (id) {
      const el = $(id);
      if (!el) return;
      const field = el.closest('.field');
      if (field) field.hidden = mqtt;
    });
  }

  function setResult(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.className = 'result' + (kind ? ' ' + kind : '');
  }

  /* -------------------------------------------------- Telegram bilgi satırı */
  /* Cihazın Telegram alanları panelde yalnızca "var/yok" olarak taşınır:
     bot tokenı ne durum JSON'unda ne de localStorage'da bulunur. */
  let tgInfo = { tgEnabled: false, tgTokenSet: false, tgChatSet: false };

  function tgSummary() {
    if (!tgInfo.tgEnabled) return { t: 'Telegram kapalı — bildirim gönderilmez.', k: '' };
    if (!tgInfo.tgTokenSet) return { t: 'Bot token kayıtlı değil.', k: 'fail' };
    if (!tgInfo.tgChatSet) {
      return { t: 'Hazır, ancak sohbet kimliği henüz yok — bota /start yazıp test gönderin.', k: 'fail' };
    }
    return { t: 'Hazır — bildirimler etkin.', k: 'ok' };
  }

  function paintTgInfo(s) {
    if (s) {
      if (s.tgEnabled !== undefined) tgInfo.tgEnabled = !!s.tgEnabled;
      if (s.tgTokenSet !== undefined) tgInfo.tgTokenSet = !!s.tgTokenSet;
      if (s.tgChatSet !== undefined) tgInfo.tgChatSet = !!s.tgChatSet;
    }
    const sum = tgSummary();
    setResult($('tgResult'), sum.t, sum.k);
    const en = $('tgEnabled');
    if (en && s && s.tgEnabled !== undefined) en.checked = tgInfo.tgEnabled;
  }

  /* Cihazdan alınan canlı durumla bölümü tazele. */
  async function refreshTgInfo() {
    try {
      App.api.startMqtt();
      const s = await App.api.status();
      paintTgInfo({
        tgEnabled: s.tgOn,
        tgTokenSet: s.tgTok,
        tgChatSet: s.tgChat
      });
      return s;
    } catch (e) { return null; }
  }

  /* Tokenı sil: testten sonra ya da yetki geri çekilirken kullanılır.
     Cihazdaki NVS kaydı ve sohbet kimliği de temizlenir. */
  async function tgForget() {
    const btn = $('tgForgetBtn');
    const out = $('tgResult');
    if (btn) btn.disabled = true;
    setResult(out, 'Cihaza iletiliyor…');
    try {
      await App.api.saveSettings({ tgForgetToken: true });
      tgInfo.tgTokenSet = false;
      tgInfo.tgChatSet = false;
      const t = $('tgToken'); if (t) t.value = '';
      paintTgInfo(tgInfo);
      setResult(out, 'Bot token ve sohbet kimliği cihazdan silindi.', 'ok');
      App.sound.chime();
    } catch (err) {
      setResult(out, 'Silinemedi: ' + err.message, 'fail');
      App.sound.click();
    } finally { if (btn) btn.disabled = false; }
  }

  /* Test bildirimi: firmware bunu ayrı kuyruğa alır ve ~20 sn içinde
     Telegram'a gönderir. Aynı istek sohbet kimliği yoksa otomatik keşfi de
     tetikler. */
  async function tgTest(forceForgetChat) {
    const btn = forceForgetChat ? $('tgDiscoverBtn') : $('tgTestBtn');
    const out = $('tgResult');
    if (btn) btn.disabled = true;
    setResult(out, 'Cihaza iletiliyor…');

    try {
      /* Canlı bilgiyi AYARLARDAN oku: getSettings() hem HTTP'de hem
         MQTT'de hiçbir şey yayımlamadan yanıt verir. (Eski kod burada
         startMqtt() + status() çağırıyordu; startMqtt canlı istemciyi
         düşürdüğü için hemen ardından yapılan yayın kayboluyordu —
         mqtt.js'teki connect() korumasıyla birlikte bu yol bırakıldı.) */
      let live = null;
      try { live = await App.api.getSettings(); } catch (e) { live = null; }
      const typedToken = ($('tgToken') ? $('tgToken').value.trim() : '');
      const typedChat = ($('tgChatId') ? $('tgChatId').value.trim() : '');

      if (!live) throw new Error('Cihaza ulaşılamadı — bağlantı rozetini kontrol edin.');
      const acik = (live.tgEnabled === true || live.tgEnabled === 'true');
      const tokenVar = (live.tgTokenSet === true || live.tgTokenSet === 'true');
      const chatVar = (live.tgChatSet === true || live.tgChatSet === 'true');

      if (!acik)
        throw new Error('Telegram kapalı — önce yukarıdaki anahtarı açıp Kaydet\'e basın.');
      if (!tokenVar && !typedToken)
        throw new Error('Bot token kayıtlı değil — yukarıya yapıştırın.');

      const payload = { tgEnabled: true, tgTest: true };
      if (typedToken) payload.tgToken = typedToken;
      if (typedChat) payload.tgChatId = typedChat;
      if (forceForgetChat) payload.tgForgetChat = true;

      await App.api.saveSettings(payload);
      App.sound.chime();

      const bekliyor = !chatVar && !typedChat;
      setResult(out, (forceForgetChat ? 'Kimlik silindi, ' : 'Test kuyruğa alındı — ')
        + 'Telegram uygulamanıza bakın (en fazla 20 sn).'
        + (bekliyor ? ' Sohbet kimliği bilinmiyor; bota henüz /start yazmadıysanız şimdi yazın — kart ilk mesajdan kimliği bulup kaydeder.'
                    : ''), 'ok');
      tgInfo.tgEnabled = true;
      tgInfo.tgTokenSet = tokenVar || !!typedToken;
      tgInfo.tgChatSet = chatVar || !!typedChat;
    } catch (err) {
      setResult(out, err.message || 'Test gönderilemedi.', 'fail');
      App.sound.click();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ------------------------------------------------------------------- Kayıt */

  async function save(e) {
    if (e) e.preventDefault();
    const v = readForm();

    /* Doğrulama yalnızca seçili yönteme göre yapılır. */
    if (v.transport === 'http' && v.host && !/^https?:\/\/.+/i.test(v.host)) {
      setResult($('testResult'), 'Cihaz adresi http:// ile başlamalıdır.', 'fail');
      $('host').focus();
      App.sound.alarm();
      return;
    }
    if (v.transport === 'mqtt') {
      if (!/^wss?:\/\/.+/i.test(v.mqttUrl)) {
        setResult($('testResult'),
          'Yayıncı adresi wss:// ile başlamalıdır (örn. wss://broker.emqx.io:8084/mqtt).', 'fail');
        $('mqttUrl').focus();
        App.sound.alarm();
        return;
      }
      const v2 = (v.mqttUrl2 || '').trim();
      if (v2 && !/^wss?:\/\/.+/i.test(v2)) {
        setResult($('testResult'),
          'Yedek yayıncı adresi de wss:// ile başlamalıdır (boş bırakılabilir).', 'fail');
        $('mqttUrl2').focus();
        App.sound.alarm();
        return;
      }
      if (!v.mqttTopic || /^\s*$|\s/.test(v.mqttTopic)) {
        setResult($('testResult'),
          'Cihaz konu adı boş bırakılamaz ve boşluk içeremez (örn. deneyap/kart1).', 'fail');
        $('mqttTopic').focus();
        App.sound.alarm();
        return;
      }
    }
    if (!(v.gasWarn > 0) || !(v.gasDanger > 0)) {
      setResult($('testResult'), 'Gaz eşikleri pozitif bir değer olmalıdır.', 'fail');
      App.sound.alarm();
      return;
    }
    if (v.gasWarn >= v.gasDanger) {
      setResult($('testResult'),
        'Uyarı eşiği (' + v.gasWarn + ') tehlike eşiğinden (' + v.gasDanger + ') küçük olmalıdır.',
        'fail');
      $('gasWarn').focus();
      App.sound.alarm();
      return;
    }
    if (v.vibEnabled && !v.vibUseDigital && !v.vibUseAnalog) {
      setResult($('testResult'),
        'Sarsıntı algılama açık ama hiçbir giriş seçili değil — Dijital (DO) veya Analog (AO) seçin.', 'fail');
      App.sound.alarm();
      return;
    }
    if (v.flameEnabled && !v.flameUseDigital && !v.flameUseAnalog) {
      setResult($('testResult'),
        'Alev algılama açık ama hiçbir giriş seçili değil — Dijital (DO) veya Analog (AO) seçin.', 'fail');
      App.sound.alarm();
      return;
    }

    const typedTgToken = ($('tgToken') ? $('tgToken').value.trim() : '');
    if (v.tgEnabled && !tgInfo.tgTokenSet && !typedTgToken) {
      setResult($('tgResult'), 'Telegram açık ama bot token yok — @BotFather\'dan alıp yapıştırın.', 'fail');
      App.sound.alarm();
      return;
    }
    if (typedTgToken && typedTgToken.indexOf(':') < 0) {
      setResult($('tgResult'), 'Bot token biçimi hatalı — 123456789:AA... şeklinde olmalı.', 'fail');
      $('tgToken').focus();
      App.sound.alarm();
      return;
    }

    App.saveSettings(v);
    App.applyTheme(v.theme);

    const submitBtn = document.querySelector('#settingsForm button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    setResult($('testResult'), 'Ayarlar cihaza gönderiliyor ve flash hafızaya yazılıyor…');

    try {
      const hw = {
        gasWarn: v.gasWarn,
        gasDanger: v.gasDanger,
        rainInvert: v.rainInvert,
        autoControl: v.autoControl,
        vibEnabled: v.vibEnabled,
        vibAlarm: v.vibAlarm,
        vibUseDigital: v.vibUseDigital,
        vibUseAnalog: v.vibUseAnalog,
        vibTg: v.vibTg,
        flameEnabled: v.flameEnabled,
        flameAlarm: v.flameAlarm,
        flameUseDigital: v.flameUseDigital,
        flameUseAnalog: v.flameUseAnalog,
        flameTg: v.flameTg,
        sndVolume: Math.max(0, Math.min(100, Number(v.sndVolume) || 0)),
        tgEnabled: v.tgEnabled,
        tgChatId: v.tgChatId
      };
      /* Token yalnızca kullanıcı bir şey yazdıysa gider; boş alanı
         göndermek cihazdaki kayıtlı tokenı silmez (firmware da
         uzunluğu 0 ise değiştirmiyor). */
      if (typedTgToken) hw.tgToken = typedTgToken;

      const resp = await App.api.saveSettings(hw);

      /* HTTP'de yanıt doğrudan cihazın ayar JSON'u; MQTT'de ise durum
         paketinden çıkardığımız özet. İkisi de `tgResult`ı güncelleyebilir. */
      tgInfo.tgEnabled = v.tgEnabled;
      tgInfo.tgTokenSet = tgInfo.tgTokenSet || !!typedTgToken;
      tgInfo.tgChatSet = tgInfo.tgChatSet || !!v.tgChatId;
      paintTgInfo(resp && resp.tgTokenSet !== undefined
        ? { tgEnabled: resp.tgEnabled, tgTokenSet: resp.tgTokenSet, tgChatSet: resp.tgChatSet }
        : tgInfo);

      App.sound.chime();
      App.haptic(30);
      App.toast('Ayarlar Deneyap Kart flash hafızasına ve panele kaydedildi', { kind: 'ok' });
      setResult($('testResult'), 'Cihaza ve panele başarıyla kaydedildi.', 'ok');
    } catch (err) {
      console.warn('[ayarlar] Donanıma POST başarısız:', err);
      App.sound.click();
      App.toast('Yerel kaydedildi, ancak cihaza iletilemedi: ' + err.message, { kind: 'warn' });
      setResult($('testResult'), 'Yerel kaydedildi, cihaza iletilemedi: ' + err.message, 'fail');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      refreshDeviceInfo().catch(function () {});
    }
  }

  /* -------------------------------------------------------- Cihaz Bilgileri */

  async function refreshDeviceInfo() {
    try {
      /* MQTT modunda panel bu sayfada açık değilse hiçbir abone yoktur ve
         durum paketi hiç gelmeyebilir. Bu yüzden burada da bağlantı
         başlatılır; HTTP modunda startMqtt() zaten bir iş yapmaz. */
      App.api.startMqtt();
      const s = await App.api.status();
      /* Durum taze geldiyse cihaz canlıdır; LWT tersini söylemişsa rozet
         "canlı" diyemez (bkz. app.js markOnline). */
      if (App.deviceOnline === false) App.setConnBadge('offline', 'Cihaz Çevrimdışı');
      else App.setConnBadge('live', 'Canlı Telemetri');

      // ESP32'den dönen gerçek eşikleri forma aktar (kullanıcı alanı düzenlemiyorsa)
      if (s) {
        const isEditing = (document.activeElement === $('gasWarn') ||
                           document.activeElement === $('gasDanger'));
        if (!isEditing) {
          if (typeof s.gasWarn === 'number' && s.gasWarn > 0) {
            $('gasWarn').value = s.gasWarn;
          }
          if (typeof s.gasDanger === 'number' && s.gasDanger > 0) {
            $('gasDanger').value = s.gasDanger;
          }
          if (s.rainInvert !== undefined) {
            $('rainInvert').checked = (s.rainInvert === true || s.rainInvert === 'true');
          }
          if (s.auto !== undefined) {
            $('autoControl').checked = (s.auto === true || s.auto === 'true');
          }
          if (s.vibEnabled !== undefined) {
            $('vibEnabled').checked = (s.vibEnabled === true || s.vibEnabled === 'true');
          }
          if (s.vibAlarm !== undefined) {
            $('vibAlarm').checked = (s.vibAlarm === true || s.vibAlarm === 'true');
          }
          if (s.vibUseDigital !== undefined) {
            $('vibUseDigital').checked = (s.vibUseDigital === true || s.vibUseDigital === 'true');
          }
          if (s.vibUseAnalog !== undefined) {
            $('vibUseAnalog').checked = (s.vibUseAnalog === true || s.vibUseAnalog === 'true');
          }
          if (s.vibTg !== undefined) {
            $('vibTg').checked = (s.vibTg === true || s.vibTg === 'true');
          }
          if (s.flameEnabled !== undefined) {
            $('flameEnabled').checked = (s.flameEnabled === true || s.flameEnabled === 'true');
          }
          if (s.flameAlarm !== undefined) {
            $('flameAlarm').checked = (s.flameAlarm === true || s.flameAlarm === 'true');
          }
          if (s.flameUseDigital !== undefined) {
            $('flameUseDigital').checked = (s.flameUseDigital === true || s.flameUseDigital === 'true');
          }
          if (s.flameUseAnalog !== undefined) {
            $('flameUseAnalog').checked = (s.flameUseAnalog === true || s.flameUseAnalog === 'true');
          }
          if (s.flameTg !== undefined) {
            $('flameTg').checked = (s.flameTg === true || s.flameTg === 'true');
          }
          if (typeof s.sndVol === 'number' && $('sndVolume')) {
            $('sndVolume').value = String(s.sndVol);
          }

          App.saveSettings({
            gasWarn: Number($('gasWarn').value),
            gasDanger: Number($('gasDanger').value),
            rainInvert: $('rainInvert').checked,
            autoControl: $('autoControl').checked,
            vibEnabled: $('vibEnabled').checked,
            vibAlarm: $('vibAlarm').checked,
            vibUseDigital: $('vibUseDigital').checked,
            vibUseAnalog: $('vibUseAnalog').checked,
            vibTg: $('vibTg').checked,
            flameEnabled: $('flameEnabled').checked,
            flameAlarm: $('flameAlarm').checked,
            flameUseDigital: $('flameUseDigital').checked,
            flameUseAnalog: $('flameUseAnalog').checked,
            flameTg: $('flameTg').checked,
            sndVolume: Number($('sndVolume').value) || 0
          });
        }

        /* Telegram özetini canlı durumla tazele; kullanıcı o alanı
           düzenliyorsa üzerine yazma. */
        const editingTg = document.activeElement === $('tgToken') ||
                          document.activeElement === $('tgChatId') ||
                          document.activeElement === $('tgEnabled');
        if (!editingTg) {
          paintTgInfo({ tgEnabled: s.tgOn, tgTokenSet: s.tgTok, tgChatSet: s.tgChat });
        }
      }

      return s;
    } catch (err) {
      App.setConnBadge('offline', err.legacy ? 'Eski Firmware' : 'Bağlantı Yok');
      throw err;
    }
  }

  /* Bağlantı & Gecikme Testi */
  /* ------------------------------------------------- Bildirim paneli ------ */
  /* Yerel sistem bildirimi + arka plan (Web Push) aboneliği durumunu tazeler.
     Bildirim tercihleri cihaza gönderilmez; yalnızca bu tarayıcıda tutulur. */
  function notifyPermLabel(p) {
    if (p === 'granted') return 'izin verildi';
    if (p === 'denied') return 'engellendi';
    if (p === 'unsupported') return 'desteklenmiyor';
    return 'sorulmadı';
  }

  async function refreshNotifyPanel() {
    if (!App.notify) {
      setResult($('notifyResult'), 'Bildirim modülü yüklenmedi (notify.js).', 'fail');
      return;
    }
    const s = App.settings();
    const p = App.notify.permission();

    if (!App.notify.supported()) {
      setResult($('notifyResult'), 'Bu tarayıcı sistem bildirimini desteklemiyor.', 'fail');
    } else {
      setResult($('notifyResult'),
        'İzin: ' + notifyPermLabel(p) + ' · yerel bildirim ' +
        (s.notifyEnabled ? 'AÇIK' : 'kapalı'),
        p === 'granted' && s.notifyEnabled ? 'ok' : (p === 'denied' ? 'fail' : ''));
    }

    const btn = $('pushToggleBtn');
    const res = $('pushResult');
    if (!btn || !App.notify.pushState) return;
    try {
      const st = await App.notify.pushState();
      if (!st.supported) {
        btn.disabled = true;
        setResult(res, p === 'denied'
          ? 'Arka plan bildirimi: bildirim izni engellenmiş.'
          : 'Arka plan bildirimi için VAPID genel anahtarı tanımlı değil (bkz. FIREBASE.md).', '');
      } else {
        btn.disabled = false;
        btn.textContent = st.subscribed
          ? 'Arka Plan Bildirimini Kapat'
          : 'Arka Plan Bildirimini Aç';
        setResult(res, st.subscribed
          ? 'Arka plan bildirimi AÇIK — panel kapalıyken de bildirim gelir.'
          : 'Arka plan bildirimi kapalı — panel kapalıyken bildirim gelmez.',
          st.subscribed ? 'ok' : '');
      }
    } catch (e) {
      setResult(res, 'Durum okunamadı: ' + e.message, 'fail');
    }
  }

  async function onNotifyPerm() {
    const btn = $('notifyPermBtn');
    if (btn) btn.disabled = true;
    try {
      const r = await App.notify.enable();
      if (!r.ok) {
        setResult($('notifyResult'),
          'İzin verilmedi — tarayıcı adres çubuğundaki kilit simgesinden açabilirsiniz.', 'fail');
      } else {
        setResult($('notifyResult'), 'Bildirim izni verildi. "Test Bildirimi" ile deneyin.', 'ok');
        App.sound.chime();
      }
    } catch (e) {
      setResult($('notifyResult'), 'İzin alınamadı: ' + e.message, 'fail');
    } finally {
      if (btn) btn.disabled = false;
      const el = $('notifyEnabled');
      if (el) el.checked = App.settings().notifyEnabled === true;
      refreshNotifyPanel();
    }
  }

  async function onNotifyTest() {
    const btn = $('notifyTestBtn');
    if (btn) btn.disabled = true;
    try {
      await App.notify.test();
      setResult($('notifyResult'), 'Test bildirimi gönderildi.', 'ok');
    } catch (e) {
      setResult($('notifyResult'), 'Test başarısız: ' + e.message, 'fail');
      App.sound.alarm();
    } finally {
      if (btn) btn.disabled = false;
      const el = $('notifyEnabled');
      if (el) el.checked = App.settings().notifyEnabled === true;
      refreshNotifyPanel();
    }
  }

  async function onPushToggle() {
    const btn = $('pushToggleBtn');
    if (btn) btn.disabled = true;
    try {
      const st = await App.notify.pushState();
      if (st.subscribed) {
        await App.notify.unsubscribe();
        setResult($('pushResult'), 'Arka plan bildirimi kapatıldı.', 'ok');
      } else {
        await App.notify.push();
        setResult($('pushResult'), 'Arka plan bildirimi açıldı — panel kapalıyken de bildirim gelir.', 'ok');
        App.sound.chime();
      }
    } catch (e) {
      setResult($('pushResult'), 'İşlem başarısız: ' + e.message, 'fail');
      App.sound.alarm();
    } finally {
      if (btn) btn.disabled = false;
      const el = $('notifyEnabled');
      if (el) el.checked = App.settings().notifyEnabled === true;
      refreshNotifyPanel();
    }
  }

  /* ------------------------------------------------- Cihazlarım paneli --- */
  /* Çoklu cihaz: hesaba bağlı kartlar arasında geçiş. Panel her an tek
     cihaza bağlıdır; seçim bir MQTT konusuna karşılık gelir. */
  let devSig = '';

  function devEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function devBadge(status) {
    if (status === 'release_pending') return { t: 'serbest bırakılıyor', k: 'warn' };
    if (status === 'unbound') return { t: 'bağlanmamış', k: '' };
    return { t: 'bağlı', k: 'ok' };
  }

  async function refreshDevices(force) {
    const box = $('devList');
    if (!box || !App.Devices) return;

    let rows = [];
    try {
      rows = await App.Devices.list();
    } catch (e) {
      setResult($('devResult'), 'Cihaz listesi alınamadı: ' + e.message, 'fail');
      return;
    }

    const info = App.Devices.activeInfo();
    const act = $('devActive');
    if (act) {
      act.textContent = info.id
        ? (info.id + '  ·  konu: ' + (info.topic || '—'))
        : 'otomatik (ilk görülen cihaz)';
    }

    /* Liste değişmediyse formu yeniden çizme (yazılan konu kaybolmasın). */
    const sig = rows.map(function (d) { return d.id + ':' + d.status + ':' + (d.active ? 1 : 0); }).join('|');
    if (!force && sig === devSig) return;
    devSig = sig;

    if (!rows.length) {
      box.innerHTML = '<p class="help">Hesabınıza bağlı cihaz yok. Bağlamak için ' +
        '<a href="#accountCard">Hesap &amp; Roller</a> bölümünü kullanın. Panel bir cihazı ' +
        'gördüğünde (MQTT durumu) cihaz buraya otomatik eklenir.</p>';
      return;
    }

    box.innerHTML = rows.map(function (d) {
      const st = devBadge(d.status);
      return '' +
        '<div class="dev-row' + (d.active ? ' is-active' : '') + '" role="listitem">' +
          '<div class="dev-main">' +
            '<strong>' + devEsc(d.id) + '</strong>' +
            ' <span class="dev-badge ' + st.k + '">' + st.t + '</span>' +
            (d.active ? ' <span class="dev-badge ok">aktif</span>' : '') +
            (d.label ? '<div class="help" style="margin:0.3rem 0 0;">' + devEsc(d.label) + '</div>' : '') +
            '<label class="dev-topic">MQTT konusu' +
              '<input type="text" data-dev-topic="' + devEsc(d.id) + '" value="' + devEsc(d.topic) + '" ' +
                'placeholder="deneyap/kart1" spellcheck="false" autocomplete="off">' +
            '</label>' +
          '</div>' +
          '<div class="dev-actions">' +
            '<button class="btn' + (d.active ? ' ghost' : '') + '" type="button" ' +
              'data-dev-use="' + devEsc(d.id) + '"' + (d.active ? ' disabled' : '') + '>' +
              (d.active ? 'Kullanımda' : 'Bu Cihazı Kullan') +
            '</button>' +
          '</div>' +
        '</div>';
    }).join('');

    setResult($('devResult'), rows.length + ' cihaz listelendi.', 'ok');
  }

  function wireDevices() {
    const box = $('devList');
    if (!box) return;

    box.addEventListener('click', async function (e) {
      const btn = e.target.closest ? e.target.closest('[data-dev-use]') : null;
      if (!btn) return;
      const id = btn.getAttribute('data-dev-use');
      try {
        const topic = App.Devices.activate(id);
        const mt = $('mqttTopic');
        if (mt && topic) mt.value = topic;
        if (App.sound && App.sound.chime) App.sound.chime();
        setResult($('devResult'), id + ' aktif edildi' + (topic ? ' — konu: ' + topic : '') +
          '. Panel yeni cihaza bağlanıyor.', 'ok');
        await refreshDevices(true);
      } catch (err) {
        setResult($('devResult'), 'Aktif edilemedi: ' + err.message, 'fail');
      }
    });

    box.addEventListener('change', function (e) {
      const inp = e.target.closest ? e.target.closest('[data-dev-topic]') : null;
      if (!inp) return;
      const id = inp.getAttribute('data-dev-topic');
      const topic = String(inp.value || '').trim();
      App.Devices.setTopic(id, topic);
      /* Aktif cihazın konusu değiştiyse taşımayı hemen yönlendir. */
      if (App.Devices.currentId() === id) {
        App.saveSettings({ mqttTopic: topic });
        const mt = $('mqttTopic');
        if (mt) mt.value = topic;
        try { if (App.mqtt) App.mqtt.restart(); } catch (err) { /* yoksay */ }
      }
      setResult($('devResult'), 'Konu kaydedildi: ' + id + ' → ' + (topic || '(boş)'), 'ok');
    });

    const r = $('devRefreshBtn');
    if (r) r.addEventListener('click', function () { refreshDevices(true); });

    const a = $('devAutoBtn');
    if (a) a.addEventListener('click', async function () {
      App.Devices.clearActive();
      setResult($('devResult'),
        'Aktif seçim bırakıldı — panel ilk gördüğü cihazı otomatik seçer.', 'ok');
      await refreshDevices(true);
    });

    /* Yeni cihaz görülürse (MQTT durumu) liste kendiliğinden güncellensin;
       değişiklik yoksa form yeniden çizilmez. */
    refreshDevices(true);
    setInterval(function () { refreshDevices(false); }, 10000);
  }

  async function testConnection() {
    const btn = $('testBtn');
    const out = $('testResult');
    const s = App.settings();
    btn.disabled = true;

    /* Hangi taşımanın sınandığı açıkça yazılır: MQTT'de "gecikme" yayıncıya
       gidiş-dönüş demek, HTTP'de cihazın kendisine demek. */
    const viaMqtt = App.api.transport();
    setResult(out, viaMqtt
      ? 'Yayıncı üzerinden cihaz aranıyor: ' + (s.mqttUrl || '(adres boş)') + ' …'
      : 'Cihaz aranıyor: ' + App.baseUrl() + ' …');
    try {
      const r = await App.api.ping();
      if (App.deviceOnline === false) App.setConnBadge('offline', 'Cihaz Çevrimdışı');
      else App.setConnBadge('live', 'Bağlantı Canlı');
      App.sound.chime();
      App.haptic(25);
      setResult(out,
        'Bağlantı başarılı — Gecikme: ' + r.ms + ' ms · Firmware: v' + (r.status.fw || '?') +
        (viaMqtt
          ? (r.status.mqtt ? ' · MQTT: bağlı' : ' · MQTT: bağlı değil')
          : (r.status.fs ? ' · LittleFS devrede' : ' · LittleFS bulunamadı (API-only)')), 'ok');
    } catch (err) {
      App.setConnBadge('offline', 'Bağlantı Yok');
      App.sound.alarm();
      setResult(out, 'Bağlantı kurulamadı: ' + err.message, 'fail');
    } finally {
      btn.disabled = false;
    }
  }

  /* ------------------------------------------- Ayar Yedekleme (Dışa / İçe Aktar) */

  function exportSettings() {
    const current = App.settings();
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(current, null, 2));
    const dlAnchor = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', 'deneyap-ayarlar-' + dateStr + '.json');
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    document.body.removeChild(dlAnchor);
    App.sound.chime();
    App.toast('Ayarlar JSON dosyası olarak indirildi', { kind: 'ok' });
  }

  function setupImportSettings() {
    const importBtn = $('importBtn');
    const fileInput = $('importFileInput');
    if (!importBtn || !fileInput) return;

    importBtn.addEventListener('click', function () {
      fileInput.click();
    });

    fileInput.addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function (evt) {
        try {
          const parsed = JSON.parse(evt.target.result);
          if (typeof parsed !== 'object' || parsed === null) {
            throw new Error('Geçersiz dosya formatı.');
          }
          App.saveSettings(parsed);
          fillForm();
          App.applyTheme(parsed.theme);
          App.sound.chime();
          App.toast('Ayarlar başarıyla içe aktarıldı', { kind: 'ok' });
        } catch (err) {
          App.sound.alarm();
          App.toast('Ayar dosyası okunamadı: ' + err.message, { kind: 'danger' });
        }
        fileInput.value = '';
      };
      reader.readAsText(file);
    });
  }

  /* ------------------------------------------------------------- Bakım */

  async function checkUpdate() {
    const out = $('maintResult');
    if (!('serviceWorker' in navigator)) {
      setResult(out, 'Bu tarayıcı Service Worker desteklemiyor.', 'fail');
      return;
    }
    setResult(out, 'Yeni sürüm denetleniyor…');
    try {
      reg = reg || await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setResult(out, 'Kayıtlı Service Worker yok. Sayfayı yenileyip tekrar deneyin.', 'fail');
        return;
      }
      await reg.update();
      if (reg.waiting) {
        setResult(out, 'Yeni sürüm bulundu, etkinleştiriliyor…', 'ok');
        App.reloadOnControllerChange();
        App.activateUpdate(reg);
      } else if (reg.installing) {
        setResult(out, 'Sürüm indiriliyor…', 'ok');
      } else {
        setResult(out, 'Uygulama zaten en son sürümde.', 'ok');
      }
    } catch (err) {
      setResult(out, 'Denetlenemedi: ' + err.message, 'fail');
    }
  }

  async function clearCache() {
    const out = $('maintResult');
    setResult(out, 'Önbellek temizleniyor…');
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(function (r) { return r.unregister(); }));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }
      App.resetSettings();
      setResult(out, 'Temizlendi, konsol yeniden yükleniyor…', 'ok');
      addTimer(setTimeout(function () { location.reload(); }, 600));
    } catch (err) {
      setResult(out, 'Temizlenemedi: ' + err.message, 'fail');
    }
  }

  async function resetSettings() {
    const out = $('maintResult');
    if (!window.confirm('Tüm panel ve cihaz ayarları fabrika varsayılanlarına döndürülsün mü?')) return;

    /* Eski kod yalnızca localStorage'ı sıfırlıyordu; onay metni ise "panel VE
       cihaz" diyordu, yani cihazdaki (NVS) eşikler kalıcı kalıyordu. Cihaza da
       fabrika varsayılanlarını gönderiyoruz.
       DİKKAT: bunu App.resetSettings()'ten SONRA yapmak doğru değil — o çağrı
       taşıma (transport) seçimini de varsayılana döndürür ve komut gitemeyebilir. */
    let devErr = null;
    try {
      await App.api.saveSettings({
        gasWarn: App.DEFAULTS.gasWarn,
        gasDanger: App.DEFAULTS.gasDanger,
        rainInvert: App.DEFAULTS.rainInvert,
        autoControl: App.DEFAULTS.autoControl
      });
    } catch (err) {
      devErr = err;
    }

    App.resetSettings();
    fillForm();
    App.applyTheme('dark');
    App.sound.chime();

    setResult(out, devErr
      ? 'Panel sıfırlandı; cihaz ayarları güncellenemedi: ' + devErr.message
      : 'Panel ve cihaz ayarları fabrika varsayılanlarına döndürüldü.',
      devErr ? 'fail' : 'ok');
  }

  /* ------------------------------------------------------------- Başlatma */

  let boundForm = null;   /* hangi #settingsForm düğümüne bağlandık */
  let pendingTimers = [];

  function addTimer(id) {
    if (id) pendingTimers.push(id);
    return id;
  }

  function clearPendingTimers() {
    pendingTimers.forEach(function (t) {
      clearTimeout(t);
      clearInterval(t);
    });
    pendingTimers = [];
  }

  function destroy() {
    clearPendingTimers();
    boundForm = null;
  }

  function init() {
    const form = $('settingsForm');
    if (!form) return;
    /* Aynı DOM'a iki kez bağlanmayı engelle: hem doğrudan settings.html
       açılışında hem de SPA geçişinde çağrılabilir. */
    if (boundForm === form) return;
    destroy();
    boundForm = form;
    fillForm();
    App.applyTheme();

    if (App.init3DTilt) App.init3DTilt();
    /* Eski App.initParallax() kaldırıldı; tüm scroll/lerp yönetimi parallax.js motorunda */
    if (App.initRipple) App.initRipple();

    $('settingsForm').addEventListener('submit', save);
    $('testBtn').addEventListener('click', testConnection);
    $('transport').addEventListener('change', applyTransportVisibility);

    const tgT = $('tgTestBtn');
    if (tgT) tgT.addEventListener('click', function () { tgTest(false); });
    const tgD = $('tgDiscoverBtn');
    if (tgD) tgD.addEventListener('click', function () { tgTest(true); });
    const tgF = $('tgForgetBtn');
    if (tgF) tgF.addEventListener('click', tgForget);

    /* Bildirim paneli — tercihler yereldir, cihazla senkron edilmez. */
    const nPerm = $('notifyPermBtn');
    if (nPerm) nPerm.addEventListener('click', onNotifyPerm);
    const nTest = $('notifyTestBtn');
    if (nTest) nTest.addEventListener('click', onNotifyTest);
    const pToggle = $('pushToggleBtn');
    if (pToggle) pToggle.addEventListener('click', onPushToggle);

    ['notifySound', 'notifyGas', 'notifyWarn', 'notifyFlood',
      'notifyFlame', 'notifyVib', 'notifyOffline'].forEach(function (id) {
      const el = $(id);
      if (!el) return;
      el.addEventListener('change', function () {
        const patch = {};
        patch[id] = el.checked;
        App.saveSettings(patch);
        refreshNotifyPanel();
      });
    });
    const nEnabled = $('notifyEnabled');
    if (nEnabled) nEnabled.addEventListener('change', function () {
      if (!nEnabled.checked) {
        App.notify.disable();
        refreshNotifyPanel();
        return;
      }
      /* Onay kutusu açıldıysa hemen izin iste — izin yoksa kutu geri kapanır. */
      App.notify.enable().then(function (r) {
        if (!r.ok) nEnabled.checked = false;
        refreshNotifyPanel();
      });
    });
    refreshNotifyPanel();

    /* Cihazlarım (çoklu cihaz) paneli */
    wireDevices();

    /* Yöntem ya da yayıncı bilgisi değişince bağlantıyı tazele:
       eski yayıncıya bağlı kalmış bir istemci kalmasın. */
    ['mqttUrl', 'mqttUrl2', 'mqttTopic', 'mqttUser', 'mqttPass'].forEach(function (id) {
      const el = $(id);
      if (el) el.addEventListener('change', function () {
        App.saveSettings({
          transport: $('transport').value,
          mqttUrl: $('mqttUrl').value.trim(),
          mqttUrl2: $('mqttUrl2').value.trim(),
          mqttTopic: $('mqttTopic').value.trim(),
          mqttUser: $('mqttUser').value.trim()
        });
        if (App.mqtt) App.mqtt.restart();
      });
    });
    $('updateBtn').addEventListener('click', checkUpdate);
    $('clearCacheBtn').addEventListener('click', clearCache);
    $('resetBtn').addEventListener('click', resetSettings);

    const expBtn = $('exportBtn');
    if (expBtn) expBtn.addEventListener('click', exportSettings);
    setupImportSettings();

    /* Görsel Tema Seçici Dinleyicisi */
    document.querySelectorAll('input[name="theme"]').forEach(function (r) {
      r.addEventListener('change', function () {
        if (r.checked) {
          App.saveSettings({ theme: r.value });
          App.applyTheme(r.value);
          App.sound.click();
          App.haptic(20);
        }
      });
    });

    const themeBtn = $('themeToggleBtn');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        const cur = App.settings().theme || 'dark';
        const next = (cur === 'dark' || cur === 'amoled') ? 'light' : 'dark';
        App.saveSettings({ theme: next });
        App.applyTheme(next);
        const radio = document.querySelector('input[name="theme"][value="' + next + '"]');
        if (radio) radio.checked = true;
        App.sound.click();
        App.haptic(20);
      });
    }

    App.onSystemThemeChange(function () {
      const radio = document.querySelector('input[name="theme"][value="system"]');
      if (radio) radio.checked = true;
    });

    App.onUpdateReady = function () {
      $('maintResult').className = 'result ok';
      $('maintResult').textContent = 'Yeni sürüm indirildi.';
      $('updateBtn').textContent = 'Yeni Sürümü Etkinleştir';
    };
    App.registerServiceWorker().then(function (r) { reg = r; });
    App.setupPwaInstall();
    if (window.App && typeof window.App.initAccount === 'function') {
      window.App.initAccount();
    }
    if (window.App && typeof window.App.initProfile === 'function') {
      window.App.initProfile();
    }
    if (window.App && typeof window.App.initInvites === 'function') {
      window.App.initInvites();
    }
    refreshDeviceInfo().then(refreshTgInfo).catch(function () {
      refreshTgInfo().catch(function () {});
    });
  }

  window.App.initSettings = init;
  window.App.destroySettings = destroy;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if ($('settingsForm')) init();
    });
  } else {
    if ($('settingsForm')) init();
  }
})();