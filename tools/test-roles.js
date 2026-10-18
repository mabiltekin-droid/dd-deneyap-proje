#!/usr/bin/env node
/* ==========================================================================
   test-roles.js — "rol yükseltme" korumasının (yetki güvenliği) testi.
   --------------------------------------------------------------------------
   Ne yapar?
     * pwa/js/firebase.js GERÇEK dosyasını, sahte bir Firebase SDK ile yükler.
     * firestore.rules içindeki profiles / config:bootstrap koşullarını
       birebir simüle eder ve şu senaryoları doğrular:
         A) İlk kullanıcı (davetsiz)  → admin olur, config/bootstrap işareti onun
         B) Sonraki kullanıcı 'admin' isterse → 'user' olur (yükseltme engellendi)
         B2) Kendi profilini update ile admin yapma → permission-denied
         C) Geçerli ADMIN daveti ile kayıt → admin
         D) Normal (user) davetiyle admin olma → reddedilir
         E) Kullanılmış admin daveti → reddedilir
         F/G) ensureOwnProfile (profil kurtarma) senaryoları
     * Tarayıcı/ağ/Kimlik gerekmez. Çıkış kodu 0 = tüm testler geçti.

   ÖNEMLİ: Buradaki kural simülasyonu firestore.rules ile ELLE senkron
   tutulmalıdır. Kuralları değiştirirseniz buradaki `ruleProfilesWrite`
   fonksiyonunu da güncelleyin.

   Kullanım: npm run test:roles
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CODE = fs.readFileSync(path.join(ROOT, 'pwa', 'js', 'firebase.js'), 'utf8');

let STORE = {};
let UID = null;
let uidSeq = 0;

function permDenied() {
  const e = new Error('Missing or insufficient permissions.');
  e.code = 'permission-denied';
  return e;
}

/* ---- firestore.rules simülasyonu (profiles + config/bootstrap) ---------- */
function ruleProfilesWrite(kind, id, data) {
  const isSelf = !!UID && UID === id;
  const isAdmin = !!UID && STORE.profiles[UID] && STORE.profiles[UID].role === 'admin';
  const role = 'role' in data ? data.role : 'user';
  const hasId = 'id' in data;
  if (kind === 'create') {
    if (!(isSelf || isAdmin)) return false;
    if (hasId && data.id !== id) return false;
    if (isAdmin) return true;
    if (role === 'user') return true;
    if (role !== 'admin') return false;
    const boot = STORE.config.bootstrap;
    const bootOwner = !!boot && boot.uid === UID;
    let invOk = false;
    if ('invite_code' in data && typeof data.invite_code === 'string' && data.invite_code.length > 0) {
      const inv = STORE.invites[data.invite_code];
      invOk = !!inv && inv.role === 'admin' && inv.used === false;
    }
    return bootOwner || invOk;
  }
  if (kind === 'update') {
    if (isAdmin) return true;
    if (!isSelf) return false;
    if (hasId && data.id !== id) return false;
    const prev = STORE.profiles[id] || {};
    const prevRole = 'role' in prev ? prev.role : 'user';
    return role === prevRole;
  }
  return false;
}

/* ---- Sahte Firestore ---------------------------------------------------- */
function docRef(name, id) {
  return {
    id: id,
    set: async function (data, opts) {
      const exists = !!(STORE[name] && STORE[name][id]);
      const kind = exists ? 'update' : 'create';
      const merged = (opts && opts.merge) ? Object.assign({}, STORE[name][id], data) : data;
      if (name === 'profiles' && !ruleProfilesWrite(kind, id, merged)) throw permDenied();
      if (name === 'config' && id === 'bootstrap') {
        if (exists) throw permDenied();
        if (!UID || data.uid !== UID) throw permDenied();
      }
      STORE[name] = STORE[name] || {};
      STORE[name][id] = Object.assign({}, merged);
      return {};
    },
    get: async function () {
      const d = (STORE[name] || {})[id];
      return { id: id, exists: !!d, data: () => (d ? Object.assign({}, d) : undefined) };
    },
    update: async function (data) {
      const prev = (STORE[name] || {})[id];
      const merged = Object.assign({}, prev, data);
      if (name === 'profiles' && !ruleProfilesWrite('update', id, merged)) throw permDenied();
      STORE[name] = STORE[name] || {};
      STORE[name][id] = merged;
      return {};
    },
    delete: async function () {
      if (name === 'profiles' && !ruleProfilesWrite('delete', id, {})) throw permDenied();
      delete (STORE[name] || {})[id];
      return {};
    }
  };
}

