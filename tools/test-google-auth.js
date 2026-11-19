'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const webFiles = ['firebase.js', 'auth-firebase.js', 'account.js'];
const androidFile = path.join(root, 'android/app/src/main/java/com/mabiltekin/deneyapevkoruma/GoogleSignInBridge.java');
const bridgeSource = fs.readFileSync(androidFile, 'utf8').match(/\bString SCRIPT = """([\s\S]+?)""";/);
assert.ok(bridgeSource, 'Native WebView bridge JavaScript should be present');

/* ------------------------------------------------------------------ /api/mobile-auth mock */

function createMobileAuthHarness() {
  const store = new Map();
  let mockClock = Date.now();
  let customTokenSeq = 0;
  let validIdTokens = new Map([
    ['valid-google-id-token', { uid: 'google-qa-user', email: 'qa@example.test' }],
    ['mock-firebase-session', { uid: 'google-qa-user', email: 'qa@example.test' }]
  ]);

  function makeSnap(id, data) {
    return {
      id,
      exists: data !== undefined,
      data: () => (data ? { ...data } : undefined)
    };
  }

  function makeDocRef(id) {
    return {
      id,
      async create(obj) {
        if (store.has(id)) {
          const err = new Error('Document already exists');
          err.code = 6;
          throw err;
        }
        store.set(id, { ...obj });
      },
      async get() { return makeSnap(id, store.get(id)); },
      async update(patch) {
        if (!store.has(id)) throw new Error('Missing doc');
        store.set(id, { ...store.get(id), ...patch });
      },
      async delete() { store.delete(id); }
    };
  }

  const fakeDb = {
    collection(name) {
      assert.equal(name, 'mobile_auth_codes');
      return { doc: makeDocRef };
    },
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: async ref => ref.get(),
        update: (ref, patch) => writes.push(() => ref.update(patch)),
        delete: ref => writes.push(() => ref.delete())
      };
      const result = await fn(tx);
      for (const write of writes) await write();
      return result;
    }
  };

  const fakeAdmin = {
    apps: [{}],
    app: () => ({}),
    firestore: Object.assign(() => fakeDb, { FieldValue: { serverTimestamp: () => 1 } }),
    auth: () => ({
      async verifyIdToken(token) {
        const u = validIdTokens.get(token);
        if (!u) {
          const e = new Error('Invalid token');
          e.code = 'auth/invalid-id-token';
          throw e;
        }
        return u;
      },
      async createCustomToken(uid) {
        return 'custom-token-' + (++customTokenSeq) + '-' + uid;
      }
    }),
    credential: { cert: () => ({}) },
    initializeApp: () => ({})
  };

  const origLoad = Module._load;
  const mobileAuthPath = path.join(root, 'api/mobile-auth.js');
  const libPath = path.join(root, 'api/_lib.js');
  delete require.cache[mobileAuthPath];
  delete require.cache[libPath];

  Module._load = function (request, parent, isMain) {
    if (request === 'firebase-admin') return fakeAdmin;
    if (request === 'web-push') return {};
    return origLoad.apply(this, arguments);
  };

  let handler;
  const origDateNow = Date.now;
  try {
    process.env.FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT || '{}';
    handler = require(mobileAuthPath);
  } finally {
    Module._load = origLoad;
  }

  async function call({ method = 'POST', headers = {}, body = {} } = {}) {
    Date.now = () => mockClock;
    try {
      const out = { status: 200, headers: {}, body: null };
      const res = {
        setHeader(k, v) { out.headers[k] = v; },
        status(code) { out.status = code; return res; },
        json(obj) { out.body = obj; return res; }
      };
      await handler({ method, headers, body }, res);
      return out;
    } finally {
      Date.now = origDateNow;
    }
  }

  return {
    store,
    call,
    advanceMs(ms) { mockClock += ms; },
    registerIdToken(tok, user) { validIdTokens.set(tok, user); }
  };
}

function storage() {
  const data = new Map();
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key)
  };
}

function authError(code, message = 'Test Firebase error') {
  return Object.assign(new Error(message), { code });
}

