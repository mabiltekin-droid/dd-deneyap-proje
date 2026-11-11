/* ==========================================================================
   sw.js — Service Worker
   ----------------------------------------------------------------------------
   ÖNEMLİ: Bu dosya "eski site açılıyor" hatasının ana kaynağıydı.
   Önceki sürüm tüm isteklerde cache-first kullanıyordu ve cache'e yeni
   sürümü hiç yazmıyordu; index.html kalıcı olarak ilk yüklenen haliyle
   sunuluyordu.

   Yeni strateji:
     • Cihaz yerel ağda olduğu için ağ öncelikli (network-first) tercih
       edildi — her açılışta güncel dosya gelir.
     • Cihaz yanıt vermezse (çevrimdışı / kapalı) son bilinen iyi sürüm
       cache'ten sunulur, böylece panel çalışmaya devam eder.
     • /api/* istekleri ASLA cache'lenmez — sensör verisi her seferinde
       cihazdan alınır.
     • Yeni sürüm beklemeden etkinleşir; açık sayfalar otomatik yenilenir.
     • Eski cache'ler activate sırasında tamamen silinir.
   ========================================================================== */

const VERSION = '2.31.0';
const CACHE = 'deneyap-pwa-v' + VERSION + '-r6';
const SHELL = './index.html';

const PRECACHE = [
  './',
  SHELL,
  './settings.html',
  './privacy.html',
  './earthquake.html',
  './css/style.css',
  './css/mobile-app.css',
  './css/redesign.css',
  './css/earthquake.css',
  './fonts/dm-sans-latin.woff2',
  './fonts/dm-sans-latin-ext.woff2',
  './fonts/fraunces-latin.woff2',
  './fonts/fraunces-latin-ext.woff2',
  './js/config.js',
  './js/theme-boot.js',
  './js/tier.js',
  './js/parallax.js',
  './js/shaders.js',
  './js/blackbox.js',
  './js/vendor/gsap.min.js',
  './js/vendor/ScrollTrigger.min.js',
  './js/vendor/lenis.min.js',
  './js/api.js',
  './js/homes.js',
  './js/ota.js',
  './js/earthquake.js',
  './js/mqtt.js',
  './js/notify.js',
  './js/devices.js',
  './js/app.js',
  './js/offline.js',
  './js/native-push.js',
  './js/emergency.js',
  './js/settings.js',
  './js/mobile-app.js',
  './js/studio-nav.js',
  './js/firebase.js',
  './js/auth-firebase.js',
  './js/events.js',
  './js/automation.js',
  './js/voice.js',
  './js/account.js',
  './js/profile-ui.js',
  './js/admin-invite-ui.js',
  './js/history.js',
  './manifest.json',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/logo-mark.svg',
  './icons/logo-symbol.svg',
  './sw.js'
];

/* ------------------------------------------------------------------ install */

/* Güncelleme mi, ilk kurulum mu? İlk kurulumda sayfayı gereksiz yenileme. */
let isUpdate = false;

self.addEventListener('install', function (event) {
  isUpdate = !!(self.registration.active || self.registration.waiting);
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      /* Tek tek ekle: bir dosya 404 olursa kurulumun tamamı başarısız olmasın */
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function (err) {
          console.warn('[sw] önbelleğe alınamadı:', url, err && err.message);
        });
      }));
    }).then(function () {
      /* Yeni sürüm beklemeden devreye girsin. */
      return self.skipWaiting();
    })
  );
});

/* ----------------------------------------------------------------- activate */

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) {
          console.log('[sw] eski önbellek siliniyor:', k);
          return caches.delete(k);
        }
        return null;
      }));
    }).then(function () {
      /* İlk açılışta da kontrol etsin */
      if (self.registration.navigationPreload) {
        return self.registration.navigationPreload.enable();
      }
      return null;
    }).then(function () {
      return self.clients.claim();
    }).then(function () {
      if (!isUpdate) return null;
      /* Eski sürümü açık tutan sekmeleri de yeni sürüme geçir. */
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(function (clients) {
          clients.forEach(function (client) {
            if (client && client.url && typeof client.navigate === 'function') {
              client.navigate(client.url).catch(function () {});
            }
          });
        });
    })
  );
});

/* ------------------------------------------------------------------ message */

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* --------------------------------------------------------------- bildirimler */

/* Bildirime tıklanınca: açık bir pencere varsa odakla, yoksa yeni pencere aç. */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c && 'focus' in c) {
          /* Zaten açık bir panel varsa onu öne al; rota değiştirmeye çalışma
             (cihaz yerel adreste olduğu için navigate bazı tarayıcılarda
             sayfayı yeniden yükleyip bağlantıyı koparabilir). */
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return null;
    })
  );
});

/* Web Push (uzak gönderici): yük JSON'dur — {title, body, tag, urgent, url}.
   Gönderici: api/push.js (Vercel + web-push + VAPID). */
self.addEventListener('push', function (event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'DD Ev Koruma';
  const body = data.body || 'Yeni bir uyarı var.';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      tag: data.tag || 'dd-push',
      renotify: true,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      requireInteraction: data.urgent === true,
      data: { url: data.url || './', kind: data.kind || '' }
    })
  );
});

/* Tarayıcı aboneliği kendi kendine yenilerse panelin haberi olmaz; sayfa
   açıldığında notify.js zaten yeniden abone olup Firestore'u günceller.
   Burada yalnızca eşleşmeyi sessizce işaretliyoruz. */
self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil(Promise.resolve());
});

/* -------------------------------------------------------------------- fetch */

/* Her zaman ağdan taze dosya al; çevrimdışıysa son iyi sürümü cache'ten sun. */
function networkFirst(request) {
  return fetch(request, { cache: 'no-cache' }).then(function (res) {
    if (res && res.ok && res.type === 'basic') {
      const clone = res.clone();
      caches.open(CACHE).then(function (cache) {
        cache.put(request, clone);
      });
    }
    return res;
  }).catch(function () {
    return caches.match(request).then(function (cached) {
      return cached || caches.match(SHELL);
    });
  });
}

self.addEventListener('fetch', function (event) {
  const request = event.request;

  /* Sadece GET önbelleklenir */
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /* Başka bir kaynak — dokunma */
  if (url.origin !== self.location.origin) return;

  /* Cihaz API'si asla cache'e girmez — her zaman anlık canlı veri */
  if (url.pathname.indexOf('/api/') === 0) return;

  /* Service Worker'ın kendisi de cache'e girmez */
  if (url.pathname === '/sw.js') return;

  /* HTML, JS, CSS, ikon ve fontlar: ağ öncelikli, çevrimdışı cache yedeği. */
  event.respondWith(networkFirst(request));
});