function colRef(name) {
  const c = {
    doc: (id) => docRef(name, id),
    orderBy: () => c,
    limit: () => c,
    where: () => c,
    add: async (d) => { const id = 'auto' + Math.random().toString(36).slice(2); (STORE[name] = STORE[name] || {})[id] = d; return { id }; },
    get: async () => {
      const rows = Object.values(STORE[name] || {});
      return { docs: rows.map(d => ({ id: d.id || '', data: () => Object.assign({}, d) })) };
    }
  };
  return c;
}

function makeDb() {
  return { collection: (n) => colRef(n), enablePersistence: () => Promise.resolve() };
}

const authObj = {
  currentUser: null,
  signOut: async () => { authObj.currentUser = null; UID = null; return true; },
  onAuthStateChanged: () => {},
  createUserWithEmailAndPassword: async (email) => {
    UID = 'uid' + (++uidSeq);
    authObj.currentUser = {
      uid: UID, email: email,
      metadata: { creationTime: '2026-01-01' },
      sendEmailVerification: async () => {},
      getIdToken: async () => 'tok'
    };
    return { user: authObj.currentUser };
  },
  signInWithEmailAndPassword: async (email) => {
    UID = 'uid' + (++uidSeq);
    authObj.currentUser = { uid: UID, email: email, emailVerified: true, metadata: { creationTime: '2026-01-01' }, getIdToken: async () => 'tok' };
    return { user: authObj.currentUser };
  },
  sendPasswordResetEmail: async () => {}
};

global.window = global;
global.localStorage = {
  m: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.m, k) ? this.m[k] : null; },
  setItem(k, v) { this.m[k] = String(v); },
  removeItem(k) { delete this.m[k]; }
};
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-test' }, configurable: true, writable: true });
global.document = { readyState: 'complete', addEventListener: () => {}, removeEventListener: () => {} };
global.addEventListener = () => {};
global.removeEventListener = () => {};
global.App = { DEFAULTS: { fbConfig: { apiKey: 'x', projectId: 'p' } } };
global.firebase = {
  initializeApp: () => ({ auth: () => authObj, firestore: () => makeDb(), delete: async () => {} }),
  firestore: { FieldValue: { serverTimestamp: () => ({ __ts: true }) } },
  auth: { EmailAuthProvider: { credential: () => ({}) } }
};

/* firebase.js'i yükle (tarayıcıdaki IIFE gibi çalışır) */
eval(CODE);

const FB = global.window.App.FB;

/* ---- Yardımcılar -------------------------------------------------------- */
function reset(seed) {
  STORE = { profiles: {}, invites: {}, config: {}, device_bindings: {}, device_codes: {}, device_unlocks: {}, login_logs: {}, audit_logs: {}, alarm_events: {} };
  Object.assign(STORE, seed || {});
  UID = null;
  uidSeq = 0;
  localStorage.m = {};
}

let pass = 0, fail = 0;
function expect(label, actual, wanted) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  console.log((ok ? '  ✓ ' : '  ✗ ') + label + (ok ? '' : '  → beklenen ' + JSON.stringify(wanted) + ', gelen ' + JSON.stringify(actual)));
  if (ok) pass++; else fail++;
}
function roleOfUid(uid) { return (STORE.profiles[uid] || {}).role; }

