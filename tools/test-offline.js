'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const origin = 'https://panel.example.test';
const version = '2.31.0-test-current';
const priorVersion = '2.31.0-test-previous';
const cachePrefix = 'deneyap-pwa-v2.31.0-';
const priorCache = cachePrefix + 'r16';
const workerSource = fs.readFileSync(path.join(__dirname, '../pwa/sw.js'), 'utf8')
  .replace("const ASSET_VERSION = '';", "const ASSET_VERSION = '" + version + "';");

function basicResponse(body, { status = 200, url = '', type = 'basic', redirected = false } = {}) {
  const response = new Response(body, {
    status,
    headers: { 'Content-Type': url.includes('/js/') ? 'text/javascript' : 'text/html' }
  });
  Object.defineProperties(response, {
    type: { value: type },
    url: { value: url },
    redirected: { value: redirected },
    clone: { value: () => basicResponse(body, { status, url, type, redirected }) }
  });
  return response;
}

async function harness(previousCaches = []) {
  const listeners = new Map();
  const stores = new Map();
  const timers = new Set();
  const onlineCalls = [];
  let network = url => basicResponse('response for ' + new URL(url).pathname, { url });
  let claimed = false;

  function urlFor(request) {
    return new URL(request.url || request, origin).href;
  }

  async function fetch(request, options) {
    const url = urlFor(request);
    onlineCalls.push(url);
    return network(url, options);
  }

  function getCache(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    return {
      async match(request, { ignoreSearch = false } = {}) {
        const url = new URL(urlFor(request));
        if (!ignoreSearch) return entries.get(url.href)?.clone();
        for (const [key, value] of entries) {
          const stored = new URL(key);
          if (stored.origin === url.origin && stored.pathname === url.pathname) return value.clone();
        }
      },
      async put(request, response) {
        entries.set(urlFor(request), response.clone());
      },
      async add(request) {
        const response = await fetch(request);
        if (!response.ok) throw new TypeError('Unsuccessful cache.add');
        await this.put(request, response);
      },
      async keys() {
        return Array.from(entries.keys(), url => new Request(url));
      }
    };
  }

  const caches = {
    open: async name => getCache(name),
    keys: async () => Array.from(stores.keys()),
    delete: async name => stores.delete(name),
    async match(request, options) {
      for (const name of stores.keys()) {
        const match = await getCache(name).match(request, options);
        if (match) return match;
      }
    }
  };

  function dispatch(eventName, fields = {}) {
    const waits = [];
    let result;
    listeners.get(eventName)({
      ...fields,
      waitUntil: promise => waits.push(promise),
      respondWith(promise) { result = Promise.resolve(promise); }
    });
    return {
      handled: !!result,
      async response() {
        const response = await result;
        await Promise.all(waits);
        return response;
      }
    };
  }

  vm.runInNewContext(workerSource, {
    caches, fetch, URL, Request, Response, Headers, AbortController, AbortSignal, DOMException, console,
    setTimeout(callback, delay, ...args) {
      const timer = () => callback(...args);
      timers.add(timer);
      return timer;
    },
    clearTimeout: callback => timers.delete(callback),
    self: {
      location: new URL(origin),
      registration: { scope: origin + '/', navigationPreload: { enable: async () => {}, disable: async () => {} } },
      clients: { claim: async () => { claimed = true; } },
      skipWaiting: async () => {},
      addEventListener: (name, listener) => listeners.set(name, listener)
    }
  }, { filename: 'pwa/sw.js' });

  for (const [name, url, response] of previousCaches) {
    const store = getCache(name);
    if (url) await store.put(url, response);
  }
  await dispatch('install').response();
  const currentCache = (await caches.keys()).at(-1);
  onlineCalls.length = 0;
  return {
    currentCache, onlineCalls, caches, getCache,
    useNetwork(handler) { network = handler; },
    offline() {
      network = () => { throw new TypeError('Connection reset'); };
    },
    dispatch,
    request(url, { method = 'GET', mode = 'navigate', preloadResponse } = {}) {
      return dispatch('fetch', {
        request: { url: urlFor(url), method, mode },
        preloadResponse
      });
    },
    fireTimeouts() {
      const pending = [...timers];
      for (const timer of pending) {
        timers.delete(timer);
        timer();
      }
      return pending.length;
    },
    claimed: () => claimed
  };
}

test('a reset in navigation preload retries the network on a first visit', async () => {
  const worker = await harness();
  const preloadResponse = Promise.reject(new TypeError('ERR_CONNECTION_RESET'));
  const response = await worker.request('/settings', { preloadResponse }).response();
  assert.equal(await response.text(), 'response for /settings');
  assert.deepEqual(worker.onlineCalls, [origin + '/settings']);
});

test('a successful navigation preload avoids a duplicate fetch and populates offline cache', async () => {
  const worker = await harness();
  const preload = basicResponse('events preload', { url: origin + '/events' });
  const response = await worker.request('/events', { preloadResponse: Promise.resolve(preload) }).response();
  assert.equal(await response.text(), 'events preload');
  assert.deepEqual(worker.onlineCalls, []);
  worker.offline();
  const cached = await worker.request('/events?ref=mobile').response();
  assert.equal(await cached.text(), 'events preload');
});

