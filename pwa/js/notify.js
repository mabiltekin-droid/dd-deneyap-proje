/* ==========================================================================
   notify.js — tehlike bildirimleri.
   Panel açıkken gaz eşiği aşılırsa tarayıcı bildirimi gönderilir; panel
   kapalıyken sadece açık sekmede çalışır (arka plan izlemi yok — cihaz
   bunu yapacak kadar güçlü değil ve pil ömrü önemli).

   İzin bir kez verildikten sonra tekrar istenmez; ayarlar sayfasındaki
   anahtarla açılıp kapatılır.
   ========================================================================== */

(function () {
  'use strict';

  const App = window.App;

  const COOLDOWN_MS = 90 * 1000;   // aynı seviye için en fazla 90 sn'de bir
  const TITLE = {
    danger: 'Gaz tehlikesi',
    warning: 'Gaz seviyesi yükseliyor'
  };

  const lastSent = { danger: 0, warning: 0 };

  /* iOS'ta bildirim yalnızca ana ekrana eklenmiş PWA'da çalışır ve izin
     bir kullanıcı dokunuşuyla istenmelidir. Kullanıcıyı yanıltmamak için
     ayrıca söylenmesi gerekir. */
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true;

  function supported() {
    return 'Notification' in window;
  }

  function permission() {
    if (!supported()) return 'unsupported';
    return Notification.permission;   // 'granted' | 'denied' | 'default'
  }

  function isOn() {
    return !!App.settings().notifyDanger && permission() === 'granted';
  }

  /* Anahtarı açma: kullanıcı dokunuşuyla çağrılmalı (özellikle iOS/Safari) */
  function enable() {
    if (!supported()) {
      return Promise.resolve({ ok: false, permission: 'unsupported' });
    }
    if (Notification.permission === 'granted') {
      App.saveSettings({ notifyDanger: true });
      return Promise.resolve({ ok: true, permission: 'granted' });
    }
    return Notification.requestPermission().then(function (p) {
      App.saveSettings({ notifyDanger: p === 'granted' });
      return { ok: p === 'granted', permission: p };
    });
  }

  function disable() {
    App.saveSettings({ notifyDanger: false });
  }

  /* Bildirimi Service Worker üzerinden göndermek tercih edilir: mobilde
     uygulama arka plandayken de çalışır ve ikon/rozet gösterilebilir.
     SW yoksa klasik Notification API'ye düşeriz. */
  function show(title, body, tag) {
    const opts = {
      body: body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: tag,
      renotify: false
    };

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      return navigator.serviceWorker.ready
        .then(function (reg) { return reg.showNotification(title, opts); })
        .catch(function () { return showFallback(title, body, tag); });
    }
    return Promise.resolve(showFallback(title, body, tag));
  }

  function showFallback(title, body, tag) {
    try {
      var n = new Notification(title, { body: body, icon: './icons/icon-192.png', tag: tag });
      n.onclick = function () { window.focus(); n.close(); };
      return true;
    } catch (e) {
      return false;
    }
  }

  /* Tehlike/uyarı geçişinde çağırılır. Aynı seviye için bekleme süresi
     geçmemişse tekrar göndermez — ölçüm 2 saniyede bir geliyor, her
     turda bildirim göndermek kullanıcıyı delice ederdi. */
  function alert(state, ppm) {
    if (!TITLE[state]) return false;
    if (!App.settings().notifyDanger) return false;
    if (permission() !== 'granted') return false;

    const now = Date.now();
    if (now - lastSent[state] < COOLDOWN_MS) return false;
    lastSent[state] = now;

    const deger = Number(ppm || 0).toLocaleString('tr-TR');
    show(TITLE[state],
         'Ölçüm ' + deger + ' ppm. ' + (state === 'danger'
           ? 'Cihaz otomatik müdahale etti, odayı boşaltın.'
           : 'Havalandırma yapın.'),
         'deneyap-' + state);

    return true;
  }

  /* Seviye normale dönünce sayaçları sıfırla; tekrar uyarı gelirse
     hemen bildirilsin. */
  function reset() {
    lastSent.danger = 0;
    lastSent.warning = 0;
  }

  App.notify = {
    supported: supported,
    permission: permission,
    isOn: isOn,
    enable: enable,
    disable: disable,
    alert: alert,
    reset: reset,
    isIOS: isIOS,
    isStandalone: isStandalone,
    /* iOS'ta ana ekrana eklenmeden bildirim gelmez — ayarlarda bu yazmalı */
    needsInstall: isIOS && !isStandalone,
    COOLDOWN_MS: COOLDOWN_MS
  };
})();