function mockBackend({ holdProfile = false } = {}) {
  const calls = [];
  let releaseProfile = null;
  const user = {
    uid: 'google-qa-user',
    email: 'qa@example.test',
    emailVerified: true,
    displayName: 'QA fixture',
    metadata: { creationTime: '2026-01-01' },
    getIdToken: async () => 'mock-firebase-session',
    reload: async () => {
      profileReloads += 1;
      if (profileReloads > 8) throw new Error('Profile reload loop in fixture');
    }
  };
  const authListeners = new Set();
  let redirectUser = null;
  let holdLogoutAudit = false;
  let signOutCalls = 0;
  let profileReloads = 0;

  const auth = {
    currentUser: null,
    onAuthStateChanged(callback) {
      authListeners.add(callback);
      queueMicrotask(() => callback(this.currentUser));
      return () => authListeners.delete(callback);
    },
    authStateReady: async () => {},
    credentialError: null,
    customTokenError: null,
    popupError: null,
    redirectError: null,
    signOutError: null,
    async signInWithCredential(credential) {
      calls.push({ action: 'credential', token: credential.idToken });
      if (this.credentialError) throw this.credentialError;
      this.currentUser = user;
      return { user };
    },
    async signInWithCustomToken(token) {
      calls.push({ action: 'customToken', token });
      if (this.customTokenError) throw this.customTokenError;
      this.currentUser = user;
      return { user };
    },
    async signInWithPopup(provider) {
      calls.push({ action: 'popup', provider: provider.providerId });
      if (this.popupError) throw this.popupError;
      this.currentUser = user;
      return { user };
    },
    async signInWithRedirect(provider) {
      calls.push({ action: 'redirect', provider: provider.providerId });
      redirectUser = user;
    },
    async getRedirectResult() {
      if (this.redirectError) throw this.redirectError;
      if (!redirectUser) return { user: null };
      this.currentUser = redirectUser;
      redirectUser = null;
      return { user };
    },
    async signOut() {
      signOutCalls += 1;
      if (this.signOutError) throw this.signOutError;
      this.currentUser = null;
    }
  };

  class GoogleAuthProvider {
    providerId = 'google.com';
    setCustomParameters() {}
    static credential(idToken) { return { idToken }; }
  }

  const empty = { docs: [] };
  const collection = name => ({
    limit() { return this; },
    where() { return this; },
    get: async () => {
      if (name === 'profiles' && holdProfile) {
        await new Promise(resolve => { releaseProfile = resolve; });
      }
      return empty;
    },
    doc: () => ({
      get: async () => ({
        exists: name === 'profiles',
        data: () => ({ id: user.uid, role: 'user', display_name: user.displayName })
      })
    }),
    add: async data => {
      if (data.action) calls.push({ action: data.action });
      if (data.action === 'logout' && holdLogoutAudit) return new Promise(() => {});
      return { id: 'qa-entry' };
    }
  });

  return {
    auth, calls,
    holdLogoutAudit: () => { holdLogoutAudit = true; },
    releaseProfile: () => { if (releaseProfile) { const fn = releaseProfile; releaseProfile = null; fn(); } },
    signOutCalls: () => signOutCalls,
    profileReloads: () => profileReloads,
    deliverAuthState: currentUser => Promise.all([...authListeners].map(listener => listener(currentUser))),
    firebase: {
      initializeApp: () => ({
        auth: () => auth,
        firestore: () => ({ enablePersistence: async () => {}, collection })
      }),
      auth: { GoogleAuthProvider },
      firestore: { FieldValue: { serverTimestamp: () => 1 } }
    }
  };
}

