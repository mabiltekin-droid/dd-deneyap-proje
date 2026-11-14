'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const webFiles = ['firebase.js', 'auth-firebase.js', 'account.js'];
const androidFile = path.join(root, 'android/app/src/main/java/com/mabiltekin/deneyapevkoruma/GoogleSignInBridge.java');
const bridgeSource = fs.readFileSync(androidFile, 'utf8').match(/\bString SCRIPT = """([\s\S]+?)""";/);
assert.ok(bridgeSource, 'Native WebView bridge JavaScript should be present');

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

function mockBackend() {
  const calls = [];
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
    popupError: null,
    redirectError: null,
    signOutError: null,
    async signInWithCredential(credential) {
      calls.push({ action: 'credential', token: credential.idToken });
      if (this.credentialError) throw this.credentialError;
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
    get: async () => empty,
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

function mockPage(backend, { native = false, legacy = false, profile = false, local = storage(), session = storage() } = {}) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const listeners = new Map();
      elements.set(id, {
        hidden: false, disabled: false, value: '', textContent: '', className: '', dataset: {},
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
  const port = {
    postMessage(message) { posted.push(message); },
    reply(value) {
      const id = posted.at(-1)?.split(':')[1];
      this.onmessage?.({ data: JSON.stringify({ id, ...value }) });
    }
  };
  let externalOpens = 0;
  const globals = {
    console, Date, URLSearchParams, URL, atob, location: { hostname: 'example.test', search: '', href: 'https://example.test/settings#accountCard' },
    navigator: { userAgent: 'qa-google-auth' }, localStorage: local, sessionStorage: session,
    document: { getElementById: element, readyState: 'complete', addEventListener() {} },
    addEventListener() {}, removeEventListener() {},
    setTimeout(fn, delay) {
      const timer = Symbol();
      nativeTimers.set(timer, { fn, delay });
      return timer;
    },
    clearTimeout: timer => nativeTimers.delete(timer), setInterval, clearInterval,
    confirm: () => true,
    App: {
      DEFAULTS: { fbConfig: { apiKey: 'test-without-network', projectId: 'example' } },
      settings: () => ({})
    },
    firebase: backend.firebase
  };
  if (native || legacy) globals.AndroidApp = { openInChrome: () => { externalOpens += 1; } };
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
  return { element, posted, port, globals, app: globals.App, local, session,
    externalOpens: () => externalOpens,
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
  for (let attempts = 0; attempts < 100; attempts += 1) {
    if (condition()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(message);
}

async function ready(page) {
  await until(() => page.app.Auth.snapshot().ready, 'Account initialization should complete');
}

async function nativeSuccess() {
  const backend = mockBackend();
  const page = mockPage(backend, { native: true });
  await ready(page);
  const button = page.element('googleSignInBtn');
  button.click();
  assert.equal(button.disabled, true);
  await assert.rejects(page.globals.DeneyapGoogleSignIn.getGoogleIdToken(), /zaten açık/i);
  assert.deepEqual(page.posted, ['getGoogleIdToken:1']);
  page.port.reply({ id: 'older-request', idToken: 'ignore-stale' });
  assert.equal(button.disabled, true);
  page.port.reply({ idToken: 'mock-google-id-token' });
  await until(() => page.element('authSignedOut').hidden && !button.disabled, 'Native Google should sign in in the app');
  assert.deepEqual(backend.calls, [{ action: 'credential', token: 'mock-google-id-token' }, { action: 'login_google' }]);
  assert.equal(page.element('authResult').textContent, 'Giriş başarılı.');
  assert.equal(page.externalOpens(), 0);
  assert.equal(JSON.parse(page.local.getItem('deneyap.auth.v1')).access_token, 'mock-firebase-session');
  const reopened = mockPage(backend);
  await ready(reopened);
  assert.equal(reopened.app.Auth.snapshot().signedIn, true, 'Firebase persisted user should restore without local marker');
}

async function nativeFailure() {
  const backend = mockBackend();
  const page = mockPage(backend, { native: true });
  await ready(page);
  const button = page.element('googleSignInBtn');
  button.click();
  page.port.reply({ error: 'Google girişi iptal edildi.', code: 'auth/cancelled-popup-request' });
  await until(() => !button.disabled, 'Cancel should restore the sign-in button');
  assert.match(page.element('authResult').textContent, /iptal edildi/i);
  assert.deepEqual(backend.calls, []);
  assert.equal(page.app.Auth.snapshot().signedIn, false);

  backend.auth.credentialError = authError('auth/invalid-credential');
  button.click();
  assert.deepEqual(page.posted, ['getGoogleIdToken:1', 'getGoogleIdToken:2']);
  page.port.reply({ idToken: 'rejected-fixture' });
  await until(() => !button.disabled, 'Firebase credential rejection should restore the sign-in button');
  assert.deepEqual(backend.calls, [{ action: 'credential', token: 'rejected-fixture' }]);
  assert.equal(page.app.Auth.snapshot().signedIn, false);
  assert.equal(page.externalOpens(), 0);
}

async function nativeTimeout() {
  const backend = mockBackend();
  const page = mockPage(backend, { native: true });
  await ready(page);
  const button = page.element('googleSignInBtn');
  button.click();
  page.expireNativeRequest();
  await until(() => !button.disabled, 'Native timeout should restore button');
  assert.match(page.element('authResult').textContent, /yanıt alınamadı/i);
  assert.deepEqual(page.posted, ['getGoogleIdToken:1', 'cancelGoogleSignIn:1']);
  button.click();
  page.port.reply({ id: '1', idToken: 'expired-reply' });
  assert.equal(button.disabled, true);
  page.port.reply({ idToken: 'successful-retry' });
  await until(() => page.app.Auth.snapshot().signedIn && !button.disabled, 'Retry should finish after stale response');
  assert.deepEqual(backend.calls, [{ action: 'credential', token: 'successful-retry' }, { action: 'login_google' }]);
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

async function signedInNativePage(backend, options = {}) {
  const page = mockPage(backend, { native: true, ...options });
  await ready(page);
  page.element('googleSignInBtn').click();
  page.port.reply({ idToken: 'mock-google-id-token' });
  await until(() => page.app.Auth.snapshot().signedIn && !page.element('googleSignInBtn').disabled,
    'Native Google sign-in should finish before testing logout');
  return page;
}

async function googleSignOutOffline() {
  const backend = mockBackend();
  backend.holdLogoutAudit();
  const page = await signedInNativePage(backend);
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
  assert.deepEqual(page.posted, ['getGoogleIdToken:1', 'getGoogleIdToken:2']);
  page.port.reply({ idToken: 'mock-google-next-login' });
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

async function legacyWebView() {
  const backend = mockBackend();
  const page = mockPage(backend, { legacy: true });
  await ready(page);
  page.element('googleSignInBtn').click();
  assert.equal(page.externalOpens(), 0);
  assert.match(page.element('authResult').textContent, /uygulamayı güncelleyin/i);
  assert.equal(page.app.Auth.snapshot().signedIn, false);
  assert.deepEqual(backend.calls, []);
}

(async () => {
  for (const check of [nativeSuccess, nativeFailure, nativeTimeout, browserPopup, browserRedirect, redirectFailure, legacyWebView, googleSignOutOffline, googleSignOutFailure, staleFirebaseAuthCallback, profileGoogleSignOut, profileGoogleSignOutFailure]) {
    await check();
    console.log('PASS ' + check.name);
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
