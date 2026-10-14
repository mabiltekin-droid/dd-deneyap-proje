/* ==========================================================================
   firebase.js — Firebase Auth + Firestore istemcisi (Supabase yerine)
   
   Supabase REST API'sinin birebir aynısını taklit eder:
   - signIn, signUp, signOut, ensureSession
   - rest() → Firestore koleksiyon/islemlerine yönlendirir
   - probeSetup() → Firestore bağlantı testi
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});

  App.FB_STORAGE = 'deneyap.auth.v1';

  /* -------------------------------------------------- Firebase Config -------- */
  // config.js'den gelecek: App.DEFAULTS.fbConfig

  function getFirebaseConfig() {
    const s = typeof App.settings === 'function' ? App.settings() : {};
    return s.fbConfig || App.DEFAULTS.fbConfig || null;
  }

  /* -------------------------------------------------- Yardımcılar ------------ */

  function store(read) {
    try {
      if (read) return JSON.parse(localStorage.getItem(App.FB_STORAGE) || 'null');
      return true;
    } catch (e) { return null; }
  }

  function save(sess) {
    try {
      if (sess) localStorage.setItem(App.FB_STORAGE, JSON.stringify(sess));
      else localStorage.removeItem(App.FB_STORAGE);
    } catch (e) { console.warn('[fb] oturum yazılamadı', e); }
  }

  function human(err) {
    const code = err && err.code;
    const msg = (err && err.message) || '';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || /invalid.*credential/i.test(msg))
      return 'E-posta veya şifre hatalı.';
    if (code === 'auth/email-already-in-use' || /already (been )?registered/i.test(msg))
      return 'Bu e-posta zaten kayıtlı.';
    if (code === 'auth/weak-password' || /password should be|at least 6 char/i.test(msg))
      return 'Şifre çok zayıf (en az 6 karakter).';
    if (code === 'auth/email-not-verified' || /email.*not.*verified/i.test(msg))
      return 'E-posta doğrulanmamış. Gelen kutunuzdaki bağlantıyı onaylayın.';
    if (code === 'auth/operation-not-allowed' || /signups not allowed/i.test(msg))
      return 'Yeni kayıt kapalı.';
    if (code === 'auth/too-many-requests' || /rate limit|too many requests/i.test(msg))
      return 'Çok fazla deneme. Birkaç dakika sonra tekrar deneyin.';
    if (/network|Failed to fetch|offline/i.test(msg)) return 'İnternet bağlantısı yok.';
    if (code === 'permission-denied' || /permission denied|missing.*permission/i.test(msg))
      return 'Yetki hatası: Firestore kuralları yüklenmemiş olabilir.';
    if (code === 'unavailable' || /unavailable/i.test(msg))
      return 'Firestore geçici olarak erişilemiyor.';
    return msg || 'Bilinmeyen hata (' + (code || '?') + ')';
  }

  function toError(err) {
    const e = new Error(err.message || 'Firebase hatası');
    e.code = err.code || 'unknown';
    e.human = human(e);
    return e;
  }

  /* -------------------------------------------------- Firebase Init ---------- */

  let firebaseApp = null;
  let auth = null;
  let db = null;

  function ensureFirebase() {
    if (firebaseApp) return true;
    
    const config = getFirebaseConfig();
    if (!config || !config.apiKey) {
      const e = new Error('Firebase config eksik.');
      e.code = 'not_configured'; e.human = e.message;
      throw e;
    }

    try {
      // Firebase SDK global namespace (CDN yüklüyse)
      if (typeof firebase === 'undefined') {
        const e = new Error('Firebase SDK yüklenmedi.');
        e.code = 'sdk_missing'; e.human = 'Firebase kütüphanesi bulunamadı.';
        throw e;
      }

      firebaseApp = firebase.initializeApp(config);
      auth = firebaseApp.auth();
      db = firebaseApp.firestore();
      
      // Offline persistence (IndexedDB)
      db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
      
      return true;
    } catch (e) {
      console.error('[fb] init hatası:', e);
      throw toError(e);
    }
  }

  /* -------------------------------------------------- Oturum Yönetimi -------- */

  function current() {
    const s = store(true);
    if (!s || !s.access_token) return null;
    if (s.expires_at && Date.now() / 1000 > s.expires_at - 60) return null;
    return s;
  }

  async function ensureSession() {
    ensureFirebase();
    
    const live = current();
    if (live) return live;

    const s = store(true);
    if (!s || !s.refresh_token) return null;

    try {
      // Firebase refresh token ile yenileme (internal API)
      const user = auth.currentUser;
      if (user) {
        const token = await user.getIdToken(true);
        const sess = {
          access_token: token,
          refresh_token: s.refresh_token, // Firebase'de ayrı refresh token yok, session cookie kullanılır
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: user.uid,
            email: user.email,
            created_at: user.metadata.creationTime
          }
        };
        save(sess);
        return sess;
      }
      return null;
    } catch (e) {
      console.warn('[fb] oturum yenilenemedi:', e);
      save(null);
      return null;
    }
  }

  function saveSession(firebaseUser, idToken) {
    const now = Math.floor(Date.now() / 1000);
    const sess = {
      access_token: idToken,
      refresh_token: 'firebase_session', // placeholder
      expires_at: now + 3600,
      user: {
        id: firebaseUser.uid,
        email: firebaseUser.email,
        created_at: firebaseUser.metadata.creationTime
      }
    };
    save(sess);
    return sess;
  }

  /* -------------------------------------------------- Firestore Yardımcıları - */

  const COL_PROFILES = 'profiles';
  const COL_BINDINGS = 'device_bindings';

  function profilesRef() { return db.collection(COL_PROFILES); }
  function bindingsRef() { return db.collection(COL_BINDINGS); }

  /* Profiles collection: doc ID = user.uid */
  async function createProfile(user, role, displayName) {
    const ref = profilesRef().doc(user.uid);
    await ref.set({
      id: user.uid,
      email: user.email,
      role: role,
      display_name: displayName || user.email?.split('@')[0] || '',
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
      last_seen_at: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return (await ref.get()).data();
  }

  async function getProfile(uid) {
    const snap = await profilesRef().doc(uid).get();
    return snap.exists ? snap.data() : null;
  }

  async function updateProfile(uid, data) {
    await profilesRef().doc(uid).update({
      ...data,
      last_seen_at: firebase.firestore.FieldValue.serverTimestamp()
    });
    return getProfile(uid);
  }

  async function listProfiles() {
    const snap = await profilesRef().orderBy('created_at', 'asc').get();
    return snap.docs.map(d => d.data());
  }

  async function deleteProfile(uid) {
    await profilesRef().doc(uid).delete();
  }

  /* Device bindings collection: doc ID = device_id */
  async function listBindings() {
    const snap = await bindingsRef().orderBy('bound_at', 'desc').get();
    return snap.docs.map(d => d.data());
  }

  async function getBinding(deviceId) {
    const snap = await bindingsRef().doc(deviceId).get();
    return snap.exists ? snap.data() : null;
  }

  async function setBinding(deviceId, ownerId, label, boundBy) {
    await bindingsRef().doc(deviceId).set({
      device_id: deviceId,
      owner_id: ownerId,
      label: label || '',
      bound_at: firebase.firestore.FieldValue.serverTimestamp(),
      bound_by: boundBy
    }, { merge: true });
  }

  async function deleteBinding(deviceId) {
    await bindingsRef().doc(deviceId).delete();
  }

  async function updateBinding(deviceId, data) {
    await bindingsRef().doc(deviceId).update(data);
  }

  /* -------------------------------------------------- Dışa Açık API ---------- */

  App.FB = {
    conf: getFirebaseConfig,
    human: human,
    hasConfig: function () { return !!getFirebaseConfig(); },

    token: async function () {
      const s = await ensureSession();
      return s ? s.access_token : null;
    },

    signIn: async function (email, password) {
      ensureFirebase();
      const cred = await auth.signInWithEmailAndPassword(email.trim(), password);
      const token = await cred.user.getIdToken();
      return saveSession(cred.user, token);
    },

    signUp: async function (email, password, data) {
      ensureFirebase();
      const cred = await auth.createUserWithEmailAndPassword(email.trim(), password);
      const token = await cred.user.getIdToken();
      
      // İlk kullanıcı mı kontrol et
      const existing = await listProfiles();
      const isFirst = existing.length === 0;
      const role = isFirst ? 'admin' : 'user';
      
      await createProfile(cred.user, role, data?.display_name);
      
      return saveSession(cred.user, token);
    },

    signOut: async function () {
      ensureFirebase();
      await auth.signOut();
      save(null);
      return true;
    },

    session: function () { return current(); },

    ensureSession: ensureSession,

    probeSetup: async function () {
      if (!App.FB.hasConfig()) return false;
      try {
        ensureFirebase();
        // Profiles koleksiyonu var mı kontrol et (en az bir doc oku)
        await profilesRef().limit(1).get();
        return true;
      } catch (e) {
        if (e.code === 'permission-denied') return false; // Kurallar yok
        return e.code !== 'network' && e.code !== 'unavailable';
      }
    },

    profile: async function () {
      const sess = await ensureSession();
      if (!sess) return null;
      try {
        const p = await getProfile(sess.user.id);
        if (!p) return { __setupRequired: true };
        return p;
      } catch (e) {
        if (e.code === 'permission-denied') return { __setupRequired: true };
        throw e;
      }
    },

    rest: async function (path, opts) {
      opts = opts || {};
      ensureFirebase();
      const sess = await ensureSession();
      
      // Path format: "profiles?select=*&limit=1" veya "device_bindings"
      // Basit parser: collection?query
      const [collection, queryString] = path.split('?');
      
      if (collection === 'profiles') {
        let query = profilesRef();
        
        if (queryString) {
          // Basit query parsing: id=eq.xxx, select=*, order=, limit=
          const params = new URLSearchParams(queryString);
          if (params.has('id')) {
            const idFilter = params.get('id');
            if (idFilter.startsWith('eq.')) {
              const uid = idFilter.slice(3);
              const doc = await profilesRef().doc(uid).get();
              return doc.exists ? [doc.data()] : [];
            }
          }
          if (params.has('select')) {
            // select=* → tüm fieldlar
          }
          if (params.has('order')) {
            const [field, dir] = params.get('order').split('.');
            query = query.orderBy(field, dir === 'desc' ? 'desc' : 'asc');
          }
          if (params.has('limit')) {
            query = query.limit(parseInt(params.get('limit')));
          }
        }
        
        if (opts.method === 'PATCH') {
          // profiles?id=eq.xxx&role=in.(admin,user) + body: {role}
          const params = new URLSearchParams(queryString);
          const idFilter = params.get('id');
          if (idFilter && idFilter.startsWith('eq.')) {
            const uid = idFilter.slice(3);
            await updateProfile(uid, opts.body);
            if (opts.prefer === 'return=representation') {
              return [await getProfile(uid)];
            }
            return [];
          }
        }
        
        if (opts.method === 'DELETE') {
          const params = new URLSearchParams(queryString);
          const idFilter = params.get('id');
          if (idFilter && idFilter.startsWith('eq.')) {
            const uid = idFilter.slice(3);
            await deleteProfile(uid);
            return [];
          }
        }
        
        if (opts.method === 'POST') {
          // Profiles'e POST yok (trigger ile oluşur)
          throw toError({ code: 'not_supported', message: 'Profiles POST not supported' });
        }
        
        const snap = await query.get();
        return snap.docs.map(d => d.data());
      }
      
      if (collection === 'device_bindings') {
        let query = bindingsRef();
        
        if (queryString) {
          const params = new URLSearchParams(queryString);
          if (params.has('device_id')) {
            const filter = params.get('device_id');
            if (filter.startsWith('eq.')) {
              const deviceId = filter.slice(3);
              const doc = await bindingsRef().doc(deviceId).get();
              return doc.exists ? [doc.data()] : [];
            }
          }
          if (params.has('owner_id')) {
            const filter = params.get('owner_id');
            if (filter.startsWith('eq.')) {
              query = query.where('owner_id', '==', filter.slice(3));
            }
          }
          if (params.has('order')) {
            const [field, dir] = params.get('order').split('.');
            query = query.orderBy(field, dir === 'desc' ? 'desc' : 'asc');
          }
        }
        
        if (opts.method === 'POST') {
          // device_bindings + body: {device_id, owner_id, label, bound_by}
          const body = opts.body || {};
          await setBinding(body.device_id, body.owner_id, body.label, body.bound_by);
          if (opts.prefer && opts.prefer.includes('return=representation')) {
            return [await getBinding(body.device_id)];
          }
          return [];
        }
        
        if (opts.method === 'DELETE') {
          const params = new URLSearchParams(queryString);
          const deviceFilter = params.get('device_id');
          if (deviceFilter && deviceFilter.startsWith('eq.')) {
            await deleteBinding(deviceFilter.slice(3));
            return [];
          }
        }
        
        if (opts.method === 'PATCH') {
          // Admin güncelleme
          const params = new URLSearchParams(queryString);
          const deviceFilter = params.get('device_id');
          if (deviceFilter && deviceFilter.startsWith('eq.')) {
            await updateBinding(deviceFilter.slice(3), opts.body);
            if (opts.prefer === 'return=representation') {
              return [await getBinding(deviceFilter.slice(3))];
            }
            return [];
          }
        }
        
        const snap = await query.get();
        return snap.docs.map(d => d.data());
      }
      
      throw toError({ code: 'not_found', message: 'Unknown collection: ' + collection });
    },

    isSetupMissing: function (e) { 
      return !!(e && (e.code === 'permission-denied' || e.code === 'not_found')); 
    }
  };

  // Auth state listener - oturum değişikliklerini dinle
  function initAuthListener() {
    ensureFirebase();
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        const token = await user.getIdToken();
        saveSession(user, token);
      } else {
        const stored = store(true);
        if (stored) save(null);
      }
      // App.Auth.reload() tetikleyecek
      if (App.Auth && typeof App.Auth._onAuthChange === 'function') {
        App.Auth._onAuthChange();
      }
    });
  }

  // İlk yüklemede dinleyiciyi başlat
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuthListener);
  } else {
    initAuthListener();
  }

})();