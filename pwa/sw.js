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
     • activate sırasında eski cache'ler silinir (sürüm artışı temizliği).
     • Yeni sürüm sayfayı zorla değiştirmez; panel "Yenile" bildirimi gösterir.
   ========================================================================== */

const VERSION = '2.17.0';
const CACHE = 'deneyap-pwa-v' + VERSION;
const SHELL = './index.html';
const NETWORK_TIMEOUT = 4000;   // cihaz yanıt vermezse cache'e düş (ms)

const PRECACHE = [
  './',
  SHELL,
  './settings.html',
  './css/style.css',
  './js/config.js',
  './js/tier.js',
  './js/parallax.js',
  './js/shaders.js',
  './js/blackbox.js',
  './js/vendor/gsap.min.js',
  './js/vendor/ScrollTrigger.min.js',
  './js/vendor/lenis.min.js',
  './js/api.js',
  './js/mqtt.js',
  './js/notify.js',
  './js/devices.js',
  './js/app.js',
  './js/settings.js',
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
  './sw.js'
];

/* ------------------------------------------------------------------ install */

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      /* Tek tek ekle: bir dosya 404 olursa kurulumun tamamı başarısız olmasın */
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function (err) {
          console.warn('[sw] önbelleğe alınamadı:', url, err && err.message);
        });
      }));
    })
  );
  /* skipWaiting bilerek çağrılmıyor: açık sayfaların durumunu bozmamak için
     yeni sürüm "waiting" durumunda bekler, panel onaylayınca etkinleşir. */
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
  const title = data.title || 'Deneyap Ev Koruma';
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

/* Hızlı Uygulama Kabuğu (HTML/JS/CSS/İkon): önce anında önbellekten ver (0 ms), arkada tazele */
function staleWhileRevalidate(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      const fetchPromise = fetch(request).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          cache.put(request, res.clone());
        }
        return res;
      }).catch(function () {
        return cached;
      });

      return cached || fetchPromise;
    });
  });
}

self.addEventListener('fetch', function (event) {
  const request = event.request;

  /* Sadece GET önbelleklenir */
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /* Başka bir kaynak (geliştirme sırasında farklı port vs.) — dokunma */
  if (url.origin !== self.location.origin) return;

  /* Cihaz API'si asla cache'e girmez — her zaman anlık canlı veri */
  if (url.pathname.indexOf('/api/') === 0) return;

  /* Service Worker'ın kendisi de cache'e girmez */
  if (url.pathname === '/sw.js') return;

  /* Sayfalar arası geçiş: anında önbellekten ver, arka planda tazele (sıfır gecikme) */
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE).then(function (cache) {
        return cache.match(request).then(function (cached) {
          const fetchPromise = fetch(request).then(function (res) {
            if (res && res.ok && res.type === 'basic') {
              cache.put(request, res.clone());
            }
            return res;
          }).catch(function () {
            return cached || cache.match(SHELL);
          });
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  /* Yerel statik kaynaklar: önce önbellekten anında sun */
  event.respondWith(staleWhileRevalidate(request));
});