test('an HTTP error from navigation preload allows a working direct request', async () => {
  const worker = await harness();
  const preload = basicResponse('upstream error', { status: 503, url: origin + '/earthquake' });
  const response = await worker.request('/earthquake', { preloadResponse: Promise.resolve(preload) }).response();
  assert.equal(await response.text(), 'response for /earthquake');
  assert.deepEqual(worker.onlineCalls, [origin + '/earthquake']);
});

test('warmup makes canonical and legacy URLs available offline without replacing another page', async () => {
  const worker = await harness();
  await worker.dispatch('message', { data: { type: 'CACHE_OFFLINE' } }).response();
  worker.offline();
  for (const page of ['settings', 'events', 'privacy', 'terms', 'earthquake']) {
    for (const route of ['/' + page, '/' + page + '.html']) {
      const response = await worker.request(route + '?source=test').response();
      assert.match(await response.text(), new RegExp('/' + page + '(?:\\.html)?$'));
    }
  }
  const missing = await worker.request('/other').response();
  assert.equal(missing.type, 'error');
});

test('an interrupted warmup can resume after the connection recovers', async () => {
  const worker = await harness();
  worker.offline();
  await worker.dispatch('message', { data: { type: 'CACHE_OFFLINE' } }).response();
  worker.useNetwork(url => basicResponse('restored network', { url }));
  await worker.dispatch('message', { data: { type: 'CACHE_OFFLINE' } }).response();
  worker.offline();
  const saved = await worker.request('/privacy').response();
  assert.equal(await saved.text(), 'restored network');
});

test('gateway errors use the successful copy, while explicit client errors stay visible', async () => {
  const worker = await harness();
  await worker.request('/events').response();
  worker.useNetwork(url => basicResponse('temporary outage', { url, status: 503 }));
  const fallback = await worker.request('/events').response();
  assert.equal(await fallback.text(), 'response for /events');
  const uncached = await worker.request('/settings').response();
  assert.equal(uncached.status, 503);
  worker.useNetwork(url => basicResponse('not found', { url, status: 404 }));
  const notFound = await worker.request('/events').response();
  assert.equal(notFound.status, 404);
  assert.equal(await notFound.text(), 'not found');
  worker.offline();
  const saved = await worker.request('/events').response();
  assert.equal(await saved.text(), 'response for /events');
});

test('successful navigations update the stored page without persisting query or redirect responses', async () => {
  const worker = await harness();
  await worker.request('/events').response();
  worker.useNetwork(url => basicResponse('new events', { url }));
  assert.equal(await (await worker.request('/events').response()).text(), 'new events');

  worker.useNetwork(url => basicResponse('events search results', { url }));
  assert.equal(await (await worker.request('/events?q=test').response()).text(), 'events search results');
  worker.useNetwork(() => basicResponse('redirect page', { url: origin + '/settings', redirected: true }));
  assert.equal(await (await worker.request('/events').response()).text(), 'redirect page');
  worker.offline();
  assert.equal(await (await worker.request('/events?q=test').response()).text(), 'new events');
});

test('known cached navigations remain available when the network stalls', async () => {
  const worker = await harness();
  await worker.request('/settings').response();
  worker.useNetwork(() => new Promise(() => {}));
  const navigation = worker.request('/settings').response();
  // Let the worker finish retrieving the cached copy before expiring its fetch timer.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.fireTimeouts(), 1);
  assert.equal(await (await navigation).text(), 'response for /settings');
});

test('activation retains only the preceding offline cache and keeps other apps untouched', async () => {
  const worker = await harness([
    [cachePrefix + 'r15', '/index.html', basicResponse('oldest dashboard')],
    [priorCache, '/settings.html', basicResponse('previous settings')],
    ['another-app']
  ]);
  await worker.dispatch('activate').response();
  assert.equal(worker.claimed(), true);
  assert.ok(worker.currentCache.endsWith(version));
  const keys = await worker.caches.keys();
  assert.deepEqual(new Set(keys), new Set([worker.currentCache, priorCache, 'another-app']));
  worker.offline();
  const response = await worker.request('/settings').response();
  assert.equal(await response.text(), 'previous settings');
});

test('assets from different builds never substitute for an exact requested version', async () => {
  const currentPath = '/js/app.js?v=' + version;
  const priorPath = '/js/app.js?v=' + priorVersion;
  const worker = await harness([[priorCache, priorPath, basicResponse('previous script')]]);
  await worker.getCache(worker.currentCache).put(currentPath, basicResponse('current script'));
  worker.offline();
  assert.equal(await (await worker.request(currentPath, { mode: 'cors' }).response()).text(), 'current script');
  assert.equal(await (await worker.request(priorPath, { mode: 'cors' }).response()).text(), 'previous script');
  assert.equal((await worker.request('/js/app.js?v=unknown', { mode: 'cors' }).response()).type, 'error');
});

test('the worker does not intercept API, other origins, non-GET requests or its own updates', async () => {
  const worker = await harness();
  assert.equal(worker.request('/api/earthquakes', { mode: 'cors' }).handled, false);
  assert.equal(worker.request('https://external.example.test/file.js', { mode: 'cors' }).handled, false);
  assert.equal(worker.request('/settings', { method: 'POST' }).handled, false);
  assert.equal(worker.request('/sw.js', { mode: 'cors' }).handled, false);
});
