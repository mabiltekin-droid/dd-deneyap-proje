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

const VERSION = '2.2.0';
const CACHE = 'deneyap-pwa-v' + VERSION;
const SHELL = './index.html';
const NETWORK_TIMEOUT = 4000;   // cihaz yanıt vermezse cache'e düş (ms)

const PRECACHE = [
  './',
  SHELL,
  './settings.html',
  './css/style.css',
  './js/config.js',
  './js/api.js',
  './js/app.js',
  './js/settings.js',
  './manifest.json',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
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

/* -------------------------------------------------------------------- fetch */

/* İkonlar değişmez: önce cache'den gel, arkada tazele */
function cacheFirst(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      const network = fetch(request).then(function (res) {
        if (res && res.ok) cache.put(request, res.clone());
        return res;
      }).catch(function () { return cached; });
      return cached || network;
    });
  });
}

/* Metin kaynakları (HTML/JS/CSS/JSON): önce ağ, hata olursa cache */
function networkFirst(request) {
  return caches.open(CACHE).then(function (cache) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, NETWORK_TIMEOUT);

    return fetch(request, { signal: controller.signal })
      .then(function (res) {
        clearTimeout(timer);
        if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
        return res;
      })
      .catch(function (err) {
        clearTimeout(timer);
        return cache.match(request).then(function (cached) {
          if (cached) return cached;
          /* Sayfa isteğiysek uygulama kabuğunu göster — panel açılsın */
          if (request.mode === 'navigate') {
            return cache.match(SHELL);
          }
          throw err;
        });
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

  /* Cihaz API'si asla cache'e girmez */
  if (url.pathname.indexOf('/api/') === 0) return;

  /* Service Worker'ın kendisi de cache'e girmez */
  if (url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (request.destination === 'image') {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});