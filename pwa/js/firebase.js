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
        // E-posta doğrulanmış mı kontrol et
        if (!user.emailVerified) {
          // Kullanıcı doğrulama yapmış olabilir, token'ı yenileyip tekrar kontrol et
          await user.reload();
          if (!user.emailVerified) {
            await auth.signOut();
            save(null);
            return null;
          }
        }
        const token = await user.getIdToken(true);
        const sess = {
          access_token: token,
          refresh_token: s.refresh_token,
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
  const COL_CODES = 'device_codes';
  const COL_UNLOCKS = 'device_unlocks';
  const COL_LOGS = 'login_logs';
  const COL_INVITES = 'invites';
  const COL_AUDIT = 'audit_logs';
  const COL_EVENTS = 'alarm_events';

  function profilesRef() { return db.collection(COL_PROFILES); }
  function bindingsRef() { return db.collection(COL_BINDINGS); }
  function codesRef() { return db.collection(COL_CODES); }
  function unlocksRef() { return db.collection(COL_UNLOCKS); }
  function logsRef() { return db.collection(COL_LOGS); }
  function invitesRef() { return db.collection(COL_INVITES); }
  function auditRef() { return db.collection(COL_AUDIT); }
  function eventsRef() { return db.collection(COL_EVENTS); }

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
      status: 'active',
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

  // Kullanicinin YALNIZCA kendi cihaz baglantilari (kural: owner_id == uid).
  async function listOwnBindings(uid) {
    const snap = await bindingsRef().where('owner_id', '==', uid).get();
    return snap.docs.map(d => d.data());
  }

  // Baglantiyi kesme talebi (sahibi) -> admin onayina duser.
  async function requestRelease(deviceId, byUid) {
    await bindingsRef().doc(deviceId).update({
      status: 'release_pending',
      released_by: byUid || null,
      released_at: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  // Talebi geri al / reddet -> baglanti yeniden aktif.
  async function cancelRelease(deviceId) {
    await bindingsRef().doc(deviceId).update({
      status: 'active',
      released_by: null,
      released_at: null
    });
  }

  /* ------------------------------------------- Cihaz aktivasyon kodu ------- */

  // Admin: tanimli tum aktivasyon kodlari. (Kural: yalnizca admin okur.)
  async function listDeviceCodes() {
    const snap = await codesRef().get();
    return snap.docs.map(d => d.data());
  }

  // Admin: bir cihaz icin aktivasyon kodu tanimla/guncelle.
  async function setDeviceCode(deviceId, code, label, byUid) {
    await codesRef().doc(deviceId).set({
      device_id: deviceId,
      code: String(code || ''),
      label: label || '',
      active: true,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_by: byUid || null
    }, { merge: true });
    return (await codesRef().doc(deviceId).get()).data();
  }

  async function deleteDeviceCode(deviceId) {
    await codesRef().doc(deviceId).delete();
  }

  // Kullanici: girdigi kodu gecici olarak yaz → kural dogrular.
  // Kod bu dokumanda tutulur ama OKUMA kurali kapalidir; yalnizca
  // device_bindings.create kurali sunucu tarafinda okuyabilir.
  async function unlockDevice(deviceId, code, uid) {
    await unlocksRef().doc(deviceId).set({
      device_id: deviceId,
      uid: uid,
      code: String(code || ''),
      at: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  async function clearUnlock(deviceId) {
    try { await unlocksRef().doc(deviceId).delete(); } catch (e) { /* yoksay */ }
  }

  /* -------------------------------------------------- Giriş logları ---------- */

  async function addLoginLog(log) {
    const ref = await logsRef().add({
      userId: (log && log.userId) || null,
      email: (log && log.email) || null,
      success: !!(log && log.success),
      action: (log && log.action) || 'login',
      userAgent: String((log && log.userAgent) || navigator.userAgent || '').slice(0, 300),
      error: (log && log.error) || null,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    return ref.id;
  }

  async function getLoginLogs(uid, limit) {
    const snap = await logsRef()
      .where('userId', '==', uid)
      .orderBy('timestamp', 'desc')
      .limit(limit || 20)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  /* -------------------------------------------------- Denetim (audit) -------- */

  async function addAuditLog(action, target, detail) {
    try {
      const me = auth && auth.currentUser;
      await auditRef().add({
        action: action || 'unknown',
        target: target || null,
        detail: detail || null,
        actor: me ? me.uid : null,
        actor_email: me ? me.email : null,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.warn('[fb] audit log yazılamadı:', e && e.message);
    }
  }

  async function listAuditLogs(limit) {
    const snap = await auditRef().orderBy('timestamp', 'desc').limit(limit || 30).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  /* -------------------------------------------------- Olay günlüğü ---------- */
  /* alarm_events: sensör/alarm olaylarının kalıcı kaydı. Kullanıcı yalnızca
     kendi olaylarını yazar/okur; admin tümünü görür. */

  async function addAlarmEvent(ev) {
    ev = ev || {};
    const ref = await eventsRef().add({
      owner_id: ev.owner_id || null,
      dev: ev.dev || '',
      type: ev.type || 'system',
      severity: ev.severity || 'info',
      message: String(ev.message || '').slice(0, 400),
      at: Number(ev.at) || Date.now(),
      local_id: ev.local_id || null,
      created_at: firebase.firestore.FieldValue.serverTimestamp()
    });
    return ref.id;
  }

  async function listAlarmEvents(ownerId, limit) {
    const snap = await eventsRef()
      .where('owner_id', '==', ownerId)
      .orderBy('at', 'desc')
      .limit(limit || 200)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function listAllAlarmEvents(limit) {
    const snap = await eventsRef().orderBy('at', 'desc').limit(limit || 300).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function deleteAlarmEvent(id) {
    if (!id) return;
    await eventsRef().doc(id).delete();
  }

  async function clearAllAlarmEvents() {
    // Admin temizliği: toplu silme (batch) ile sayfalarca kayıt.
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const snap = await eventsRef().orderBy('at', 'desc').limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach(function (d) { batch.delete(d.ref); });
      await batch.commit();
      total += snap.docs.length;
      if (snap.docs.length < 400) break;
    }
    return total;
  }

  /* -------------------------------------------------- Davetler --------------- */

  function randomInviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 10; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return c;
  }

  async function createInvite(email, role, createdBy) {
    const code = randomInviteCode();
    const now = Date.now();
    const expiresMs = now + 7 * 24 * 60 * 60 * 1000; // 7 gün
    const data = {
      code: code,
      email: (email || '').toLowerCase(),
      role: role === 'admin' ? 'admin' : 'user',
      created_by: createdBy || null,
      used: false,
      used_by: null,
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
      created_at_ms: now,
      expires_at_ms: expiresMs
    };
    await invitesRef().doc(code).set(data);
    return {
      code: code,
      email: data.email,
      role: data.role,
      created_by: data.created_by,
      used: false,
      used_by: null,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(expiresMs).toISOString()
    };
  }

  async function listInvites() {
    const snap = await invitesRef().orderBy('created_at_ms', 'desc').limit(50).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function verifyInvite(code) {
    if (!code) return null;
    const snap = await invitesRef().doc(code).get();
    if (!snap.exists) return null;
    const inv = snap.data();
    if (inv.used) return null;
    if (inv.expires_at_ms && Date.now() > inv.expires_at_ms) return null;
    return inv;
  }

  async function consumeInvite(code, uid) {
    if (!code) return false;
    await invitesRef().doc(code).update({
      used: true,
      used_by: uid || null,
      used_at: firebase.firestore.FieldValue.serverTimestamp(),
      used_at_ms: Date.now()
    });
    return true;
  }

  async function revokeInvite(code) {
    if (!code) return false;
    await invitesRef().doc(code).delete();
    return true;
  }

  /* -------------------------------------------------- Profil / hesap --------- */

  async function createUserProfile(uid, email, role, displayName) {
    await profilesRef().doc(uid).set({
      id: uid,
      email: (email || '').toLowerCase(),
      role: role === 'admin' ? 'admin' : 'user',
      display_name: displayName || (email || '').split('@')[0] || '',
      avatar_url: '',
      preferences: {},
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
      last_seen_at: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return getProfile(uid);
  }

  // Oturum açan kullanıcının profili yoksa yeniden oluşturur.
  // (Kullanıcı Firestore verisini silse bile hesabı kurtarır.) İlk kullanıcı admin olur.
  async function ensureOwnProfile(uid, email, displayName) {
    const existing = await getProfile(uid);
    if (existing) return existing;
    let isFirst = false;
    try { isFirst = (await listProfiles()).length === 0; }
    catch (e) { isFirst = false; }
    return createUserProfile(uid, email, isFirst ? 'admin' : 'user', displayName);
  }

  // Admin tarafından kullanıcı oluşturma — İKİNCİL app ile, admin oturumu korunur.
  async function adminCreateUser(email, password, role, displayName) {
    ensureFirebase();
    const cfg = getFirebaseConfig();
    const name = 'dd-admin-create-' + Date.now();
    const secondary = firebase.initializeApp(cfg, name);
    try {
      const secAuth = secondary.auth();
      const cred = await secAuth.createUserWithEmailAndPassword(email.trim(), password);
      const uid = cred.user.uid;
      if (displayName) {
        try { await cred.user.updateProfile({ displayName: displayName }); } catch (e) { /* yoksay */ }
      }
      try { await cred.user.sendEmailVerification(); } catch (e) { /* yoksay */ }
      await secAuth.signOut();
      // Profil dokümanı admin yetkisiyle (kurallar isAdmin'e izin verir)
      await createUserProfile(uid, email.trim(), role, displayName);
      return { pending: true, user: { id: uid, email: email.trim() }, role: role === 'admin' ? 'admin' : 'user' };
    } catch (e) {
      throw toError(e);
    } finally {
      try { await secondary.delete(); } catch (e) { /* yoksay */ }
    }
  }

  async function reauth(currentPassword) {
    const user = auth.currentUser;
    if (!user) {
      const e = new Error('Oturum bulunamadı.');
      e.code = 'auth/no-user'; e.human = 'Oturum bulunamadı. Yeniden giriş yapın.';
      throw e;
    }
    if (currentPassword) {
      const cred = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
      await user.reauthenticateWithCredential(cred);
    }
    return user;
  }

  async function updatePassword(currentPassword, newPassword) {
    ensureFirebase();
    const user = await reauth(currentPassword);
    try {
      await user.updatePassword(newPassword);
    } catch (e) { throw toError(e); }
    return true;
  }

  async function updateEmail(currentPassword, newEmail) {
    ensureFirebase();
    const user = await reauth(currentPassword);
    try {
      await user.updateEmail(newEmail.trim());
      try { await user.sendEmailVerification(); } catch (e) { /* yoksay */ }
    } catch (e) { throw toError(e); }
    return true;
  }

  async function sendPasswordResetEmail(email) {
    ensureFirebase();
    try {
      await auth.sendPasswordResetEmail(email.trim());
    } catch (e) { throw toError(e); }
    return true;
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
      
      // E-posta doğrulanmış mı?
      if (!cred.user.emailVerified) {
        await auth.signOut();
        const e = new Error('E-posta doğrulanmamış. Gelen kutunuzdaki bağlantıyı onaylayın.');
        e.code = 'auth/email-not-verified';
        throw toError(e);
      }
      
      const token = await cred.user.getIdToken();
      return saveSession(cred.user, token);
    },

    signUp: async function (email, password, data) {
      ensureFirebase();
      const cred = await auth.createUserWithEmailAndPassword(email.trim(), password);

      // İlk kullanıcı mı? (profil oluşturulmadan önce) — hata olursa 'user' varsay
      let isFirst = false;
      try { isFirst = (await listProfiles()).length === 0; }
      catch (e) { isFirst = false; }
      const desired = data && (data.role === 'admin' || data.role === 'user') ? data.role : null;
      const role = desired || (isFirst ? 'admin' : 'user');

      // Profil oluştur (e-posta doğrulanmadan da oluşturulabilir; kurallar izin verir)
      await createProfile(cred.user, role, data && data.display_name);

      // Davet kodunu, yeni kullanıcı oturumdayken tüket (kurallar used_by == uid ister)
      if (data && data.invite_code) {
        try { await consumeInvite(data.invite_code, cred.user.uid); } catch (e) { /* yoksay */ }
      }

      // Doğrulama e-postası gönder
      await cred.user.sendEmailVerification();

      // Oturumu kapat — kullanıcı doğrulama sonrası giriş yapacak
      await auth.signOut();

      return { pending: true, user: { id: cred.user.uid, email: cred.user.email } };
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
        // permission-denied → Firestore VAR ve kurallar çalışıyor; yalnızca bu
        // istek için yetki yok (ör. oturum kapalı). Kurulum sorunu değildir.
        if (e.code === 'permission-denied') return true;
        // Ağ / veritabanı erişilemez → kurulum eksik kabul et.
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
      // Yalnızca gerçek kurulum/erişim sorunları: veritabanı yok veya erişilemez.
      // permission-denied yetki sorunudur (kurulum değil) → sayılmaz.
      return !!(e && (e.code === 'not_found' || e.code === 'unavailable' || e.code === 'failed-precondition'));
    },

    /* ---------------------------------------------- Cihaz mülkiyeti ------ */

    listBindings: async function () {
      ensureFirebase();
      try { return await listBindings(); } catch (e) { throw toError(e); }
    },

    listOwnBindings: async function (uid) {
      ensureFirebase();
      try { return await listOwnBindings(uid); } catch (e) { throw toError(e); }
    },

    getBinding: async function (deviceId) {
      ensureFirebase();
      try { return await getBinding(deviceId); } catch (e) { throw toError(e); }
    },

    bindDevice: async function (deviceId, ownerId, label, boundBy) {
      ensureFirebase();
      try { await setBinding(deviceId, ownerId, label, boundBy); return await getBinding(deviceId); }
      catch (e) { throw toError(e); }
    },

    requestRelease: async function (deviceId, byUid) {
      ensureFirebase();
      try { return await requestRelease(deviceId, byUid); } catch (e) { throw toError(e); }
    },

    cancelRelease: async function (deviceId) {
      ensureFirebase();
      try { return await cancelRelease(deviceId); } catch (e) { throw toError(e); }
    },

    // Onay = cihazi serbest birak (dokumani sil) → yeni hesap baglanabilir.
    approveRelease: async function (deviceId) {
      ensureFirebase();
      try { return await deleteBinding(deviceId); } catch (e) { throw toError(e); }
    },

    // Admin: cihazi belirli bir hesaba ata (hesap degistirme).
    reassignBinding: async function (deviceId, ownerId, byUid) {
      ensureFirebase();
      try {
        await updateBinding(deviceId, {
          owner_id: ownerId,
          status: 'active',
          bound_by: byUid || null,
          bound_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        return await getBinding(deviceId);
      } catch (e) { throw toError(e); }
    },

    /* ------------------------------------------- Aktivasyon kodlari ------ */

    listDeviceCodes: async function () {
      ensureFirebase();
      try { return await listDeviceCodes(); } catch (e) { throw toError(e); }
    },

    setDeviceCode: async function (deviceId, code, label, byUid) {
      ensureFirebase();
      try { return await setDeviceCode(deviceId, code, label, byUid); } catch (e) { throw toError(e); }
    },

    deleteDeviceCode: async function (deviceId) {
      ensureFirebase();
      try { await deleteDeviceCode(deviceId); } catch (e) { throw toError(e); }
    },

    unlockDevice: async function (deviceId, code, uid) {
      ensureFirebase();
      try { await unlockDevice(deviceId, code, uid); } catch (e) { throw toError(e); }
    },

    clearUnlock: async function (deviceId) {
      ensureFirebase();
      try { await clearUnlock(deviceId); } catch (e) { /* yoksay */ }
    },

    /* ---------------------------------------------- Profil / hesap --------- */

    updateProfile: async function (uid, data) {
      ensureFirebase();
      try { return await updateProfile(uid, data); }
      catch (e) { throw toError(e); }
    },

    createUserProfile: async function (uid, email, role, displayName) {
      ensureFirebase();
      return createUserProfile(uid, email, role, displayName);
    },

    ensureOwnProfile: async function (uid, email, displayName) {
      ensureFirebase();
      return ensureOwnProfile(uid, email, displayName);
    },

    adminCreateUser: adminCreateUser,

    updatePassword: updatePassword,
    updateEmail: updateEmail,
    sendPasswordResetEmail: sendPasswordResetEmail,

    /* ---------------------------------------------- Giriş logları ---------- */

    addLoginLog: async function (log) {
      ensureFirebase();
      try { return await addLoginLog(log); }
      catch (e) { return null; }
    },

    getLoginLogs: async function (uid, limit) {
      ensureFirebase();
      try { return await getLoginLogs(uid, limit); }
      catch (e) { throw toError(e); }
    },

    /* ---------------------------------------------- Denetim --------------- */

    addAuditLog: addAuditLog,

    listAuditLogs: async function (limit) {
      ensureFirebase();
      try { return await listAuditLogs(limit); }
      catch (e) { throw toError(e); }
    },

    /* ---------------------------------------------- Olay günlüğü ---------- */

    addAlarmEvent: async function (ev) {
      ensureFirebase();
      return addAlarmEvent(ev);
    },

    listAlarmEvents: async function (ownerId, limit) {
      ensureFirebase();
      try { return await listAlarmEvents(ownerId, limit); }
      catch (e) { throw toError(e); }
    },

    listAllAlarmEvents: async function (limit) {
      ensureFirebase();
      try { return await listAllAlarmEvents(limit); }
      catch (e) { throw toError(e); }
    },

    deleteAlarmEvent: async function (id) {
      ensureFirebase();
      try { await deleteAlarmEvent(id); return true; }
      catch (e) { throw toError(e); }
    },

    clearAllAlarmEvents: async function () {
      ensureFirebase();
      try { return await clearAllAlarmEvents(); }
      catch (e) { throw toError(e); }
    },

    /* ---------------------------------------------- Davetler -------------- */

    createInvite: async function (email, role, createdBy) {
      ensureFirebase();
      try { return await createInvite(email, role, createdBy); }
      catch (e) { throw toError(e); }
    },

    listInvites: async function () {
      ensureFirebase();
      try { return await listInvites(); }
      catch (e) { throw toError(e); }
    },

    verifyInvite: async function (code) {
      ensureFirebase();
      try { return await verifyInvite(code); }
      catch (e) { return null; }
    },

    consumeInvite: async function (code, uid) {
      ensureFirebase();
      try { return await consumeInvite(code, uid); }
      catch (e) { return false; }
    },

    revokeInvite: async function (code) {
      ensureFirebase();
      try { return await revokeInvite(code); }
      catch (e) { throw toError(e); }
    },

    // Doğrulama e-postasını yeniden gönder.
    //  • Oturum varsa: mevcut kullanıcıya gönderir.
    //  • Oturum yoksa (doğrulanmamış kullanıcı giriş yapamadığı ve oturumu
    //    kapatıldığı için): e-posta + şifre ile GEÇİCİ giriş yapıp gönderir,
    //    ardından oturumu kapatır. Böylece "doğrulanmamış" kilitlenmesi çözülür.
    resendVerificationEmail: async function (email, password) {
      ensureFirebase();
      let user = auth.currentUser;
      let tempSignIn = false;

      if (!user) {
        if (!email || !password) {
          const e = new Error('Oturum bulunamadı. E-posta ve şifrenizi girin.');
          e.code = 'auth/no-user';
          e.human = 'Doğrulama e-postası göndermek için e-posta ve şifrenizi girin.';
          throw e;
        }
        try {
          const cred = await auth.signInWithEmailAndPassword(String(email).trim(), password);
          user = cred.user;
          tempSignIn = true;
        } catch (err) {
          throw toError(err);
        }
      }

      try {
        if (user.emailVerified) {
          if (tempSignIn) { try { await auth.signOut(); } catch (x) { /* yoksay */ } }
          return { emailVerified: true };
        }
        await user.sendEmailVerification();
      } catch (err) {
        if (tempSignIn) { try { await auth.signOut(); } catch (x) { /* yoksay */ } }
        throw toError(err);
      }

      if (tempSignIn) { try { await auth.signOut(); } catch (x) { /* yoksay */ } }
      return { emailVerified: false };
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