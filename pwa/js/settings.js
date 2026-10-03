/* ==========================================================================
   settings.js — Ayarlar sayfası denetleyicisi.
   Ayar formu, bağlantı testi, cihaz bilgileri ve bakım işlemleri
   (sürüm kontrolü, önbellek temizliği, sıfırlama).
   ========================================================================== */

(function () {
  'use strict';

  const App = window.App;
  const $ = function (id) { return document.getElementById(id); };

  let reg = null;   // Service Worker kaydı

  /* ------------------------------------------------------------ form doldurma */

  function fillForm() {
    const s = App.settings();
    $('host').value = s.host;
    $('token').value = s.token;
    $('pollMs').value = String(s.pollMs);
    $('gasWarn').value = s.gasWarn;
    $('gasDanger').value = s.gasDanger;
    $('rainInvert').checked = !!s.rainInvert;
    $('autoControl').checked = !!s.autoControl;

    const themeRadio = document.querySelector('input[name="theme"][value="' + s.theme + '"]');
    if (themeRadio) themeRadio.checked = true;

    /* Bildirim anahtarı izin durumuna göre senkronlanır, kayıttan okunmaz */
    syncNotifyUI();

    $('appVersion').textContent = 'v' + App.VERSION;
  }

  function readForm() {
    const themeEl = document.querySelector('input[name="theme"]:checked');
    return {
      host: $('host').value.trim(),
      token: $('token').value.trim(),
      pollMs: Number($('pollMs').value),
      gasWarn: Number($('gasWarn').value),
      gasDanger: Number($('gasDanger').value),
      rainInvert: $('rainInvert').checked,
      autoControl: $('autoControl').checked,
      theme: themeEl ? themeEl.value : 'system'
    };
  }

  function setResult(el, text, kind) {
    el.textContent = text;
    el.className = 'result' + (kind ? ' ' + kind : '');
  }

  /* ------------------------------------------------------- bildirimler */

  /* Anahtar durumunu ve açıklama metnini izin durumuna göre göster.
     Tarayıcı izni geri alınmışsa anahtarı kapalı görünür. */
  function syncNotifyUI() {
    const el = $('notifyDanger');
    if (!el) return;
    const out = $('notifyState');
    const help = $('notifyHelp');
    const N = window.App.notify;

    if (!N || !N.supported()) {
      el.checked = false;
      el.disabled = true;
      setResult(out, 'Bu tarayıcı bildirimleri desteklemiyor.', 'fail');
      return;
    }

    el.disabled = false;
    const p = N.permission();
    el.checked = (p === 'granted') && !!App.settings().notifyDanger;

    if (p === 'denied') {
      setResult(out, 'İzin reddedilmiş. Tarayıcı ayarlarından geri açmalısın.', 'fail');
    } else if (p === 'default') {
      setResult(out, 'Henüz izin verilmedi — anahtarı açınca sorulacak.', '');
    } else if (el.checked) {
      setResult(out, 'Bildirimler açık.', 'ok');
    } else {
      setResult(out, 'İzin verildi ama kapalı.', '');
    }

    /* iOS'ta ana ekrana eklenmeden bildirim gelmez; sessizce çalışmayan
       bir özellik bırakmayalım, açıkça söyleyelim. */
    if (help) {
      help.textContent = N.needsInstall
        ? 'Bu cihaz iOS: bildirimler yalnızca paneli Safari\'den ' +
          '"Paylaş → Ana Ekrana Ekle" yaptıktan sonra çalışır.'
        : 'Bildirim yalnızca panel açıkken çalışır ve aynı seviye için en ' +
          'fazla 90 saniyede bir tekrar gönderir. İzni tarayıcı verir; ' +
          'panel kendi kendine izin alamaz.';
    }
  }

  async function onNotifyToggle(e) {
    const el = e.target;
    const N = window.App.notify;
    const durum = $('notifyState');

    if (!el.checked) {
      N.disable();
      syncNotifyUI();
      App.toast('Bildirimler kapatıldı');
      return;
    }

    /* İzin istemi bir kullanıcı dokunuşundan sonra çağrılmalı */
    const sonuc = await N.enable();
    syncNotifyUI();

    if (sonuc.ok) {
      App.toast('Gaz tehlikesi bildirimleri açıldı', { kind: 'ok' });
    } else if (sonuc.permission === 'denied') {
      setResult(durum, 'İzin verilmedi. Tarayıcı ayarlarından açmalısın.', 'fail');
      App.toast('Bildirim izni verilmedi', { kind: 'danger' });
    } else {
      setResult(durum, 'İzin alınamadı.', 'fail');
    }
  }

  /* -------------------------------------------------------------- kayıt */

  function save(e) {
    if (e) e.preventDefault();
    const v = readForm();

    if (v.host && !/^https?:\/\/.+/i.test(v.host)) {
      setResult($('testResult'), 'Cihaz adresi http:// ile başlamalı.', 'fail');
      $('host').focus();
      return;
    }
    if (!(v.gasWarn > 0) || !(v.gasDanger > 0)) {
      setResult($('testResult'), 'Gaz eşikleri sıfırdan büyük olmalı.', 'fail');
      return;
    }
    if (v.gasWarn >= v.gasDanger) {
      setResult($('testResult'),
        'Uyarı eşiği (' + v.gasWarn + ') tehlike eşiğinden (' + v.gasDanger + ') küçük olmalı.',
        'fail');
      $('gasWarn').focus();
      return;
    }

    App.saveSettings(v);
    App.applyTheme(v.theme);
    App.toast('Ayarlar kaydedildi', { kind: 'ok' });
    setResult($('testResult'), 'Kaydedildi.', 'ok');
    refreshDeviceInfo();
  }

  /* ------------------------------------------------------- cihaz bilgileri */

  async function refreshDeviceInfo() {
    try {
      const s = await App.api.status();
      App.setConnBadge('live', 'Bağlantı canlı');
      App.renderDeviceInfo(s);
      return s;
    } catch (err) {
      App.setConnBadge('offline', err.legacy ? 'eski firmware' : 'bağlantı yok');
      ['fw', 'ip', 'rssi', 'heap', 'uptime'].forEach(function (id) {
        const el = $(id);
        if (el) el.textContent = '—';
      });
      $('fsState').textContent = '—';
      throw err;
    }
  }

  /* Bağlantı testi düğmesi */
  async function testConnection() {
    const btn = $('testBtn');
    const out = $('testResult');
    btn.disabled = true;
    setResult(out, 'Cihaz aranıyor: ' + App.baseUrl() + ' …');
    try {
      const r = await App.api.ping();
      App.setConnBadge('live', 'Bağlantı canlı');
      App.renderDeviceInfo(r.status);
      setResult(out,
        'Bağlantı başarılı — ' + r.ms + ' ms · firmware v' + (r.status.fw || '?') +
        (r.status.fs ? '' : ' · arayüz dosyaları yüklenmemiş'), 'ok');
    } catch (err) {
      App.setConnBadge('offline', 'bağlantı yok');
      setResult(out, 'Bağlantı kurulamadı: ' + err.message, 'fail');
    } finally {
      btn.disabled = false;
    }
  }

  /* -------------------------------------------------------------- bakım */

  async function checkUpdate() {
    const out = $('maintResult');
    if (!('serviceWorker' in navigator)) {
      setResult(out, 'Bu tarayıcı Service Worker desteklemiyor.', 'fail');
      return;
    }
    setResult(out, 'Yeni sürüm aranıyor…');
    try {
      reg = reg || await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setResult(out, 'Kayıtlı Service Worker yok. Sayfayı yeniden yükleyip tekrar deneyin.', 'fail');
        return;
      }
      await reg.update();
      if (reg.waiting) {
        setResult(out, 'Yeni sürüm bulundu, etkinleştiriliyor…', 'ok');
        App.reloadOnControllerChange();
        App.activateUpdate(reg);
      } else if (reg.installing) {
        setResult(out, 'Sürüm indiriliyor, bitince bildirim çıkacak.', 'ok');
      } else {
        setResult(out, 'Uygulama güncel.', 'ok');
      }
    } catch (err) {
      setResult(out, 'Kontrol edilemedi: ' + err.message, 'fail');
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
      setResult(out, 'Temizlendi, yeniden yükleniyor…', 'ok');
      setTimeout(function () { location.reload(); }, 600);
    } catch (err) {
      setResult(out, 'Temizlenemedi: ' + err.message, 'fail');
    }
  }

  function resetSettings() {
    const out = $('maintResult');
    if (!window.confirm('Tüm ayarlar varsayılana döndürülsün mü?\n' +
                        '(cihaz bağlantısı ve eşikler sıfırlanır)')) return;
    App.resetSettings();
    fillForm();
    App.applyTheme();
    setResult(out, 'Ayarlar sıfırlandı.', 'ok');
  }

  /* -------------------------------------------------------------- başlat */

  function init() {
    fillForm();
    App.applyTheme();

    $('settingsForm').addEventListener('submit', save);
    $('testBtn').addEventListener('click', testConnection);
    $('updateBtn').addEventListener('click', checkUpdate);
    $('clearCacheBtn').addEventListener('click', clearCache);
    $('resetBtn').addEventListener('click', resetSettings);

    /* Bildirim anahtarı kaydetmeye gerek yok, anında etkinleşir */
    const notifyEl = $('notifyDanger');
    if (notifyEl) notifyEl.addEventListener('change', onNotifyToggle);

    /* Tema seçimi anında uygulansın (kaydetmeye gerek kalmadan) */
    document.querySelectorAll('input[name="theme"]').forEach(function (r) {
      r.addEventListener('change', function () {
        if (r.checked) {
          App.saveSettings({ theme: r.value });
          App.applyTheme(r.value);
        }
      });
    });

    const themeBtn = $('themeToggleBtn');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        const next = App.isDark() ? 'light' : 'dark';
        App.saveSettings({ theme: next });
        App.applyTheme(next);
        const radio = document.querySelector('input[name="theme"][value="' + next + '"]');
        if (radio) radio.checked = true;
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

    /* Sayfa açılışında sessizce bir kez dene, hata gösterme */
    refreshDeviceInfo().catch(function () { /* ayarlar sayfası kapalı da kalabilir */ });
    setInterval(function () {
      if (!document.hidden) refreshDeviceInfo().catch(function () {});
    }, 15000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();