function mockPage(backend, {
  native = false,
  legacy = false,
  unavailableAndroid = false,
  profile = false,
  api = createMobileAuthHarness(),
  local = storage(),
  session = storage(),
  href = 'https://example.test/settings.html#accountCard',
  autoInit = true
} = {}) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const listeners = new Map();
      elements.set(id, {
        hidden: false, disabled: false, checked: id === 'authLegalConsent', value: '', textContent: '', className: '', href: '', dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        focus() {},
        querySelector() { return { textContent: '' }; },
        addEventListener(event, fn) {
          const handlers = listeners.get(event) || [];
          handlers.push(fn);
          listeners.set(event, handlers);
        },
        click() {
          if (this.disabled) return;
          for (const handler of listeners.get('click') || []) handler({ currentTarget: this });
        }
      });
    }
    return elements.get(id);
  }

  const posted = [];
  const nativeTimers = new Map();
  const docListeners = new Map();
  const winListeners = new Map();
  const port = {
    postMessage(message) { posted.push(message); },
    reply(value) {
      const lastStart = [...posted].reverse().find(m => m.startsWith('startBrowserSignIn:'));
      const id = lastStart ? lastStart.split(':')[1] : posted.at(-1)?.split(':')[1];
      this.onmessage?.({ data: JSON.stringify({ id, ...value }) });
    }
  };
  let externalOpens = 0;
  let lastOpenedUrl = '';
  let locationHref = href;
  const locationObj = {
    get href() { return locationHref; },
    set href(v) { locationHref = String(v); },
    get origin() { return new URL(locationHref).origin; },
    get hostname() { return new URL(locationHref).hostname; },
    get pathname() { return new URL(locationHref).pathname; },
    get search() { return new URL(locationHref).search; },
    get hash() { return new URL(locationHref).hash; }
  };

  const globals = {
    console, Date, URLSearchParams, URL, atob, btoa: str => Buffer.from(str, 'binary').toString('base64'),
    Uint8Array, TextEncoder,
    crypto: crypto.webcrypto,
    location: locationObj,
    history: {
      replaceState(_, __, nextUrl) {
        locationHref = new URL(nextUrl, locationHref).href;
      }
    },
    navigator: { userAgent: 'qa-google-auth' }, localStorage: local, sessionStorage: session,
    document: {
      visibilityState: 'visible',
      getElementById: element,
      readyState: 'complete',
      addEventListener(ev, fn) {
        const list = docListeners.get(ev) || [];
        list.push(fn);
        docListeners.set(ev, list);
      },
      removeEventListener(ev, fn) {
        const list = docListeners.get(ev) || [];
        docListeners.set(ev, list.filter(f => f !== fn));
      }
    },
    addEventListener(ev, fn) {
      const list = winListeners.get(ev) || [];
      list.push(fn);
      winListeners.set(ev, list);
    },
    removeEventListener(ev, fn) {
      const list = winListeners.get(ev) || [];
      winListeners.set(ev, list.filter(f => f !== fn));
    },
    setTimeout(fn, delay) {
      const timer = { delay };
      nativeTimers.set(timer, { fn, delay });
      if (delay !== 180000) {
        queueMicrotask(() => {
          if (nativeTimers.has(timer)) {
            nativeTimers.delete(timer);
            fn();
          }
        });
      }
      return timer;
    },
    clearTimeout: timer => nativeTimers.delete(timer),
    setInterval(fn, delay) {
      const id = setInterval(fn, delay);
      if (id && typeof id.unref === 'function') id.unref();
      return id;
    },
    clearInterval,
    confirm: () => true,
    async fetch(url, opts = {}) {
      if (String(url).includes('/api/mobile-auth')) {
        const parsed = opts.body ? JSON.parse(opts.body) : {};
        const normHeaders = {};
        for (const [k, v] of Object.entries(opts.headers || {})) {
          normHeaders[k.toLowerCase()] = v;
        }
        const result = await api.call({ method: opts.method || 'POST', headers: normHeaders, body: parsed });
        return {
          status: result.status,
          ok: result.status >= 200 && result.status < 300,
          async json() { return result.body; }
        };
      }
      throw new Error('Unexpected fetch in test: ' + url);
    },
    App: {
      DEFAULTS: { fbConfig: { apiKey: 'test-without-network', projectId: 'example' } },
      settings: () => ({})
    },
    firebase: backend.firebase
  };
  if (native || legacy || unavailableAndroid) {
    globals.AndroidApp = unavailableAndroid
      ? { platform: () => 'android' }
      : {
          platform: () => 'android',
          openInChrome: () => {
            externalOpens += 1;
            lastOpenedUrl = locationHref;
          }
        };
  }
  if (native) globals.DeneyapGooglePort = port;
  globals.window = globals;
  globals.top = globals;
  globals.self = globals;
  const context = vm.createContext(globals);
  if (native) vm.runInContext(bridgeSource[1], context, { filename: 'GoogleSignInBridge.java' });
  for (const name of profile ? webFiles.concat('profile-ui.js') : webFiles) {
    const file = path.join(root, 'pwa/js', name);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
  return {
    element, posted, port, globals, app: globals.App, local, session, api,
    externalOpens: () => externalOpens,
    lastOpenedUrl: () => lastOpenedUrl,
    triggerReturn() {
      for (const fn of [...(docListeners.get('visibilitychange') || [])]) fn();
      for (const fn of [...(winListeners.get('focus') || [])]) fn();
    },
    expireNativeRequest() {
      const entries = [...nativeTimers.entries()].filter(([, timer]) => timer.delay === 180000);
      assert.equal(entries.length, 1, 'Expected one pending bridge timeout');
      const [timer, callback] = entries[0];
      nativeTimers.delete(timer);
      callback.fn();
    }
  };
}

