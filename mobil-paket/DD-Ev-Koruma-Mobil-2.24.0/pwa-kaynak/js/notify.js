/* ==========================================================================
   notify.js — sistem bildirimleri (masaüstü + telefon) ve Web Push aboneliği
   --------------------------------------------------------------------------
   İki katman vardır:

     1) YEREL bildirim (bu dosya + sw.js)
        Panel/sekme AÇIKKEN alarm anında işletim sisteminin bildirim
        merkezinde bildirim gösterilir. Sunucu/anahtar gerekmez.
        Ön koşul: kullanıcı "izin ver" demiş olmalı (Notification.permission).

     2) UZAK bildirim (Web Push)
        Panel KAPALIYKEN de bildirim gelir. Panel yalnızca ABONE OLUR;
        abonelik Firestore'a (push_subs) yazılır. Gönderici tarafı
        sunucudur: api/push.js (Vercel) + VAPID anahtarları.
        Genel anahtar App.VAPID_PUBLIC_KEY içinde (config.js).

   Tercihler App.settings() deposunda tutulur (cihaza gönderilmez):
     notifyEnabled, notifySound, notifyGas, notifyWarn, notifyFlood,
     notifyFlame, notifyVib, notifyOffline, pushEnabled
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});

  const LAST_KEY = 'deneyap.notify.last.v1';   // tür bazlı tekrar bastırma damgaları
  const DEDUPE_MS = 60000;                     // aynı tür en çok dakikada bir bildirir

  /* Olay türü -> tercih anahtarı. null = koşulsuz (test). */
  const KIND_KEY = {
    gas: 'notifyGas',
    warn: 'notifyWarn',
    flood: 'notifyFlood',
    flame: 'notifyFlame',
    vib: 'notifyVib',
    offline: 'notifyOffline',
    online: null,
    test: null
  };

  const ICON = './icons/icon-192.png';

  function cfg() { return App.settings ? App.settings() : {}; }

  function readLast() {
    try { return JSON.parse(localStorage.getItem(LAST_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function writeLast(o) {
    try { localStorage.setItem(LAST_KEY, JSON.stringify(o)); } catch (e) { /* yoksay */ }
  }

  /* ------------------------------------------------------------- izin durumu */

  function supported() {
    return (typeof Notification !== 'undefined') &&
           (('serviceWorker' in navigator) || ('Notification' in window));
  }

  function permission() {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;                     // 'granted' | 'denied' | 'default'
  }

  /* Hem promise hem callback tabanlı tarayıcılarda çalışır (eski Safari). */
  function request() {
    if (typeof Notification === 'undefined') return Promise.resolve('unsupported');
    return new Promise(function (resolve) {
      let done = false;
      const finish = function (v) {
        if (done) return;
        done = true;
        resolve(v || Notification.permission);
      };
      try {
        const r = Notification.requestPermission(finish);
        if (r && typeof r.then === 'function') {
          r.then(finish, function () { finish(); });
        }
      } catch (e) { finish(); }
    });
  }

  function swReg() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.ready.then(function (r) { return r; })
      .catch(function () { return null; });
  }

  /* ------------------------------------------------------------ bildirim at */

  /* Service Worker üzerinden göster (sekme arka planda olsa da görünür).
     SW yoksa düz Notification'a düşer. */
  async function show(title, body, opts) {
    opts = opts || {};
    const o = {
      body: body || '',
      tag: opts.tag || 'dd-alert',
      renotify: !!opts.tag,
      icon: ICON,
      badge: ICON,
      silent: cfg().notifySound === false,
      requireInteraction: !!opts.urgent,
      data: { url: opts.url || './', kind: opts.kind || '' }
    };
    try {
      const reg = await swReg();
      if (reg && reg.showNotification) {
        await reg.showNotification(title, o);
        return true;
      }
    } catch (e) { /* SW yok/başarısız -> aşağıya düş */ }
    try {
      if (typeof Notification !== 'undefined') {
        /* eslint-disable-next-line no-new */
        new Notification(title, o);
        return true;
      }
    } catch (e) { /* yoksay */ }
    return false;
  }

  /* Tür bazlı alarm bildirimi. Tercihler kapalıysa sessizce atlar. */
  function alarm(kind, title, body, opts) {
    const s = cfg();
    if (s.notifyEnabled !== true) return false;
    if (permission() !== 'granted') return false;

    const key = KIND_KEY[kind];
    if (key && s[key] === false) return false;

    const now = Date.now();
    const last = readLast();
    if (last[kind] && (now - last[kind]) < DEDUPE_MS) return false;
    last[kind] = now;
    writeLast(last);

    show(title, body, Object.assign({ tag: 'dd-' + kind, kind: kind }, opts || {}));
    return true;
  }

  /* Kullanıcı düğmeye bastığında: bildirim tercihlerini aç ve izin iste. */
  async function enable() {
    const p = (permission() === 'granted') ? 'granted' : await request();
    if (p !== 'granted') {
      App.saveSettings({ notifyEnabled: false });
      return { ok: false, permission: p };
    }
    App.saveSettings({ notifyEnabled: true });
    return { ok: true, permission: p };
  }

  function disable() {
    App.saveSettings({ notifyEnabled: false });
    return { ok: true };
  }

  /* Test bildirimi: tercihlerden ve tekrar bastırmadan bağımsız çalışır. */
  async function test() {
    if (permission() !== 'granted') {
      const p = await request();
      if (p !== 'granted') throw new Error('Bildirim izni verilmedi.');
      App.saveSettings({ notifyEnabled: true });
    }
    const ok = await show('Test bildirimi',
      'Bu bir test bildirimidir. Alarm anında benzer bir bildirim alacaksınız.',
      { tag: 'dd-test', kind: 'test' });
    if (!ok) throw new Error('Bildirim gösterilemedi (tarayıcı engelledi).');
    return true;
  }

  /* ------------------------------------------------------------ Web Push -- */

  function pushSupported() {
    return ('serviceWorker' in navigator) && ('PushManager' in window) &&
           !!App.VAPID_PUBLIC_KEY;
  }

  function b64ToU8(base64) {
    const pad = '='.repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function currentUid() {
    try {
      const s = App.Auth && App.Auth.snapshot ? App.Auth.snapshot() : null;
      return (s && s.user && s.user.id) || null;
    } catch (e) { return null; }
  }

  async function pushSubscribe() {
    if (!pushSupported()) {
      throw new Error('Bu tarayıcı arka plan bildirimini desteklemiyor.');
    }
    if (permission() !== 'granted') {
      const p = await request();
      if (p !== 'granted') throw new Error('Bildirim izni verilmedi.');
    }
    const uid = currentUid();
    if (!uid) throw new Error('Arka plan bildirimi için hesabınıza giriş yapın.');

    const reg = await navigator.serviceWorker.ready;
    let sub = null;
    try { sub = await reg.pushManager.getSubscription(); } catch (e) { sub = null; }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToU8(App.VAPID_PUBLIC_KEY)
      });
    }
    await App.FB.savePushSubscription(uid, sub.toJSON());
    App.saveSettings({ notifyEnabled: true, pushEnabled: true });
    return true;
  }

  async function pushUnsubscribe() {
    const uid = currentUid();
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch (e) { /* yoksay */ }
    if (uid && App.FB && App.FB.deletePushSubscription) {
      try { await App.FB.deletePushSubscription(uid); } catch (e) { /* yoksay */ }
    }
    App.saveSettings({ pushEnabled: false });
    return true;
  }

  async function pushState() {
    const out = {
      supported: pushSupported(),
      permission: permission(),
      localEnabled: cfg().notifyEnabled === true,
      subscribed: false,
      uid: currentUid()
    };
    if (!out.supported) return out;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      out.subscribed = !!sub;
    } catch (e) { /* yoksay */ }
    return out;
  }

  App.notify = {
    supported: supported,
    permission: permission,
    request: request,
    enable: enable,
    disable: disable,
    alarm: alarm,
    test: test,
    push: pushSubscribe,
    unsubscribe: pushUnsubscribe,
    pushSupported: pushSupported,
    pushState: pushState
  };
})();
