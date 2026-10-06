/* ==========================================================================
   sw.js â€” Service Worker
   ----------------------------------------------------------------------------
   Ã–NEMLÄ°: Bu dosya "eski site aÃ§Ä±lÄ±yor" hatasÄ±nÄ±n ana kaynaÄŸÄ±ydÄ±.
   Ã–nceki sÃ¼rÃ¼m tÃ¼m isteklerde cache-first kullanÄ±yordu ve cache'e yeni
   sÃ¼rÃ¼mÃ¼ hiÃ§ yazmÄ±yordu; index.html kalÄ±cÄ± olarak ilk yÃ¼klenen haliyle
   sunuluyordu.

   Yeni strateji:
     â€¢ Cihaz yerel aÄŸda olduÄŸu iÃ§in aÄŸ Ã¶ncelikli (network-first) tercih
       edildi â€” her aÃ§Ä±lÄ±ÅŸta gÃ¼ncel dosya gelir.
     â€¢ Cihaz yanÄ±t vermezse (Ã§evrimdÄ±ÅŸÄ± / kapalÄ±) son bilinen iyi sÃ¼rÃ¼m
       cache'ten sunulur, bÃ¶ylece panel Ã§alÄ±ÅŸmaya devam eder.
     â€¢ /api/* istekleri ASLA cache'lenmez â€” sensÃ¶r verisi her seferinde
       cihazdan alÄ±nÄ±r.
     â€¢ activate sÄ±rasÄ±nda eski cache'ler silinir (sÃ¼rÃ¼m artÄ±ÅŸÄ± temizliÄŸi).
     â€¢ Yeni sÃ¼rÃ¼m sayfayÄ± zorla deÄŸiÅŸtirmez; panel "Yenile" bildirimi gÃ¶sterir.
   ========================================================================== */

const VERSION = '2.4.4';
const CACHE = 'deneyap-pwa-v' + VERSION;
const SHELL = './index.html';
const NETWORK_TIMEOUT = 4000;   // cihaz yanÄ±t vermezse cache'e dÃ¼ÅŸ (ms)

const PRECACHE = [
  './',
  SHELL,
  './settings.html',
  './css/style.css',
  './js/config.js',
  './js/api.js',
  './js/mqtt.js',
  './js/app.js',
  './js/settings.js',
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
      /* Tek tek ekle: bir dosya 404 olursa kurulumun tamamÄ± baÅŸarÄ±sÄ±z olmasÄ±n */
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function (err) {
          console.warn('[sw] Ã¶nbelleÄŸe alÄ±namadÄ±:', url, err && err.message);
        });
      }));
    })
  );
  /* skipWaiting bilerek Ã§aÄŸrÄ±lmÄ±yor: aÃ§Ä±k sayfalarÄ±n durumunu bozmamak iÃ§in
     yeni sÃ¼rÃ¼m "waiting" durumunda bekler, panel onaylayÄ±nca etkinleÅŸir. */
});

/* ----------------------------------------------------------------- activate */

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) {
          console.log('[sw] eski Ã¶nbellek siliniyor:', k);
          return caches.delete(k);
        }
        return null;
      }));
    }).then(function () {
      /* Ä°lk aÃ§Ä±lÄ±ÅŸta da kontrol etsin */
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

/* Ä°konlar deÄŸiÅŸmez: Ã¶nce cache'den gel, arkada tazele */
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

/* Metin kaynaklarÄ± (HTML/JS/CSS/JSON): Ã¶nce aÄŸ, hata olursa cache */
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
          /* Sayfa isteÄŸiysek uygulama kabuÄŸunu gÃ¶ster â€” panel aÃ§Ä±lsÄ±n */
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

  /* Sadece GET Ã¶nbelleklenir */
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /* BaÅŸka bir kaynak (geliÅŸtirme sÄ±rasÄ±nda farklÄ± port vs.) â€” dokunma */
  if (url.origin !== self.location.origin) return;

  /* Cihaz API'si asla cache'e girmez */
  if (url.pathname.indexOf('/api/') === 0) return;

  /* Service Worker'Ä±n kendisi de cache'e girmez */
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

