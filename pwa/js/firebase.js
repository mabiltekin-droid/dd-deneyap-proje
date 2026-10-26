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

      /* --- App Check (isteğe bağlı, önerilir) ----------------------------
         Tarayıcıya gömülen Firebase yapılandırması herkese açıktır. App Check
         olmadan biri kendi betiğini yazıp panel dışından Firestore'a istek
         atabilir (kurallar yazmayı engeller ama okuma/kota/aktivasyon kodu
         deneme yüzeyi açık kalır). Site anahtarı tanımlıysa her isteğe
         reCAPTCHA v3 kanıtı eklenir. Konsolda "Enforce" açılana kadar istek
         engellenmez; bu yüzden güvenle kademeli açılabilir.
         Anahtar boşsa hiçbir şey değişmez. Kurulum: FIREBASE.md §8 */
      if (App.APP_CHECK_KEY && typeof firebase.appCheck === 'function') {
        try {
          const yerel = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
          if (yerel && App.APP_CHECK_DEBUG !== false) {
            /* Geliştirmede hata ayıklama jetonu üretilir ve konsola yazılır;
               bir kez App Check > Uygulamalar > hata ayıklama jetonlarına
               eklenmesi gerekir (yoksa yerelde istekler reddedilir). */
            self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
          }
          firebase.appCheck().activate(App.APP_CHECK_KEY, true);
        } catch (e) {
          console.warn('[fb] App Check başlatılamadı:', e);
        }
      }

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
            emailVerified: !!user.emailVerified,
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

  /* ------------------------------------------------------------------
     OTURUM TAZELIGI (adim yukseltme / step-up)
     Firestore kurallari kritik yazmalarda ID token'in "auth_time" claim'ini
     denetler (son kimlik dogrulama zamani). Istemci ayni degeri okuyarak
     kullaniciya ONCEDEN "tekrar dogrulama gerekiyor" diyebilir.
     ------------------------------------------------------------------ */

  function tokenAuthTime(idToken) {
    try {
      const parts = String(idToken || '').split('.');
      if (parts.length < 2) return 0;
      let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const payload = JSON.parse(atob(b64));
      return (payload && typeof payload.auth_time === 'number') ? payload.auth_time * 1000 : 0;
    } catch (e) { return 0; }
  }

  /* Token'i zorla yenile (claim'ler guncellenir; auth_time DEGISMEZ —
     gercek adim yukseltme icin reauthenticate gerekir). */
  async function refreshToken() {
    ensureFirebase();
    const user = auth.currentUser;
    if (!user) return null;
    try {
      await user.reload();
    } catch (e) { /* yoksay */ }
    const token = await user.getIdToken(true);
    return saveSession(user, token);
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
        displayName: firebaseUser.displayName || null,
        emailVerified: !!firebaseUser.emailVerified,
        created_at: firebaseUser.metadata.creationTime
      }
    };
    save(sess);
    return sess;
  }

  /* Sunucudaki guncel kullanici kaydini cek. E-posta dogrulamasi (emailVerified)
     yalnizca reload() sonrasi tazelenir; bu yuzden rozet icin bu fonksiyon
     kullanilir. Kayitli oturumu da gunceller. */
  async function refreshUser() {
    ensureFirebase();
    const user = auth.currentUser;
    if (!user) return null;
    await user.reload();
    const s = store(true);
    if (s && s.user && s.user.id === user.uid) {
      s.user.emailVerified = !!user.emailVerified;
      s.user.email = user.email || s.user.email;
      save(s);
    }
    return {
      id: user.uid,
      email: user.email,
      displayName: user.displayName || null,
      emailVerified: !!user.emailVerified
    };
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
  const COL_PUSH = 'push_subs';
  const COL_FCM = 'push_tokens';
  const COL_EMERGENCY = 'emergency_contacts';

  function profilesRef() { return db.collection(COL_PROFILES); }
  function bindingsRef() { return db.collection(COL_BINDINGS); }
  function codesRef() { return db.collection(COL_CODES); }
  function unlocksRef() { return db.collection(COL_UNLOCKS); }
  function logsRef() { return db.collection(COL_LOGS); }
  function invitesRef() { return db.collection(COL_INVITES); }
  function auditRef() { return db.collection(COL_AUDIT); }
  function eventsRef() { return db.collection(COL_EVENTS); }
  function pushRef() { return db.collection(COL_PUSH); }
  function fcmRef() { return db.collection(COL_FCM); }
  function emergencyRef() { return db.collection(COL_EMERGENCY); }

  /* Push abonelik kimliği: uid + uç nokta özeti. Böylece aynı hesabın birden
     fazla cihazı/tarayıcısı ayrı kayıt olur ve tekrar abone olmak aynı kaydı
     günceller. Firestore kimliklerinde '/' bulunamaz; uç nokta özetlenir. */
  function pushDocId(uid, endpoint) {
    let h = 5381;
    const s = String(endpoint || '');
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
    return uid + '__' + h.toString(36);
  }

  async function savePushSubscription(uid, sub) {
    if (!uid || !sub || !sub.endpoint) {
      const e = new Error('Abonelik bilgisi eksik.');
      e.code = 'invalid'; e.human = e.message;
      throw e;
    }
    const ref = pushRef().doc(pushDocId(uid, sub.endpoint));
    await ref.set({
      id: ref.id,
      uid: uid,
      endpoint: sub.endpoint,
      keys: sub.keys || {},
      ua: (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
      lang: (typeof navigator !== 'undefined' ? navigator.language : ''),
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      created_at: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return ref.id;
  }

  async function deletePushSubscription(uid) {
    if (!uid) return false;
    /* Özel anahtar yalnızca bu tarayıcıda olduğundan uç noktayı oradan alıp
       ilgili kaydı sileriz; bulunamazsa hesabın tüm kayıtları taranmaz
       (kurallar listeyi yalnızca sahibine açar). */
    let endpoint = '';
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      endpoint = sub ? sub.endpoint : '';
    } catch (e) { /* yoksay */ }
    if (!endpoint) return false;
    await pushRef().doc(pushDocId(uid, endpoint)).delete();
    return true;
  }

  /* --- FCM token'ları (Android uygulaması) --------------------------------
     Web Push aboneliğinden ayrı koleksiyon: token'lar cihaz başına değişir ve
     sunucu tarafında Firebase Admin ile gönderilir (bkz. api/_lib.js). */
  async function saveFcmToken(uid, token, meta) {
    if (!uid || !token) {
      const e = new Error('FCM token bilgisi eksik.');
      e.code = 'invalid'; e.human = e.message;
      throw e;
    }
    const ref = fcmRef().doc(pushDocId(uid, 'fcm:' + token));
    const data = {
      id: ref.id,
      uid: uid,
      token: token,
      platform: (meta && meta.platform) || 'android',
      app_version: (meta && meta.app_version) || '',
      ua: (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };
    await ref.set(data, { merge: true });
    return ref.id;
  }

  async function deleteFcmToken(uid, token) {
    if (!uid || !token) return false;
    try {
      await fcmRef().doc(pushDocId(uid, 'fcm:' + token)).delete();
      return true;
    } catch (e) {
      return false;
    }
  }

  /* --- Acil durum e-posta kişileri ---------------------------------------
     Kişiler hesaba bağlıdır; sunucu alarm anında bu listeye e-posta atar.
     E-posta adresi istemcide yalnızca sahibine gösterilir (Firestore kuralı). */
  function cleanEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function validEmail(value) {
    const email = cleanEmail(value);
    return email.length >= 5 && email.length <= 254
      && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  }

  async function listEmergencyContacts(uid) {
    if (!uid) return [];
    const snap = await emergencyRef().where('uid', '==', uid).limit(20).get();
    const list = snap.docs.map(function (d) {
      return Object.assign({ id: d.id }, d.data());
    });
    list.sort(function (a, b) {
      return String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''), 'tr');
    });
    return list;
  }

  async function saveEmergencyContact(uid, contact) {
    if (!uid) {
      const e = new Error('Oturum gerekli.');
      e.code = 'auth'; e.human = e.message;
      throw e;
    }
    const email = cleanEmail(contact && contact.email);
    if (!validEmail(email)) {
      const e = new Error('Geçerli bir e-posta adresi girin.');
      e.code = 'invalid'; e.human = e.message;
      throw e;
    }
    const name = String((contact && contact.name) || '').trim().slice(0, 60)
      || email.split('@')[0];

    const hasId = !!(contact && contact.id);
    const ref = hasId ? emergencyRef().doc(String(contact.id)) : emergencyRef().doc();

    if (hasId) {
      const cur = await ref.get();
      if (!cur.exists || (cur.data() || {}).uid !== uid) {
        const e = new Error('Kişi bulunamadı.');
        e.code = 'not-found'; e.human = e.message;
        throw e;
      }
    }

    const data = {
      id: ref.id,
      uid: uid,
      name: name,
      email: email,
      enabled: !(contact && contact.enabled === false),
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!hasId) data.created_at = firebase.firestore.FieldValue.serverTimestamp();

    await ref.set(data, { merge: true });
    return data;
  }

  async function deleteEmergencyContact(uid, contactId) {
    if (!uid || !contactId) return false;
    const ref = emergencyRef().doc(String(contactId));
    const cur = await ref.get();
    if (!cur.exists) return false;
    if ((cur.data() || {}).uid !== uid) {
      const e = new Error('Bu kişiyi silme yetkiniz yok.');
      e.code = 'permission-denied'; e.human = e.message;
      throw e;
    }
    await ref.delete();
    return true;
  }

  /* Profiles collection: doc ID = user.uid */
  async function createProfile(user, role, displayName, inviteCode) {
    const ref = profilesRef().doc(user.uid);
    const data = {
      id: user.uid,
      email: user.email,
      role: role,
      display_name: displayName || user.email?.split('@')[0] || '',
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
      last_seen_at: firebase.firestore.FieldValue.serverTimestamp()
    };
    // 'admin' rolu kurallarda KANIT ister; kurallar davet dokumanini sunucu
    // tarafinda okur, bu yuzden kodu profil dokumanina yazmak zorundayiz.
    if (role === 'admin' && inviteCode) data.invite_code = inviteCode;
    await ref.set(data, { merge: true });
    return (await ref.get()).data();
  }

  // Ilk-kurulum isareti: yalnizca ILK kayit olan kullanici basarili olur
  // (kurallar dokumanin bir kez olusturulmasina izin verir).
  async function claimBootstrap(uid) {
    ensureFirebase();
    await db.collection('config').doc('bootstrap').set({
      uid: uid,
      created_at: firebase.firestore.FieldValue.serverTimestamp()
    });
    return true;
  }

  // 'admin' rolunu KANITLAYARAK almaya calisir: admin daveti varsa onu
  // kullanir, yoksa ilk-kurulum isaretini almayi dener. Basarisizsa false
  // doner ve cagiran taraf 'user' rolune duser (hesap asla rolsuz kalmaz).
  async function claimAdminRole(uid, inviteCode) {
    if (inviteCode) return true; // davet dogrulamasi kurallarda yapilir
    try { return await claimBootstrap(uid); } catch (e) { return false; }
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

  async function setBinding(deviceId, ownerId, label, boundBy, topic) {
    const data = {
      device_id: deviceId,
      owner_id: ownerId,
      label: label || '',
      status: 'active',
      bound_at: firebase.firestore.FieldValue.serverTimestamp(),
      bound_by: boundBy
    };
    /* Cihazin MQTT konusu baglama kaydina da yazilir (panel coklu cihazda
       gecis yaparken hangi konuya baglanacagini bilir). Bossa dokunulmaz. */
    if (topic) data.topic = String(topic);
    await bindingsRef().doc(deviceId).set(data, { merge: true });
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

  // Admin: tek cihazin aktivasyon kodu (yoksa null). Teshis icin kullanilir.
  async function getDeviceCode(deviceId) {
    const snap = await codesRef().doc(deviceId).get();
    return snap.exists ? snap.data() : null;
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

  async function createUserProfile(uid, email, role, displayName, inviteCode) {
    const data = {
      id: uid,
      email: (email || '').toLowerCase(),
      role: role === 'admin' ? 'admin' : 'user',
      display_name: displayName || (email || '').split('@')[0] || '',
      avatar_url: '',
      preferences: {},
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
      last_seen_at: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (data.role === 'admin' && inviteCode) data.invite_code = inviteCode;
    await profilesRef().doc(uid).set(data, { merge: true });
    return getProfile(uid);
  }

  // Oturum açan kullanıcının profili yoksa yeniden oluşturur.
  // (Kullanıcı Firestore verisini silse bile hesabı kurtarır.) İlk kullanıcı admin olur.
  // `role` verilirse (ör. davet kodu) o rol kullanılır.
  async function ensureOwnProfile(uid, email, displayName, role, inviteCode) {
    const existing = await getProfile(uid);
    if (existing) return existing;
    let desired = (role === 'admin' || role === 'user') ? role : null;
    if (!desired) {
      let isFirst = false;
      try { isFirst = (await listProfiles()).length === 0; }
      catch (e) { isFirst = false; }
      desired = isFirst ? 'admin' : 'user';
    }
    // 'admin' icin kanit sart; yoksa guvenli sekilde 'user' olarak devam et.
    if (desired === 'admin' && !(await claimAdminRole(uid, inviteCode))) desired = 'user';
    try {
      return await createUserProfile(uid, email, desired, displayName, inviteCode);
    } catch (e) {
      if (desired === 'admin') return createUserProfile(uid, email, 'user', displayName);
      throw e;
    }
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

  /* -------------------------------------------------- Sosyal Giriş -------- */
  // Google / GitHub / Apple ile oturum açma. Önce açılır pencere (popup)
  // denenir; tarayıcı engellerse tam sayfa yönlendirmeye (redirect) düşülür.
  // Yönlendirme dönüşünde onAuthStateChanged oturumu kendiliğinden kaydeder.
  // Bu sağlayıcıların hesapları e-postası doğrulanmış gelir; ek doğrulama yok.

  const SOCIAL = {
    google: {
      label: 'Google',
      make: function () {
        const p = new firebase.auth.GoogleAuthProvider();
        p.setCustomParameters({ prompt: 'select_account' });
        return p;
      }
    },
    github: {
      label: 'GitHub',
      make: function () {
        const p = new firebase.auth.GithubAuthProvider();
        p.addScope('read:user');
        p.addScope('user:email');
        return p;
      }
    },
    apple: {
      label: 'Apple',
      make: function () {
        const p = new firebase.auth.OAuthProvider('apple.com');
        p.addScope('email');
        p.addScope('name');
        return p;
      }
    }
  };

  function socialHuman(err, label) {
    const code = err && err.code;
    if (code === 'auth/operation-not-allowed')
      return label + ' ile giriş kapalı. Firebase Console > Authentication > Sign-in method > '
        + label + ' seçeneğini etkinleştirin.';
    if (code === 'auth/unauthorized-domain')
      return 'Bu alan adı yetkili değil. Console > Authentication > Settings > Authorized domains listesine ekleyin.';
    if (code === 'auth/account-exists-with-different-credential')
      return 'Bu e-posta başka bir yöntemle kayıtlı. Önce onunla giriş yapın, sonra hesabınıza '
        + label + ' bağlayın.';
    if (code === 'auth/credential-already-in-use')
      return 'Bu ' + label + ' hesabı başka bir kullanıcıya bağlı.';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request')
      return label + ' girişi iptal edildi.';
    return human(err);
  }

  async function signInWithProvider(name) {
    ensureFirebase();
    const def = SOCIAL[name];
    if (!def) {
      const e = new Error('Bilinmeyen sağlayıcı: ' + name);
      e.code = 'auth/unknown-provider';
      e.human = 'Bilinmeyen giriş yöntemi.';
      throw e;
    }
    const provider = def.make();

    let cred = null;
    try {
      cred = await auth.signInWithPopup(provider);
    } catch (e) {
      const code = e && e.code;
      if (code === 'auth/popup-blocked' ||
          code === 'auth/operation-not-supported-in-this-environment') {
        // Açılır pencere engellendi/desteklenmiyor → tam sayfa yönlendirme.
        await auth.signInWithRedirect(provider);
        return { redirect: true };
      }
      const err = new Error((e && e.message) || def.label + ' girişi başarısız.');
      err.code = code || 'unknown';
      err.human = socialHuman(e, def.label);
      throw err;
    }

    const user = cred.user;
    // GitHub bazı hesaplarda e-posta paylaşmaz; profil için e-posta şart.
    if (!user.email) {
      try { await auth.signOut(); } catch (e) { /* yoksay */ }
      const e = new Error('E-posta alınamadı.');
      e.code = 'auth/no-email';
      e.human = name === 'github'
        ? 'GitHub hesabınızdan e-posta alınamadı. GitHub → Settings → Emails bölümünde '
          + 'e-postanızı doğrulayıp "Keep my email addresses private" seçeneğini kapatın.'
        : def.label + ' hesabınızdan e-posta alınamadı; başka bir hesapla deneyin.';
      throw e;
    }

    const token = await user.getIdToken();
    return saveSession(user, token);
  }

  function signInWithGoogle() { return signInWithProvider('google'); }
  function signInWithGithub() { return signInWithProvider('github'); }
  function signInWithApple() { return signInWithProvider('apple'); }

  /* -------------------------------------------------- Dışa Açık API ---------- */

  App.FB = {
    conf: getFirebaseConfig,
    human: human,
    hasConfig: function () { return !!getFirebaseConfig(); },

    /* --- Push abonelikleri (arka plan bildirimi) --- */
    savePushSubscription: savePushSubscription,
    deletePushSubscription: deletePushSubscription,

    /* --- FCM token'ları (Android uygulaması) --- */
    saveFcmToken: saveFcmToken,
    deleteFcmToken: deleteFcmToken,

    /* --- Acil durum e-posta kişileri --- */
    listEmergencyContacts: listEmergencyContacts,
    saveEmergencyContact: saveEmergencyContact,
    deleteEmergencyContact: deleteEmergencyContact,

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

    signInWithProvider: signInWithProvider,
    signInWithGoogle: signInWithGoogle,
    signInWithGithub: signInWithGithub,
    signInWithApple: signInWithApple,

    signUp: async function (email, password, data) {
      ensureFirebase();
      const cred = await auth.createUserWithEmailAndPassword(email.trim(), password);

      // İlk kullanıcı mı? (profil oluşturulmadan önce) — hata olursa 'user' varsay
      let isFirst = false;
      try { isFirst = (await listProfiles()).length === 0; }
      catch (e) { isFirst = false; }
      const inviteCode = (data && data.invite_code) || null;
      const desired = data && (data.role === 'admin' || data.role === 'user') ? data.role : null;
      let role = desired || (isFirst ? 'admin' : 'user');

      // GÜVENLİK: 'admin' rolü için kurallar kanıt ister (admin daveti veya
      // ilk-kurulum işareti). Kanıt yoksa güvenli biçimde 'user' olarak devam
      // edilir; hesap asla rolsüz kalmaz.
      if (role === 'admin' && !(await claimAdminRole(cred.user.uid, inviteCode))) {
        role = 'user';
      }

      // Profil oluştur (e-posta doğrulanmadan da oluşturulabilir; kurallar izin verir)
      try {
        await createProfile(cred.user, role, data && data.display_name, inviteCode);
      } catch (e) {
        if (role === 'admin') {
          // Davet/işaret sunucuda reddedildi → normal kullanıcı olarak devam et
          await createProfile(cred.user, 'user', data && data.display_name);
        } else {
          throw toError(e);
        }
      }

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
    refreshUser: refreshUser,
    refreshToken: refreshToken,
    tokenAuthTime: tokenAuthTime,
    reauth: reauth,

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

    bindDevice: async function (deviceId, ownerId, label, boundBy, topic) {
      ensureFirebase();
      try { await setBinding(deviceId, ownerId, label, boundBy, topic); return await getBinding(deviceId); }
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
    reassignBinding: async function (deviceId, ownerId, byUid, topic) {
      ensureFirebase();
      try {
        const patch = {
          owner_id: ownerId,
          status: 'active',
          bound_by: byUid || null,
          bound_at: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (topic) patch.topic = String(topic);
        await updateBinding(deviceId, patch);
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

    getDeviceCode: async function (deviceId) {
      ensureFirebase();
      try { return await getDeviceCode(deviceId); } catch (e) { throw toError(e); }
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

    createUserProfile: async function (uid, email, role, displayName, inviteCode) {
      ensureFirebase();
      return createUserProfile(uid, email, role, displayName, inviteCode);
    },

    ensureOwnProfile: async function (uid, email, displayName, role, inviteCode) {
      ensureFirebase();
      return ensureOwnProfile(uid, email, displayName, role, inviteCode);
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