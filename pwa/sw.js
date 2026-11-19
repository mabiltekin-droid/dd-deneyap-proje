/* HTML stays network-first. Versioned static assets are cached for reuse. */
const VERSION = '2.31.0';
const ASSET_VERSION = '';
const CACHE_PREFIX = 'deneyap-pwa-v';
const CACHE = CACHE_PREFIX + VERSION + '-r22-' + (ASSET_VERSION || 'dev');
const SHELL = './index.html';
const NAVIGATION_TIMEOUT_MS = 6000;

const PRECACHE = [
  './',
  SHELL,
  './settings.html',
  './privacy.html',
  './terms.html',
  './earthquake.html',
  './events.html',
  './css/style.css',
  './css/mobile-app.css',
  './css/redesign.css',
  './css/earthquake.css',
  './css/sakin-secondary.css',
  './css/events-page.css',
  './css/house3d.css',
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
  './js/firebase-modular-compat.js',
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
  './js/house3d/textures.js',
  './js/house3d/orbit-controls.js',
  './js/house3d/architecture.js',
  './js/house3d/effects.js',
  './js/house3d/scene.js',
  './manifest.json',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/logo-mark.svg',
  './sw.js'
];

const DEFERRED = /(?:vendor\/|shaders\.js|tier\.js|icon-512|logo-mark)/;
const VERSIONED = /^\.\/(css|js)\//;
const PAGES = new Set(['index', 'settings', 'events', 'privacy', 'terms', 'earthquake']);

function precacheUrl(path) {
  if (!ASSET_VERSION) return path;
  if (VERSIONED.test(path)) return path + '?v=' + ASSET_VERSION;
  if (path === SHELL) return './';
  return path.endsWith('.html') ? path.slice(0, -5) : path;
}

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(async function (cache) {
    await cache.add(precacheUrl(SHELL));
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(async function (keys) {
    const appCaches = keys.filter(key => key.startsWith(CACHE_PREFIX));
    const position = appCaches.indexOf(CACHE);
    // Keep one previous build so an interrupted update can still open warmed pages.
    await Promise.all(appCaches.slice(0, Math.max(0, position - 1)).map(key => caches.delete(key)));
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable().catch(function () {});
    }
    await self.clients.claim();
  }));
});

async function cacheOfflinePages() {
  const cache = await caches.open(CACHE);
  const paths = PRECACHE.filter(path => !DEFERRED.test(path)
    && !['./', SHELL, './sw.js'].includes(path))
    .sort((left, right) => Number(VERSIONED.test(right)) - Number(VERSIONED.test(left)));
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
    warmup = cacheOfflinePages().finally(function () { warmup = null; });
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

function pageKeys(url) {
  const name = url.pathname.replace(/^\//, '').replace(/\/$|\.html$/g, '') || 'index';
  if (!PAGES.has(name)) return [];
  const paths = name === 'index' ? ['/', '/index.html', '/index'] : ['/' + name, '/' + name + '.html'];
  return paths.map(path => new URL(path, url.origin));
}

async function matchEntries(cache, keys, accept) {
  for (const key of keys) {
    const cached = await cache.match(key);
    if (cached && accept(cached)) return cached;
  }
  return null;
}

async function matchOffline(cache, keys, accept) {
  if (!keys.length) return null;
  const cached = await matchEntries(cache, keys, accept);
  if (cached) return cached;
  const versions = (await caches.keys()).filter(key => key.startsWith(CACHE_PREFIX));
  const previous = versions[versions.indexOf(CACHE) - 1];
  return previous ? matchEntries(await caches.open(previous), keys, accept) : null;
}

function isPage(response) {
  return response.ok && (response.headers.get('content-type') || '').includes('text/html');
}

function isUnavailable(response) {
  return response.type === 'error' || [502, 503, 504].includes(response.status);
}

async function loadNavigation(event) {
  // A failed preload rejects independently of the next connection attempt.
  const preload = await Promise.resolve(event.preloadResponse).catch(function () {});
  return preload && !isUnavailable(preload) ? preload : fetch(event.request);
}

async function serveNavigation(event, url, cache) {
  const network = loadNavigation(event).catch(() => Response.error());
  const keys = pageKeys(url);
  const offline = await matchOffline(cache, keys, isPage).catch(() => null);
  let timer;
  try {
    const response = offline ? await Promise.race([
      network, new Promise(resolve => { timer = setTimeout(resolve, NAVIGATION_TIMEOUT_MS, offline); })
    ]) : await network;
    if (response === offline) return offline;
    if (offline && isUnavailable(response)) return offline;
    if (keys.length && !url.search && isPage(response) && response.type === 'basic' && !response.redirected) {
      event.waitUntil(cache.put(event.request, response.clone()).catch(function () {}));
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function serve(event, url) {
  const request = event.request;
  const cache = await caches.open(CACHE).catch(() => null);
  if (request.mode === 'navigate') return cache ? serveNavigation(event, url, cache) : loadNavigation(event);
  if (!cache) return fetch(request);

  const version = /^\/(css|js)\//.test(url.pathname) && url.searchParams.get('v');
  if (version) {
    const cached = await matchOffline(cache, [request], response => response.ok).catch(() => null);
    if (cached) return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic' && (!version || version === ASSET_VERSION)) {
      event.waitUntil(cache.put(request, response.clone()).catch(function () {}));
    }
    return response;
  } catch (error) {
    const fallback = version ? null : await matchOffline(cache, [request], response => response.ok);
    return fallback || Response.error();
  }
}

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__/') || url.pathname === '/sw.js') return;
  event.respondWith(serve(event, url));
});
