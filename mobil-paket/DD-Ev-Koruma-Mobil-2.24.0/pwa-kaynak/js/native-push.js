/* ==========================================================================
   native-push.js — Android uygulamasına özel bildirimler
   --------------------------------------------------------------------------
   Web Push, WebView içinde çalışmaz. Bu yüzden uygulama sürümünde Firebase
   Cloud Messaging (FCM) kullanılır:

     • Uygulama açılınca FCM token'ı alınır ve hesaba bağlanır
       (Firestore: push_tokens).
     • Sunucu (api/push.js) alarm anında hem Web Push hem FCM gönderir.
     • "Canlı durum" bildirimi, bildirim panelinde sürekli duran sessiz bir
       satırdır; uygulama açıkken güncellenir.
     • Ana ekran widget'ı da aynı veriyle tazelenir.

   Tarayıcıda (köprü yoksa) tüm işlevler sessizce devre dışı kalır.
   ========================================================================== */

(function () {
  'use strict';

  var App = window.App;
  if (!App) return;

  var FLAG_ALARM = 'dd.native.alarm.v1';
  var FLAG_STATUS = 'dd.native.status.v1';
  var TOKEN_KEY = 'dd.native.token.v1';

  var MODE_LABEL = {
    home: 'Evde', night: 'Gece', away: 'Tatil', off: 'İzleme'
  };

  var permissionWaiter = null;
  var lastStatusSync = 0;
  var lastWidgetSync = 0;

  function bridge() {
    try {
      if (window.AndroidApp && typeof window.AndroidApp.fcmToken === 'function') {
        return window.AndroidApp;
      }
    } catch (e) { /* yoksay */ }
    return null;
  }

  function supported() {
    return !!bridge();
  }

  function permission() {
    var b = bridge();
    if (!b || typeof b.notificationPermission !== 'function') return 'unsupported';
    try { return b.notificationPermission(); } catch (e) { return 'unsupported'; }
  }

  function clock(ms) {
    try {
      return new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return '--:--'; }
  }

  function currentUid() {
    try {
      var s = App.Auth && App.Auth.snapshot ? App.Auth.snapshot() : null;
      return (s && s.user && s.user.id) || '';
    } catch (e) { return ''; }
  }

  function savedToken() {
    try {
      var raw = localStorage.getItem(TOKEN_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function rememberToken(token, uid) {
    try {
      localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: token, uid: uid, at: Date.now() }));
    } catch (e) { /* yoksay */ }
  }

  function forgetToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* yoksay */ }
  }

  function alarmEnabled() {
    try { return localStorage.getItem(FLAG_ALARM) === '1'; } catch (e) { return false; }
  }

  function statusEnabled() {
    try { return localStorage.getItem(FLAG_STATUS) === '1'; } catch (e) { return false; }
  }

  /* ------------------------------------------------------------- kayıt */

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function register() {
    var b = bridge();
    if (!b) return { ok: false, reason: 'web' };

    var token = '';
    try { token = b.fcmToken() || ''; } catch (e) { token = ''; }

    /* Token ilk açılışta birkaç saniye gecikebilir; kısa süre bekle. */
    for (var i = 0; !token && i < 12; i++) {
      await sleep(500);
      try { token = b.fcmToken() || ''; } catch (e) { token = ''; }
    }
    if (!token) return { ok: false, reason: 'token' };

    var uid = currentUid();
    if (!uid) return { ok: false, reason: 'auth' };
    if (!App.FB || typeof App.FB.saveFcmToken !== 'function') {
      return { ok: false, reason: 'fb' };
    }

    var prev = savedToken();
    var version = '';
    try { version = b.version ? b.version() : ''; } catch (e) { version = ''; }

    await App.FB.saveFcmToken(uid, token, {
      platform: 'android',
      app_version: version
    });

    /* Token yenilendiyse eski kaydı temizle (aynı hesap, yeni cihaz kimliği). */
    if (prev && prev.token && prev.token !== token && prev.uid === uid) {
      try { await App.FB.deleteFcmToken(uid, prev.token); } catch (e) { /* yoksay */ }
    }

    rememberToken(token, uid);
    syncAll();
    return { ok: true, token: token };
  }

  /* ------------------------------------------------------- izin isteği */

  function waitPermission(timeoutMs) {
    if (permission() === 'granted') return Promise.resolve('granted');

    return new Promise(function (resolve) {
      var done = false;
      var timer = 0;
      var poll = 0;

      function finish(state) {
        if (done) return;
        done = true;
        permissionWaiter = null;
        clearTimeout(timer);
        clearInterval(poll);
        resolve(state);
      }

      permissionWaiter = finish;
      timer = setTimeout(function () { finish(permission()); }, timeoutMs || 25000);
      poll = setInterval(function () {
        if (permission() === 'granted') finish('granted');
      }, 600);
    });
  }

  async function enable() {
    if (!supported()) return { ok: false, reason: 'web' };

    if (permission() === 'denied') {
      /* İzin kalıcı olarak reddedilmiş veya sistemde kapatılmış: yalnızca
         sistem ayarlarından açılabilir. Kullanıcıyı doğrudan oraya götür. */
      try { bridge().openNotificationSettings(); } catch (e) { /* yoksay */ }
      return { ok: false, reason: 'permission' };
    }

    if (permission() !== 'granted') {
      try { bridge().requestNotifications(); } catch (e) { /* yoksay */ }
      var state = await waitPermission();
      if (state !== 'granted') return { ok: false, reason: 'permission' };
    }

    var r = await register();
    if (!r.ok) return r;

    try { localStorage.setItem(FLAG_ALARM, '1'); } catch (e) { /* yoksay */ }
    syncAll();
    updateUi();
    return { ok: true };
  }

  async function disable() {
    var b = bridge();
    var uid = currentUid();
    var saved = savedToken();

    try { localStorage.removeItem(FLAG_ALARM); } catch (e) { /* yoksay */ }

    if (b && saved && saved.token && uid && App.FB && App.FB.deleteFcmToken) {
      try { await App.FB.deleteFcmToken(uid, saved.token); } catch (e) { /* yoksay */ }
    }
    forgetToken();
    setStatusNotification(false);
    updateUi();
    return { ok: true };
  }

  /* ------------------------------------------------------ test bildirimi */

  async function test() {
    if (!supported()) return { ok: false, reason: 'web' };
    if (permission() !== 'granted') return { ok: false, reason: 'permission' };
    if (!currentUid()) return { ok: false, reason: 'auth' };

    var token = '';
    try { token = await App.FB.token(); } catch (e) { token = ''; }
    if (!token) return { ok: false, reason: 'auth' };

    var res = await fetch('/api/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ test: true })
    });

    var body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!res.ok) {
      return {
        ok: false,
        reason: 'server',
        error: (body && (body.error || body.message)) || ('HTTP ' + res.status)
      };
    }
    return body || { ok: true };
  }

  /* ------------------------------------------------ canlı durum bildirimi */

  function stateInfo() {
    var d = App.lastTelemetry ? App.lastTelemetry() : null;
    var s = App.settings ? App.settings() : {};
    var ppm = Number(d && d.gasPpm) || 0;
    var warn = Number(d && d.gasWarn) || Number(s.gasWarn) || 400;
    var danger = Number(d && d.gasDanger) || Number(s.gasDanger) || 800;

    var state = 'unknown';
    var title = 'Durum bekleniyor';

    if (App.api && App.api.transport && App.api.transport() && App.deviceOnline === false) {
      state = 'offline';
      title = 'Cihaz çevrimdışı';
    } else if (d) {
      if (d.flame) { state = 'danger'; title = 'ALEV ALARMI'; }
      else if (d.vib) { state = 'danger'; title = 'SARSINTI ALARMI'; }
      else if (d.flood) { state = 'danger'; title = 'SEL TEHLİKESİ'; }
      else if (d.gasFault) { state = 'warn'; title = 'Gaz sensörü arızalı'; }
      else if (ppm >= danger) { state = 'danger'; title = 'GAZ TEHLİKESİ'; }
      else if (ppm >= warn) { state = 'warn'; title = 'Gaz uyarısı'; }
      else { state = 'ok'; title = 'Sistem güvende'; }
    }

    var mode = 'home';
    try {
      mode = document.body.getAttribute('data-mode') || (s.mode || 'home');
    } catch (e) { mode = 'home'; }
    var modeLabel = MODE_LABEL[mode] || 'Evde';

    var gas = d && d.gasFault ? 'gaz okunamıyor'
            : (ppm ? ppm.toLocaleString('tr-TR') + ' ppm' : 'gaz 0 ppm');

    var body = (d ? gas : 'veri yok') + ' · ' + modeLabel + ' · ' + clock(Date.now());

    var big = title;
    if (d) {
      big += '\nGaz: ' + gas
          + ' · Su: %' + (Number(d.rainPct) || 0)
          + '\nMod: ' + modeLabel
          + ' · Cihaz: ' + (d.dev || '—')
          + '\nSon güncelleme: ' + clock(Date.now());
    } else {
      big += '\nCanlı veri bekleniyor.';
    }

    return { state: state, title: title, body: body, big: big };
  }

  function setStatusNotification(enabled) {
    try {
      localStorage.setItem(FLAG_STATUS, enabled ? '1' : '0');
    } catch (e) { /* yoksay */ }

    var b = bridge();
    if (!b || typeof b.setStatusNotification !== 'function') return;

    if (enabled && permission() !== 'granted') {
      try { localStorage.setItem(FLAG_STATUS, '0'); } catch (e) { /* yoksay */ }
      updateUi();
      return;
    }

    if (!enabled) {
      try {
        b.setStatusNotification(JSON.stringify({ enabled: false }));
      } catch (e) { /* yoksay */ }
      updateUi();
      return;
    }

    var info = stateInfo();
    try {
      b.setStatusNotification(JSON.stringify({
        enabled: true,
        title: info.title,
        body: info.body,
        big: info.big,
        url: location.origin + '/'
      }));
    } catch (e) { /* yoksay */ }
    updateUi();
  }

  function refreshStatus(force) {
    if (!supported()) return;
    var now = Date.now();
    if (!force && now - lastStatusSync < 12000) return;
    lastStatusSync = now;

    if (statusEnabled() && permission() === 'granted') {
      var info = stateInfo();
      try {
        bridge().setStatusNotification(JSON.stringify({
          enabled: true,
          title: info.title,
          body: info.body,
          big: info.big,
          url: location.origin + '/'
        }));
      } catch (e) { /* yoksay */ }
    }

    if (now - lastWidgetSync > 45000) {
      lastWidgetSync = now;
      var w = stateInfo();
      try {
        bridge().setWidgetStatus(JSON.stringify({
          status: w.title,
          detail: w.body,
          ok: w.state === 'ok'
        }));
      } catch (e) { /* yoksay */ }
    }
  }

  function syncAll() {
    if (!supported()) return;
    refreshStatus(true);
  }

  /* --------------------------------------------------------------- arayüz */

  function updateUi() {
    var b = bridge();
    var perm = permission();
    var active = alarmEnabled() && perm === 'granted';

    var stateEl = document.getElementById('nativePushState');
    if (stateEl) {
      if (!b) {
        stateEl.textContent = 'Bu özellik yalnızca Android uygulamasında çalışır. Tarayıcıda web bildirimi kullanılır.';
      } else if (perm === 'granted' && active) {
        stateEl.textContent = 'Açık · uygulama kapalıyken de alarm bildirimi gelir.';
      } else if (perm === 'granted') {
        stateEl.textContent = 'Bildirim izni verildi; alarm bildirimleri kapalı.';
      } else if (perm === 'denied') {
        stateEl.textContent = 'Bildirim izni reddedilmiş. Android Ayarlar → Uygulamalar → Deneyap Ev Koruma → Bildirimler yolundan açın.';
      } else {
        stateEl.textContent = 'Kapalı · açmak için izin verin.';
      }
    }

    var toggle = document.getElementById('nativePushToggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', active ? 'true' : 'false');
      toggle.textContent = active ? 'Bildirimleri kapat' : 'Bildirimleri aç';
      toggle.disabled = !b;
    }

    var statusToggle = document.getElementById('nativeStatusToggle');
    if (statusToggle) {
      var on = statusEnabled() && perm === 'granted';
      statusToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      statusToggle.textContent = on ? 'Canlı durumu kapat' : 'Canlı durumu aç';
      statusToggle.disabled = !b || perm !== 'granted';
    }

    var testBtn = document.getElementById('nativePushTest');
    if (testBtn) testBtn.disabled = !b || perm !== 'granted';

    /* Yeni ayar sayfası: switch (checkbox) biçimi. */
    var alarmSwitch = document.getElementById('nativePushEnabled');
    if (alarmSwitch) {
      alarmSwitch.checked = active;
      alarmSwitch.disabled = !b;
    }

    var statusSwitch = document.getElementById('nativeStatusEnabled');
    if (statusSwitch) {
      statusSwitch.checked = statusEnabled() && perm === 'granted';
      statusSwitch.disabled = !b;
    }

    var settingsBtn = document.getElementById('nativePushSettings');
    if (settingsBtn) settingsBtn.hidden = !b;

    var help = document.getElementById('nativePushHelp');
    if (help) help.hidden = !b;
  }

  function result(text, kind) {
    var el = document.getElementById('nativePushResult');
    if (!el) {
      if (text && App.toast) App.toast(text, { kind: kind || 'ok' });
      return;
    }
    el.textContent = text || '';
    el.dataset.kind = kind || '';
  }

  function bindUi() {
    var alarmSwitch = document.getElementById('nativePushEnabled');
    if (alarmSwitch) {
      alarmSwitch.addEventListener('change', function () {
        if (alarmSwitch.checked) {
          result('Bildirim izni isteniyor…');
          enable().then(function (r) {
            if (r.ok) {
              result('Alarm bildirimleri açıldı.', 'ok');
              if (App.toast) App.toast('Alarm bildirimleri açıldı', { kind: 'ok' });
            } else if (r.reason === 'permission') {
              result('Bildirim izni verilmedi. Android ayarlarından izin verebilirsiniz.', 'warn');
            } else if (r.reason === 'web') {
              result('Bu özellik yalnızca Android uygulamasında çalışır.', 'warn');
            } else if (r.reason === 'auth') {
              result('Önce hesabınıza giriş yapın.', 'warn');
            } else if (r.reason === 'token') {
              result('Bildirim kimliği hazırlanıyor; birkaç saniye sonra tekrar deneyin.', 'warn');
            } else {
              result('Bildirimler açılamadı. Bağlantıyı kontrol edin.', 'danger');
            }
            updateUi();
          }).catch(function (e) {
            result('Bildirimler açılamadı: ' + (e && e.message ? e.message : 'bilinmeyen hata'), 'danger');
            updateUi();
          });
        } else {
          disable().then(function () {
            result('Alarm bildirimleri kapatıldı.');
            updateUi();
          });
        }
      });
    }

    var statusSwitch = document.getElementById('nativeStatusEnabled');
    if (statusSwitch) {
      statusSwitch.addEventListener('change', function () {
        if (statusSwitch.checked) {
          if (permission() !== 'granted') {
            result('Önce alarm bildirimlerini açıp izin verin.', 'warn');
            statusSwitch.checked = false;
            updateUi();
            return;
          }
          setStatusNotification(true);
          result('Canlı durum satırı açıldı.', 'ok');
        } else {
          setStatusNotification(false);
          result('Canlı durum satırı kapatıldı.');
        }
        updateUi();
      });
    }

    var testBtn = document.getElementById('nativePushTest');
    if (testBtn) {
      testBtn.addEventListener('click', function () {
        if (!supported()) {
          result('Test yalnızca Android uygulamasında çalışır.', 'warn');
          return;
        }
        if (!alarmEnabled()) {
          result('Önce alarm bildirimlerini açın.', 'warn');
          return;
        }
        testBtn.disabled = true;
        result('Test bildirimi gönderiliyor…');
        test().then(function (r) {
          testBtn.disabled = false;
          if (r.ok) {
            var n = Number(r.sent) || 0;
            result(n > 0
              ? 'Test bildirimi gönderildi (' + n + ' cihaz).'
              : 'Sunucu gönderdi ancak cihaz sayısı 0.', 'ok');
          } else if (r.reason === 'auth') {
            result('Önce hesabınıza giriş yapın.', 'warn');
          } else if (r.reason === 'permission') {
            result('Bildirim izni yok.', 'warn');
          } else if (r.reason === 'web') {
            result('Test yalnızca Android uygulamasında çalışır.', 'warn');
          } else {
            result('Gönderilemedi: ' + (r.error || 'bilinmeyen hata'), 'danger');
          }
        }).catch(function (e) {
          testBtn.disabled = false;
          result('Gönderilemedi: ' + (e && e.message ? e.message : 'ağ hatası'), 'danger');
        });
      });
    }

    var settingsBtn = document.getElementById('nativePushSettings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', function () {
        try { bridge().openNotificationSettings(); } catch (e) { /* yoksay */ }
      });
    }
  }

  /* ---------------------------------------------------------- bağlantılar */

  window.DeneyapNative = {
    onFcmToken: function (token) {
      if (!token) return;
      var uid = currentUid();
      if (uid) rememberToken(token, uid);
      if (alarmEnabled() && uid) {
        register().catch(function () { /* sonraki açılışta yeniden denenir */ });
      }
    },

    onPermission: function (state) {
      if (permissionWaiter) permissionWaiter(state);
      updateUi();
      if (state === 'granted' && alarmEnabled()) {
        register().catch(function () { /* yoksay */ });
      }
    }
  };

  App.NativePush = {
    supported: supported,
    permission: permission,
    enable: enable,
    disable: disable,
    isEnabled: function () {
      return alarmEnabled() && permission() === 'granted';
    },
    register: register,
    test: test,
    statusEnabled: statusEnabled,
    setStatusNotification: setStatusNotification,
    refreshStatus: refreshStatus,
    sync: syncAll,
    updateUi: updateUi
  };

  /* --- otomatik kayıt / tazeleme ---------------------------------------- */

  function boot() {
    bindUi();
    updateUi();
    if (!supported()) return;

    if (alarmEnabled() && currentUid()) {
      register().catch(function () { /* yoksay */ });
    }

    if (statusEnabled()) {
      setStatusNotification(true);
      /* Token henüz gelmemişse kısa süre sonra yeniden dene. */
      setTimeout(function () {
        if (statusEnabled()) setStatusNotification(true);
      }, 3500);
    }

    document.addEventListener('deneyap:telemetry', function () {
      refreshStatus(false);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  setInterval(function () {
    if (document.hidden) return;
    if (statusEnabled()) refreshStatus(false);
  }, 20000);

  /* Oturum açılınca token'ı hesaba bağla. */
  try {
    if (App.Auth && App.Auth.onChange) {
      App.Auth.onChange(function (snap) {
        if (!snap || !snap.ready) return;
        if (snap.signedIn && alarmEnabled()) {
          register().catch(function () { /* yoksay */ });
        }
        updateUi();
      });
    }
  } catch (e) { /* yoksay */ }
})();
