/* HTML stays network-first. Versioned static assets are cached for reuse. */
const VERSION = '2.31.0';
const CACHE = 'deneyap-pwa-v' + VERSION + '-r15';
const SHELL = './index.html';
const ASSET_VERSION = '';

const PRECACHE = [
  './',
  SHELL,
  './settings.html',
  './privacy.html',
  './earthquake.html',
  './events.html',
  './css/style.css',
  './css/mobile-app.css',
  './css/redesign.css',
  './css/earthquake.css',
  './css/sakin-secondary.css',
  './css/events-page.css',
  './images/ev-kesiti-640.webp',
  './images/ev-kesiti-1200.webp',
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
  './js/events-route.js',
  './js/vendor/mqtt-5.10.1.min.js',
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

const DEFERRED = /(?:vendor\/|shaders\.js|tier\.js|1200\.webp|icon-512|logo-(mark|symbol))/;
const VERSIONED = /^\.\/(css|js)\//;

function precacheUrl(path) {
  return ASSET_VERSION && VERSIONED.test(path)
    ? path + '?v=' + ASSET_VERSION : path;
}

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(async function (cache) {
    try {
      await cache.add(SHELL);
    } catch (_) {
      await cache.add('./');
    }
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(async function (keys) {
    await Promise.all(keys.filter(key => key.startsWith('deneyap-pwa-v') && key !== CACHE)
      .map(key => caches.delete(key)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  }));
});

async function cacheOfflinePages() {
  const cache = await caches.open(CACHE);
  const paths = PRECACHE.filter(path => !DEFERRED.test(path)
    && !['./', SHELL, './sw.js'].includes(path));
  // Small batches keep offline preparation from competing with page load.
  for (let offset = 0; offset < paths.length; offset += 4) {
    await Promise.all(paths.slice(offset, offset + 4).map(async function (path) {
      const url = precacheUrl(path);
      if (!(await cache.match(url))) await cache.add(url).catch(function () {});
    }));
  }
}

let warmup;
/* ------------------------------------------------------------------ message */

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data && event.data.type === 'CACHE_OFFLINE' && !warmup) {
    warmup = cacheOfflinePages();
    event.waitUntil(warmup);
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

/* Navigation and unversioned assets are checked against the server. */
async function serve(event, url) {
  const request = event.request;
  const cache = await caches.open(CACHE);
  const navigation = request.mode === 'navigate';
  const versioned = !navigation && ASSET_VERSION && url.searchParams.get('v') === ASSET_VERSION;
  if (versioned) {
    const cached = await cache.match(request);
    if (cached) return cached;
  }
  try {
    const response = (navigation && await event.preloadResponse) || await fetch(request);
    if (response.ok && response.type === 'basic') {
      event.waitUntil(cache.put(request, response.clone()).catch(function () {}));
    }
    return response;
  } catch (error) {
    let fallback = await cache.match(request, { ignoreSearch: navigation });
    if (!fallback && navigation) {
      const path = url.pathname.replace(/\/$/, '');
      const page = new URL(path.endsWith('.html') ? path : path + '.html', url.origin);
      fallback = await cache.match(page) || await cache.match(SHELL);
    }
    if (!fallback && !navigation && url.search) fallback = await cache.match(request, { ignoreSearch: true });
    return fallback || Response.error();
  }
}

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;
  event.respondWith(serve(event, url));
});
