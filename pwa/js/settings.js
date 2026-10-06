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

    const soundEl = $('soundEnabled');
    if (soundEl) soundEl.checked = (s.soundEnabled !== false);

    const vibEl = $('vibrateEnabled');
    if (vibEl) vibEl.checked = (s.vibrateEnabled !== false);

    const themeRadio = document.querySelector('input[name="theme"][value="' + (s.theme || 'dark') + '"]');
    if (themeRadio) themeRadio.checked = true;

    const appVer = $('appVersion');
    if (appVer) appVer.textContent = 'v' + App.VERSION;
  }

  function readForm() {
    const themeEl = document.querySelector('input[name="theme"]:checked');
    const soundEl = $('soundEnabled');
    const vibEl = $('vibrateEnabled');

    return {
      transport: $('transport').value,
      mqttUrl: $('mqttUrl').value.trim(),
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
      soundEnabled: soundEl ? soundEl.checked : true,
      vibrateEnabled: vibEl ? vibEl.checked : true,
      theme: themeEl ? themeEl.value : 'dark'
    };
  }

  /* Yalnızca seçili yöntemin alanlarını göster: MQTT alanları ya da IP alanı.
   Karışık görünüm, hangi ayarın geçerli olduğunu bulmayı zorlaştırıyor. */
  function applyTransportVisibility() {
    const mqtt = $('transport').value === 'mqtt';
    ['mqttUrl', 'mqttTopic', 'mqttUser', 'mqttPass'].forEach(function (id) {
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

    App.saveSettings(v);
    App.applyTheme(v.theme);

    const submitBtn = document.querySelector('#settingsForm button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    setResult($('testResult'), 'Ayarlar cihaza gönderiliyor ve flash hafızaya yazılıyor…');

    try {
      await App.api.saveSettings({
        gasWarn: v.gasWarn,
        gasDanger: v.gasDanger,
        rainInvert: v.rainInvert,
        autoControl: v.autoControl
      });
      App.sound.chime();
      App.haptic(30);
      App.toast('Ayarlar ESP32 flash hafızasına ve panele kaydedildi', { kind: 'ok' });
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

          App.saveSettings({
            gasWarn: Number($('gasWarn').value),
            gasDanger: Number($('gasDanger').value),
            rainInvert: $('rainInvert').checked,
            autoControl: $('autoControl').checked
          });
        }
      }

      return s;
    } catch (err) {
      App.setConnBadge('offline', err.legacy ? 'Eski Firmware' : 'Bağlantı Yok');
      throw err;
    }
  }

  /* Bağlantı & Gecikme Testi */
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
      setTimeout(function () { location.reload(); }, 600);
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

  function init() {
    fillForm();
    App.applyTheme();

    App.init3DTilt();
    App.initParallax();
    App.initRipple();

    $('settingsForm').addEventListener('submit', save);
    $('testBtn').addEventListener('click', testConnection);
    $('transport').addEventListener('change', applyTransportVisibility);
    /* Yöntem ya da yayıncı bilgisi değişince bağlantıyı tazele:
       eski yayıncıya bağlı kalmış bir istemci kalmasın. */
    ['mqttUrl', 'mqttTopic', 'mqttUser', 'mqttPass'].forEach(function (id) {
      const el = $(id);
      if (el) el.addEventListener('change', function () {
        App.saveSettings({
          transport: $('transport').value,
          mqttUrl: $('mqttUrl').value.trim(),
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
    refreshDeviceInfo().catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();