async function until(condition, message) {
  for (let attempts = 0; attempts < 150; attempts += 1) {
    if (condition()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(message);
}

async function ready(page) {
  await until(() => page.app.Auth.snapshot().ready, 'Account initialization should complete');
}

function makePkce() {
  const state = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { state, verifier, challenge };
}

/* ------------------------------------------------------------------ Tests */

async function mobileAuthEndpointSecurity() {
  const api = createMobileAuthHarness();
  const { state, verifier, challenge } = makePkce();

  const getRes = await api.call({ method: 'GET' });
  assert.equal(getRes.status, 405);

  const badState = await api.call({ body: { action: 'init', state: 'bad', challenge } });
  assert.equal(badState.status, 400);

  const initRes = await api.call({ body: { action: 'init', state, challenge } });
  assert.equal(initRes.status, 201);
  assert.equal(initRes.body.ok, true);

  const dupRes = await api.call({ body: { action: 'init', state, challenge } });
  assert.equal(dupRes.status, 409);

  const pendingClaim = await api.call({ body: { action: 'claim', state, verifier } });
  assert.equal(pendingClaim.status, 200);
  assert.equal(pendingClaim.body.pending, true);

  const unauthComplete = await api.call({ body: { action: 'complete', state } });
  assert.equal(unauthComplete.status, 401);

  const badTokenComplete = await api.call({
    headers: { authorization: 'Bearer forged-token' },
    body: { action: 'complete', state }
  });
  assert.equal(badTokenComplete.status, 401);

  const completeRes = await api.call({
    headers: { authorization: 'Bearer valid-google-id-token' },
    body: { action: 'complete', state }
  });
  assert.equal(completeRes.status, 200);
  assert.ok(completeRes.body.code);

  const repeatComplete = await api.call({
    headers: { authorization: 'Bearer valid-google-id-token' },
    body: { action: 'complete', state }
  });
  assert.equal(repeatComplete.status, 409);

  const badVerifier = await api.call({
    body: { action: 'claim', state, verifier: crypto.randomBytes(32).toString('base64url'), code: completeRes.body.code }
  });
  assert.equal(badVerifier.status, 403);

  const claimRes = await api.call({
    body: { action: 'claim', state, verifier, code: completeRes.body.code }
  });
  assert.equal(claimRes.status, 200);
  assert.match(claimRes.body.customToken, /^custom-token-.*-google-qa-user$/);

  const replayClaim = await api.call({ body: { action: 'claim', state, verifier } });
  assert.equal(replayClaim.status, 404);

  const exp = makePkce();
  await api.call({ body: { action: 'init', state: exp.state, challenge: exp.challenge } });
  api.advanceMs(181000);
  const expiredRes = await api.call({ body: { action: 'claim', state: exp.state, verifier: exp.verifier } });
  assert.equal(expiredRes.status, 410);
  assert.equal(api.store.has(exp.state), false, 'Expired PKCE state should be purged');
}

async function nativeBrowserSuccess() {
  const api = createMobileAuthHarness();
  const backend = mockBackend();
  const page = mockPage(backend, { native: true, api });
  await ready(page);
  const button = page.element('googleSignInBtn');
  button.click();
  await until(() => page.posted.length === 1, 'Bridge should post startBrowserSignIn with PKCE state');
  const [, reqId, state] = page.posted[0].split(':');
  assert.ok(reqId && state.length >= 16);
  assert.equal(button.disabled, true);
  await assert.rejects(page.globals.DeneyapGoogleSignIn.startBrowserSignIn(state), /zaten açık/i);

  const complete = await api.call({
    headers: { authorization: 'Bearer valid-google-id-token' },
    body: { action: 'complete', state }
  });
  assert.equal(complete.status, 200);

  page.port.reply({ id: 'older-request', code: complete.body.code, state });
  assert.equal(button.disabled, true);
  page.port.reply({ code: complete.body.code, state });

  await until(() => page.element('authSignedOut').hidden && !button.disabled, 'Browser return callback should sign in via custom token');
  assert.equal(backend.calls[0].action, 'customToken');
  assert.match(backend.calls[0].token, /^custom-token-/);
  assert.equal(page.element('authResult').textContent, 'Giriş başarılı.');
  assert.equal(page.externalOpens(), 0);
  assert.equal(page.element('googleChromeFallbackRow').hidden, true);
}

async function nativeBrowserCallbackEvent() {
  const api = createMobileAuthHarness();
  const backend = mockBackend();
  const page = mockPage(backend, { native: true, api });
  await ready(page);
  page.element('googleSignInBtn').click();
  await until(() => page.posted.length === 1, 'Bridge should start browser sign-in');
  const state = page.posted[0].split(':')[2];
  const complete = await api.call({
    headers: { authorization: 'Bearer valid-google-id-token' },
    body: { action: 'complete', state }
  });
  page.globals.DeneyapNative.onAuthCallback(complete.body.code, state);
  await until(() => page.app.Auth.snapshot().signedIn && !page.element('googleSignInBtn').disabled,
    'DeneyapNative.onAuthCallback should complete sign-in even if reply proxy did not fire');
  assert.equal(backend.calls[0].action, 'customToken');
}

async function nativeBrowserFailure() {
  const backend = mockBackend();
  const page = mockPage(backend, { native: true });
  await ready(page);
  const button = page.element('googleSignInBtn');
  button.click();
  await until(() => page.posted.length === 1, 'Bridge should post startBrowserSignIn');
  page.port.reply({ error: 'Google girişi iptal edildi.', errorCode: 'auth/cancelled-popup-request' });
  await until(() => !button.disabled, 'Cancel should restore the sign-in button');
  assert.match(page.element('authResult').textContent, /iptal edildi/i);
  assert.equal(page.app.Auth.snapshot().signedIn, false);

  button.click();
  await until(() => page.posted.length === 2, 'Second attempt should post');
  page.port.reply({ error: 'Google girişi tarayıcıda açılamadı.', errorCode: 'auth/native-request-failed' });
  await until(() => !button.disabled && /açılamadı/i.test(page.element('authResult').textContent),
    'Native browser failure should show actionable error');
  assert.equal(page.element('googleChromeFallbackRow').hidden, false);
  page.element('googleChromeFallbackBtn').click();
  assert.equal(page.externalOpens(), 1);
}

async function nativeBrowserTimeout() {
  const backend = mockBackend();
  const page = mockPage(backend, { native: true });
  await ready(page);
  const button = page.element('googleSignInBtn');
  button.click();
  await until(() => page.posted.length === 1, 'Bridge should post startBrowserSignIn');
  page.expireNativeRequest();
  await until(() => !button.disabled, 'Native timeout should restore button');
  assert.match(page.element('authResult').textContent, /yanıt alınamadı/i);
  assert.equal(page.posted[1], 'cancelGoogleSignIn:1');

  button.click();
  await until(() => page.posted.length === 3, 'Retry should launch new request');
  const retryState = page.posted[2].split(':')[2];
  const complete = await page.api.call({
    headers: { authorization: 'Bearer valid-google-id-token' },
    body: { action: 'complete', state: retryState }
  });
  page.port.reply({ id: '1', code: 'expired-reply-12345678', state: retryState });
  assert.equal(button.disabled, true);
  page.port.reply({ code: complete.body.code, state: retryState });
  await until(() => page.app.Auth.snapshot().signedIn && !button.disabled, 'Retry should succeed after stale response');
}

async function legacyWebViewChromeHandoff() {
  const api = createMobileAuthHarness();
  const backend = mockBackend();
  const page = mockPage(backend, { legacy: true, api });
  await ready(page);
  page.element('googleSignInBtn').click();
  await until(() => page.externalOpens() === 1, 'Legacy v13 APK should open Chrome Custom Tab directly with native_auth URL');
  const launched = new URL(page.lastOpenedUrl());
  assert.equal(launched.searchParams.get('native_auth'), 'google');
  const state = launched.searchParams.get('state');
  assert.ok(state && state.length >= 16);

  const complete = await api.call({
    headers: { authorization: 'Bearer valid-google-id-token' },
    body: { action: 'complete', state }
  });
  assert.equal(complete.status, 200);

  page.triggerReturn();
  await until(() => page.app.Auth.snapshot().signedIn && !page.element('googleSignInBtn').disabled,
    'Returning to v13 WebView after Chrome login should automatically claim token and sign in');
  assert.equal(backend.calls[0].action, 'customToken');
}

async function unavailableAndroidBridge() {
  const backend = mockBackend();
  const page = mockPage(backend, { unavailableAndroid: true });
  await ready(page);
  page.element('googleSignInBtn').click();
  assert.equal(page.externalOpens(), 0);
  assert.match(page.element('authResult').textContent, /uygulamayı güncelleyin/i);
  assert.equal(page.app.Auth.snapshot().signedIn, false);
}

async function chromeCustomTabHandoff() {
  const api = createMobileAuthHarness();
  const { state, challenge } = makePkce();
  await api.call({ body: { action: 'init', state, challenge } });

  const backend = mockBackend();
  const page = mockPage(backend, {
    api,
    href: 'https://example.test/settings.html?native_auth=google&state=' + state + '&return=app#accountCard'
  });
  await ready(page);
  assert.equal(page.element('nativeAuthHandoff').hidden, false);
  assert.equal(page.element('standardAuthBox').hidden, true);
  assert.equal(page.element('authSignedOut').hidden, false);
  page.element('nativeAuthReturnLink').hidden = true;

  page.element('nativeAuthGoogleBtn').click();
  await until(() => !page.element('nativeAuthReturnLink').hidden && /^deneyapevkoruma:\/\//.test(page.element('nativeAuthReturnLink').href),
    'Completing Google login in Chrome Custom Tab should show return link and redirect to app scheme');
  assert.deepEqual(backend.calls, [{ action: 'popup', provider: 'google.com' }]);
  assert.match(page.element('nativeAuthReturnLink').href, new RegExp('^deneyapevkoruma://auth-callback\\?code=.+&state=' + state + '$'));
  assert.equal(page.globals.location.href, page.element('nativeAuthReturnLink').href);
}

async function browserPopupSyncGesture() {
  const backend = mockBackend({ holdProfile: true });
  const page = mockPage(backend);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.app.Auth.snapshot().ready, false, 'initPromise should still be pending while profile is loading');
  page.element('googleSignInBtn').click();
  assert.equal(backend.calls[0]?.action, 'popup', 'signInWithPopup must run synchronously without waiting on unresolved initPromise');
  backend.releaseProfile();
  await until(() => page.app.Auth.snapshot().signedIn && !page.element('googleSignInBtn').disabled,
    'Browser popup should finish cleanly once profile settles');
}

async function browserPopup() {
  const backend = mockBackend();
  const page = mockPage(backend);
  await ready(page);
  page.element('googleSignInBtn').click();
  await until(() => !page.element('googleSignInBtn').disabled, 'Browser popup should finish');
  assert.deepEqual(backend.calls, [{ action: 'popup', provider: 'google.com' }, { action: 'login_google' }]);
  assert.equal(page.app.Auth.snapshot().signedIn, true);
}

async function browserRedirect() {
  const backend = mockBackend();
  backend.auth.popupError = authError('auth/popup-blocked');
  const before = mockPage(backend);
  await ready(before);
  before.element('googleSignInBtn').click();
  await until(() => !before.element('googleSignInBtn').disabled, 'Blocked popup should initiate redirect');
  assert.deepEqual(backend.calls, [{ action: 'popup', provider: 'google.com' }, { action: 'redirect', provider: 'google.com' }]);
  const after = mockPage(backend, { local: before.local, session: before.session });
  await ready(after);
  assert.equal(after.app.Auth.snapshot().signedIn, true, 'Returning browser should restore the Google session');
  await until(() => backend.calls.some(call => call.action === 'login_google'), 'Redirect login should be recorded');
  assert.equal(backend.calls.filter(call => call.action === 'login_google').length, 1);
  assert.equal(after.element('authSignedOut').hidden, true);
}

async function redirectFailure() {
  const backend = mockBackend();
  backend.auth.redirectError = authError('auth/web-storage-unsupported');
  const session = storage();
  session.setItem('deneyap.auth.redirect.provider', 'google');
  const after = mockPage(backend, { session });
  await ready(after);
  await until(() => /açılır pencereye/i.test(after.element('authResult').textContent),
    'Blocked redirect storage should show an actionable error');
  assert.equal(session.getItem('deneyap.auth.redirect.provider'), null);
  assert.equal(after.app.Auth.snapshot().signedIn, false);
}

async function browserInternalPopupFallbackAndRedirectRestore() {
  const backend = mockBackend();
  backend.auth.popupError = authError('auth/internal-error');
  const before = mockPage(backend);
  await ready(before);
  before.element('googleSignInBtn').click();
  await until(() => !before.element('googleSignInBtn').disabled, 'Mobile internal popup failure should fall back to redirect');
  assert.deepEqual(backend.calls, [{ action: 'popup', provider: 'google.com' }, { action: 'redirect', provider: 'google.com' }]);
  const persistedUser = {
    uid: 'google-qa-user',
    email: 'qa@example.test',
    emailVerified: true,
    displayName: 'QA fixture',
    metadata: { creationTime: '2026-01-01' },
    getIdToken: async () => 'mock-firebase-session',
    reload: async () => {}
  };
  backend.auth.getRedirectResult = async () => ({ user: null });
  backend.auth.currentUser = persistedUser;
  const after = mockPage(backend, { local: before.local, session: before.session });
  await ready(after);
  assert.equal(after.app.Auth.snapshot().signedIn, true, 'Persisted Firebase user should complete redirect login even when getRedirectResult returns null');
}

async function signedInNativePage(backend, options = {}) {
  const api = options.api || createMobileAuthHarness();
  const page = mockPage(backend, { native: true, api, ...options });
  await ready(page);
  page.element('googleSignInBtn').click();
  await until(() => page.posted.length === 1, 'Native browser login should initiate');
  const state = page.posted[0].split(':')[2];
  const complete = await api.call({
    headers: { authorization: 'Bearer valid-google-id-token' },
    body: { action: 'complete', state }
  });
  page.port.reply({ code: complete.body.code, state });
  await until(() => page.app.Auth.snapshot().signedIn && !page.element('googleSignInBtn').disabled,
    'Native Google sign-in should finish before testing logout');
  return page;
}

async function googleSignOutOffline() {
  const api = createMobileAuthHarness();
  const backend = mockBackend();
  backend.holdLogoutAudit();
  const page = await signedInNativePage(backend, { api });
  page.element('authSignOutBtn').click();
  await until(() => !page.app.Auth.snapshot().signedIn, 'A pending audit write must not prevent logout');
  assert.equal(backend.signOutCalls(), 1);
  assert.equal(page.element('authSignedOut').hidden, false);
  assert.equal(page.element('authSignedIn').hidden, true);
  assert.equal(page.local.getItem('deneyap.auth.v1'), null);
  const reopened = mockPage(backend, { local: page.local, session: page.session });
  await ready(reopened);
  assert.equal(reopened.app.Auth.snapshot().signedIn, false, 'Reload after logout must not restore the previous user');

  page.element('googleSignInBtn').click();
  await until(() => page.posted.length === 2, 'Second sign-in should initiate');
  const state2 = page.posted[1].split(':')[2];
  const complete2 = await api.call({
    headers: { authorization: 'Bearer valid-google-id-token' },
    body: { action: 'complete', state: state2 }
  });
  page.port.reply({ code: complete2.body.code, state: state2 });
  await until(() => page.app.Auth.snapshot().signedIn && !page.element('googleSignInBtn').disabled,
    'User should be able to sign in with Google again after logout');
}

async function googleSignOutFailure() {
  const backend = mockBackend();
  const page = await signedInNativePage(backend);
  backend.auth.signOutError = authError('auth/internal-error');
  page.element('authSignOutBtn').click();
  await until(() => page.element('authResult').className.includes('err') || page.element('authResult').textContent === 'Çıkış yapıldı.',
    'The UI should report the logout result');
  assert.equal(backend.signOutCalls(), 1);
  assert.equal(page.element('authResult').className, 'result err');
  assert.equal(page.element('authResult').textContent, 'Çıkış yapılamadı. Tekrar deneyin.');
  assert.equal(page.app.Auth.snapshot().signedIn, true, 'Failed Firebase logout must not report success');
}

async function staleFirebaseAuthCallback() {
  const backend = mockBackend();
  const page = await signedInNativePage(backend);
  let releaseToken;
  let started = false;
  const previousUser = backend.auth.currentUser;
  const tokenRead = new Promise(resolve => { releaseToken = resolve; });
  previousUser.getIdToken = () => {
    started = true;
    return tokenRead;
  };
  const oldCallback = backend.deliverAuthState(previousUser);
  assert.equal(started, true, 'Listener should await the previous user token before logout');
  page.element('authSignOutBtn').click();
  await until(() => !page.app.Auth.snapshot().signedIn, 'Logout should finish while a Firebase token read is pending');
  releaseToken('expired-previous-session');
  await oldCallback;
  assert.equal(page.local.getItem('deneyap.auth.v1'), null, 'A stale Firebase callback must not recreate the logged-out session');
}

async function profileGoogleSignOut() {
  const backend = mockBackend();
  const page = await signedInNativePage(backend, { profile: true });
  const tabs = [];
  page.app.StudioNav = { show: name => tabs.push(name) };
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(backend.profileReloads() < 3, 'Profile render should not repeatedly refresh an unchanged user');
  const button = page.element('signOutThisDeviceBtn');
  button.click();
  await until(() => !page.app.Auth.snapshot().signedIn && !button.disabled, 'Profile logout should close the session');
  assert.equal(backend.signOutCalls(), 1);
  assert.equal(page.element('authSignedOut').hidden, false);
  assert.equal(page.element('profileCard').hidden, true);
  assert.deepEqual(tabs, ['accountCard']);
  assert.equal(page.element('authResult').textContent, 'Çıkış yapıldı.');
}

async function profileGoogleSignOutFailure() {
  const backend = mockBackend();
  const page = await signedInNativePage(backend, { profile: true });
  backend.auth.signOutError = authError('auth/internal-error');
  const button = page.element('signOutThisDeviceBtn');
  button.click();
  assert.equal(button.disabled, true);
  await until(() => !button.disabled, 'Profile logout error should restore the retry button');
  assert.equal(backend.signOutCalls(), 1);
  assert.equal(page.element('sessionResult').textContent, 'Çıkış yapılamadı. Tekrar deneyin.');
  assert.equal(page.element('sessionResult').className, 'result err');
  assert.equal(page.app.Auth.snapshot().signedIn, true);
}

async function legalConsentBlocksUncheckedSignIn() {
  const backend = mockBackend();
  const page = mockPage(backend);
  await ready(page);

  const cb = page.element('authLegalConsent');
  cb.checked = false;

  page.element('authEmail').value = 'ali@example.test';
  page.element('authPass').value = 'GucluSifre1!';

  /* İlk kez giriş/kayıt: sosyal giriş ve hesap oluşturma engellenir */
  page.element('googleSignInBtn').click();
  page.element('githubSignInBtn').click();
  page.element('appleSignInBtn').click();
  page.element('authSignUpBtn').click();
  await until(() => /Kullanım Koşulları|Gizlilik Politikası/.test(page.element('authResult').textContent),
    'Legal consent message should appear');

  assert.equal(backend.calls.length, 0);
  assert.equal(page.app.Auth.snapshot().signedIn, false);

  /* İlk kez kutucuk işaretlenip Google ile giriş yapılır */
  cb.checked = true;
  page.element('googleSignInBtn').click();
  await until(() => !page.element('googleSignInBtn').disabled, 'Google sign-in should proceed once consent is checked');
  assert.equal(page.app.Auth.snapshot().signedIn, true);

  /* Çıkış yapıp aynı cihazda tekrar girişte kutucuk zorunlu olmamalı */
  await page.app.Auth.signOut();
  cb.checked = false;
  page.element('googleSignInBtn').click();
  await until(() => !page.element('googleSignInBtn').disabled, 'Returning Google sign-in should not require re-checking consent');
  assert.equal(page.app.Auth.snapshot().signedIn, true);
}

(async () => {
  const checks = [
    mobileAuthEndpointSecurity,
    legalConsentBlocksUncheckedSignIn,
    nativeBrowserSuccess,
    nativeBrowserCallbackEvent,
    nativeBrowserFailure,
    nativeBrowserTimeout,
    legacyWebViewChromeHandoff,
    unavailableAndroidBridge,
    chromeCustomTabHandoff,
    browserPopupSyncGesture,
    browserPopup,
    browserRedirect,
    redirectFailure,
    browserInternalPopupFallbackAndRedirectRestore,
    googleSignOutOffline,
    googleSignOutFailure,
    staleFirebaseAuthCallback,
    profileGoogleSignOut,
    profileGoogleSignOutFailure
  ];
  for (const check of checks) {
    await check();
    console.log('PASS ' + check.name);
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