(async function run() {
  /* A) İLK kullanıcı, davetsiz → admin + bootstrap işareti */
  console.log('\nA) İlk kullanıcı (davetsiz)');
  reset();
  let r = await FB.signUp('ilk@a.com', 'pw1234', { display_name: 'İlk' });
  const uidA = r.user.id;
  expect('profil rolü admin', roleOfUid(uidA), 'admin');
  expect('bootstrap işareti ilk kullanıcıya ait', STORE.config.bootstrap && STORE.config.bootstrap.uid === uidA, true);
  expect('admin profiline davet kodu yazılmadı', 'invite_code' in STORE.profiles[uidA], false);

  /* B) İKİNCİ kullanıcı, davetsiz, 'admin' istiyor */
  console.log('\nB) İkinci kullanıcı (kendini admin yapmaya çalışıyor)');
  r = await FB.signUp('kotu@a.com', 'pw1234', { display_name: 'Kötü', role: 'admin' });
  const uidB = r.user.id;
  expect("rol 'user' olarak düştü", roleOfUid(uidB), 'user');
  expect('admin olmadı', roleOfUid(uidB) === 'admin', false);

  /* B2) Mevcut normal kullanıcı kendi profilini update ile yükseltmeye çalışıyor */
  console.log('\nB2) Kendi profilini güncelleyerek yükseltme denemesi');
  UID = uidB;
  let blocked = false;
  try { await FB.updateProfile(uidB, { role: 'admin' }); } catch (e) { blocked = (e.code === 'permission-denied'); }
  expect('rol güncellemesi reddedildi (permission-denied)', blocked, true);
  expect('rol hâlâ user', roleOfUid(uidB), 'user');
  let ok = false;
  try { await FB.updateProfile(uidB, { display_name: 'Yeni Ad' }); ok = true; } catch (e) { ok = String(e.code); }
  expect('ad güncellemesi hâlâ çalışıyor', ok, true);

  /* C) ADMIN daveti ile kayıt → admin + davet kodu dokümanda */
  console.log('\nC) ADMIN davetiyle kayıt');
  STORE.invites['ADMCODE01'] = { code: 'ADMCODE01', role: 'admin', used: false };
  r = await FB.signUp('arkadas@a.com', 'pw1234', { display_name: 'Arkadaş', role: 'admin', invite_code: 'ADMCODE01' });
  const uidC = r.user.id;
  expect('rol admin', roleOfUid(uidC), 'admin');
  expect('davet kodu profilde', STORE.profiles[uidC].invite_code, 'ADMCODE01');

  /* D) USER davetiyle 'admin' isteme → reddedilir, user olur */
  console.log('\nD) Normal (user) davetiyle admin olma denemesi');
  STORE.invites['USRCODE01'] = { code: 'USRCODE01', role: 'user', used: false };
  r = await FB.signUp('d@a.com', 'pw1234', { display_name: 'D', role: 'admin', invite_code: 'USRCODE01' });
  expect("rol 'user' olarak düştü", roleOfUid(r.user.id), 'user');

  /* E) KULLANILMIŞ admin daveti → geçersiz */
  console.log('\nE) Kullanılmış admin daveti');
  STORE.invites['ADMUSED01'] = { code: 'ADMUSED01', role: 'admin', used: true };
  r = await FB.signUp('e@a.com', 'pw1234', { display_name: 'E', role: 'admin', invite_code: 'ADMUSED01' });
  expect("rol 'user' olarak düştü", roleOfUid(r.user.id), 'user');

  /* F) ensureOwnProfile: profili silinmiş kullanıcı, admin davetiyle geri */
  console.log('\nF) ensureOwnProfile (profil kurtarma) — admin davetiyle');
  reset({ invites: { ADMKURTAR1: { code: 'ADMKURTAR1', role: 'admin', used: false } } });
  STORE.config.bootstrap = { uid: 'baskaKisi' };
  UID = 'uidKurtar';
  let p = await FB.ensureOwnProfile('uidKurtar', 'k@a.com', 'K', 'admin', 'ADMKURTAR1');
  expect('rol admin (davet sayesinde)', p.role, 'admin');

  /* G) ensureOwnProfile: davetsiz + bootstrap başkasında → user */
  console.log('\nG) ensureOwnProfile — davetsiz, bootstrap başkasında');
  reset();
  STORE.config.bootstrap = { uid: 'baskaKisi' };
  UID = 'uidYeni';
  p = await FB.ensureOwnProfile('uidYeni', 'y@a.com', 'Y');
  expect("rol 'user'", p.role, 'user');

  console.log('\n' + (fail === 0 ? 'TÜM TESTLER GEÇTİ' : 'HATA VAR') + ' → ' + pass + ' geçti, ' + fail + ' başarısız\n');
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) { console.error('BEKLENMEYEN HATA:', e); process.exit(2); });
