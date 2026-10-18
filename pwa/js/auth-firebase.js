/* ==========================================================================
   auth-firebase.js — Hesap, rol ve cihaz mülkiyeti (Firebase)

   App.Auth: Uygulamanın tamamının kullandığı YÜKSEK SEVİYE hesap servisi.
   Düşük seviye Firebase erişimi App.FB (firebase.js) üzerinden yapılır.

   Katmanlar:
     • App.FB   → Firebase Auth + Firestore ham işlemler (firebase.js)
     • App.Auth → durum makinesi + rol + cihaz mülkiyeti (bu dosya)
     • UI       → account.js, profile-ui.js, admin-invite-ui.js

   Not: App.Auth zarftan (snapshot) beslenen bir dinleyici listesi tutar;
   UI katmanları App.Auth.onChange(fn) ile abone olur.
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});
  const FB = () => App.FB;

  const state = {
    ready: false,
    session: null,
    profile: null,
    bindings: null,
    deviceAccess: {},   // deviceId -> 'free' | 'granted' | 'denied' | 'anon'
    deviceInfo: null,   // son checkDevice sonucu
    setupRequired: false,
    error: null
  };

  const listeners = [];

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(App.Auth.snapshot()); } catch (e) { console.warn('[auth] dinleyici hatası', e); }
    });
  }

  function err(message, human) {
    const e = new Error(message);
    e.human = human || message;
    return e;
  }

  function isPermDenied(e) {
    return !!(e && (e.code === 'permission-denied' || /permission/i.test(e.message || '')));
  }

  function millis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    if (typeof ts === 'number') return ts;
    const d = Date.parse(ts);
    return isNaN(d) ? 0 : d;
  }

  // Cihaz bağlanamıyorken kullanıcıya gösterilecek açıklama.
  function bindingBlockedText(st) {
    switch (st && st.state) {
      case 'mine': return 'Bu cihaz zaten sizin hesabınıza bağlı.';
      case 'mine_pending': return 'Bu cihazın bağlantısı kesildi; admin onayı bekleniyor.';
      case 'other': return 'Bu cihaz başka bir hesaba bağlı. Yalnızca sahibi veya admin işlem yapabilir.';
      case 'pending_other': return 'Bu cihaz başka bir hesaba bağlı ve bağlantı kesme talebi admin onayında.';
      case 'hidden': return 'Bu cihaz başka bir hesaba bağlı. Bağlı cihazları yalnızca sahibi veya admin görebilir.';
      default: return 'Bu cihaz şu anda bağlanamaz.';
    }
  }

  /* Bağlama başarısız olduğunda KESİN nedeni söyle.
     Kod doğrulaması Firestore kurallarında SUNUCU tarafında yapılır; bu yüzden
     istemci "kod yanlış" ile "kod tanımlı değil"i normalde ayırt EDEMEZ.
     Admin kodu okuyabildiği için kesin nedeni söyleyebiliriz. */
  async function activationHelp(deviceId, code) {
    if (App.Auth.isAdmin && App.Auth.isAdmin()) {
      let doc = null;
      try { doc = await FB().getDeviceCode(deviceId); } catch (e) { doc = null; }
      if (!doc) {
        return 'Bu cihaz için aktivasyon kodu TANIMLI DEĞİL (' + deviceId + '). ' +
               'Ayarlar → Hesap & Roller → “Cihaz Aktivasyon Kodları” bölümünden ' +
               deviceId + ' kimliğiyle kod ekleyin.';
      }
      if (doc.active !== true) {
        return 'Kayıtlı kod PASİF görünüyor (active alanı true değil). ' +
               'Kodu yeniden kaydedin.';
      }
      if (typeof doc.code !== 'string') {
        return 'Kayıtlı kod METİN değil (' + (typeof doc.code) + ' olarak kaydedilmiş). ' +
               'Güvenlik kuralı metin karşılaştırdığı için kod hiçbir zaman eşleşmez. ' +
               'Kodu panelden (Ayarlar → Hesap & Roller → “Cihaz Aktivasyon Kodları”) ' +
               'yeniden kaydedin.';
      }
      if (String(doc.code) !== String(code)) {
        return 'Kod eşleşmiyor. Kayıtlı kod: “' + String(doc.code) +
               '” — girdiğiniz: “' + String(code) + '”.';
      }
      return 'Kod doğru görünüyor ama bağlama reddedildi. Firestore güvenlik ' +
             'kuralları güncel olmayabilir (npm run deploy:rules).';
    }
    return 'Kod doğrulanamadı. Olası nedenler: (1) ' + deviceId +
           ' için aktivasyon kodu henüz TANIMLI DEĞİL, (2) kod yanlış, ' +
           '(3) kod pasif. Yöneticiden ' + deviceId + ' kimliğiyle bir kod ' +
           'tanımlamasını isteyin (Ayarlar → Hesap & Roller → ' +
           '“Cihaz Aktivasyon Kodları”).';
  }

  /* Kod DOĞRU ama cihaz bağlanamadı: nedeni ayırt et.
     - Ağ hatası (unavailable/timeout) → internet
     - Cihaz bu sırada başkasına bağlanmış → admin ataması gerekir
     - Sunucu reddi (permission-denied) → kurallar/eski kural veya eksik profil */
  async function bindFailureHelp(deviceId, e) {
    const k = String((e && e.code) || '');
    if (k === 'unavailable' || k === 'deadline-exceeded' ||
        /unavailable|network|timeout|internet|fetch/i.test((e && e.message) || '')) {
      return 'Kodunuz DOĞRU, ancak bağlantı kesildiği için cihaz bağlanamadı. ' +
             'İnternet bağlantısını kontrol edip tekrar deneyin. ' +
             '(Ağ hatası: ' + (k || 'bağlantı') + ')';
    }
    let durum = null;
    try {
      const st = await App.Auth.checkDevice(deviceId);
      durum = st && st.state;
    } catch (e2) { durum = null; }
    if (durum && durum !== 'free') {
      return 'Kodunuz DOĞRU, ancak cihaz bu sırada başkası tarafından ' +
             'bağlanmış. Yöneticiden cihazı size atamasını isteyin.';
    }
    return 'Kodunuz DOĞRU, ancak cihaz bağlanamadı (sunucu reddi: ' +
           (k || 'bilinmeyen') + '). Nedenleri: Firestore güvenlik kuralları ' +
           'güncel değil ya da hesap profiliniz eksik. Sayfayı yenileyip ' +
           'tekrar deneyin; sürerse yöneticinize bildirin.';
  }

  // Oturum değişince cihaz erişim önbelleğini geçersiz kıl.
  function resetDeviceAccess() {
    state.deviceAccess = {};
    state.deviceInfo = null;
  }

  /* ------------------------------------------- kalıcı sahiplik hafızası ----
     Bir hesap bir cihazı bağladığında bu bağ, hesap oturumu kapansa bile
     tarayıcıda saklanır. Böylece kullanıcı çıkış yapsa da cihaz "onun"
     kalır (görünür + kumanda edilebilir); başka biri göremez.
     Anahtar: deviceId → { uid, email, label, at }                        */
  const OWN_KEY = 'deneyap.device_owners';

  function loadOwners() {
    try {
      const raw = localStorage.getItem(OWN_KEY);
      const m = raw ? JSON.parse(raw) : {};
      return (m && typeof m === 'object') ? m : {};
    } catch (e) { return {}; }
  }

  function saveOwners(map) {
    try { localStorage.setItem(OWN_KEY, JSON.stringify(map)); } catch (e) { /* yoksay */ }
  }

  function rememberOwner(deviceId, uid, email, label) {
    if (!deviceId || !uid) return;
    const m = loadOwners();
    m[deviceId] = { uid: uid, email: email || '', label: label || '', at: Date.now() };
    saveOwners(m);
  }

  function forgetOwner(deviceId) {
    if (!deviceId) return;
    const m = loadOwners();
    if (m[deviceId]) { delete m[deviceId]; saveOwners(m); }
  }

  function localOwner(deviceId) {
    if (!deviceId) return null;
    return loadOwners()[deviceId] || null;
  }

  /* ------------------------------------------------------- oturum ---------- */

  async function refreshProfile() {
    if (!state.session) { state.profile = null; return null; }
    try {
      const p = await FB().profile();
      if (p && p.__setupRequired) {
        // Profil dokümanı yok (ör. kullanıcı verisini sildiyse) → yeniden oluştur.
        try {
          const created = await FB().ensureOwnProfile(
            state.session.user.id,
            state.session.user.email,
            state.session.user.displayName
          );
          state.profile = created || null;
          state.setupRequired = !created;
          return state.profile;
        } catch (e2) {
          console.warn('[auth] profil oluşturulamadı', e2);
          state.setupRequired = true;
          state.profile = null;
        }
      } else {
        state.profile = p;
        state.setupRequired = false;
      }
    } catch (e) {
      console.warn('[auth] profil okunamadı', e);
      state.error = e.human || e.message;
      state.profile = null;
    }
    return state.profile;
  }

  async function init() {
    try {
      state.session = await FB().ensureSession();
    } catch (e) { state.session = null; }
    resetDeviceAccess();
    await refreshProfile();
    if (!state.session) {
      try { state.setupRequired = !(await FB().probeSetup()); }
      catch (e) { state.setupRequired = false; }
    }
    state.ready = true;
    emit();
    return App.Auth.snapshot();
  }

  /* Sosyal giriş sonrası ortak işler: davet kodu, profil sağlığı, giriş kaydı. */
  async function completeSocialLogin(sess, provider) {
    // Davet kodu (varsa): profil yoksa davet rolüyle oluştur ve kodu tüket.
    let code = null;
    try { code = localStorage.getItem('deneyap.invite'); } catch (e) { /* yoksay */ }
    if (code) {
      let invite = null;
      try { invite = await FB().verifyInvite(code); } catch (e) { invite = null; }
      if (invite) {
        try {
          const existing = await FB().profile();
          if (existing && existing.__setupRequired) {
            await FB().ensureOwnProfile(sess.user.id, sess.user.email, sess.user.displayName, invite.role, code);
          }
          await FB().consumeInvite(code, sess.user.id);
          localStorage.removeItem('deneyap.invite');
        } catch (e) { /* yoksay */ }
      }
    }

    await refreshProfile();
    state.ready = true;
    emit();
    try {
      await FB().addLoginLog({
        userId: sess.user.id, email: sess.user.email,
        success: true, action: 'login_' + provider, userAgent: navigator.userAgent
      });
    } catch (e) { /* yoksay */ }
  }

  /* --------------------------------------------------- dışa açık API ------- */

  App.Auth = {

    snapshot: function () {
      return {
        ready: state.ready,
        signedIn: !!state.session,
        user: (state.session && state.session.user) || null,
        profile: state.profile,
        role: (state.profile && state.profile.role) || null,
        isAdmin: !!(state.profile && state.profile.role === 'admin'),
        setupRequired: state.setupRequired,
        error: state.error,
        bindings: state.bindings
      };
    },

    onChange: function (fn) {
      if (typeof fn === 'function' && listeners.indexOf(fn) === -1) {
        listeners.push(fn);
      }
      return function () {
        const idx = listeners.indexOf(fn);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    },

    init: init,

    signedIn: function () { return !!state.session; },
    isAdmin: function () { return !!(state.profile && state.profile.role === 'admin'); },
    role: function () { return (state.profile && state.profile.role) || null; },

    signIn: async function (email, password) {
      state.error = null;
      const s = await FB().signIn(email, password);
      state.session = s;
      resetDeviceAccess();
      await refreshProfile();
      state.ready = true;
      emit();
      // Giriş kaydı (audit) — başarısız olursa girişi engellemez
      try {
        await FB().addLoginLog({
          userId: s.user.id, email: s.user.email,
          success: true, action: 'login', userAgent: navigator.userAgent
        });
      } catch (e) { /* yoksay */ }
      return App.Auth.snapshot();
    },

    // Sosyal giriş: 'google' | 'github' | 'apple'
    signInWithProvider: async function (provider) {
      state.error = null;
      const r = await FB().signInWithProvider(provider);
      if (r && r.redirect) return { redirect: true };
      state.session = r;
      resetDeviceAccess();
      await completeSocialLogin(r, provider);
      return App.Auth.snapshot();
    },

    signInWithGoogle: function () { return App.Auth.signInWithProvider('google'); },
    signInWithGithub: function () { return App.Auth.signInWithProvider('github'); },
    signInWithApple: function () { return App.Auth.signInWithProvider('apple'); },

    signUp: async function (email, password, displayName) {
      state.error = null;

      // Davet kodu varsa rolü ondan al
      let invite = null;
      let code = null;
      try {
        code = localStorage.getItem('deneyap.invite');
        if (code) invite = await FB().verifyInvite(code);
      } catch (e) { invite = null; }

      const r = await FB().signUp(email, password, {
        display_name: displayName || '',
        role: invite ? invite.role : null,
        invite_code: invite ? code : null
      });

      if (r && r.pending) {
        try { localStorage.removeItem('deneyap.invite'); } catch (e) { /* yoksay */ }
        state.session = null;
        state.profile = null;
        resetDeviceAccess();
        emit();
        return { pending: true };
      }
      state.session = r;
      await refreshProfile();
      emit();
      return App.Auth.snapshot();
    },

    signOut: async function () {
      const uid = state.session && state.session.user && state.session.user.id;
      if (uid) {
        try {
          await FB().addLoginLog({
            userId: uid, success: true, action: 'logout', userAgent: navigator.userAgent
          });
        } catch (e) { /* yoksay */ }
      }
      await FB().signOut();
      state.session = null;
      state.profile = null;
      state.bindings = null;
      resetDeviceAccess();
      state.ready = true;
      emit();
      return App.Auth.snapshot();
    },

    reload: async function () {
      try { state.session = await FB().ensureSession(); } catch (e) { state.session = null; }
      await refreshProfile();
      emit();
      return App.Auth.snapshot();
    },

    /* ==================================================== PROFİL =========== */

    updateProfile: async function (id, data) {
      await FB().rest('profiles?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH',
        prefer: 'return=representation',
        body: data
      });
      if (state.session && state.session.user && state.session.user.id === id) {
        await refreshProfile();
      }
      emit();
      return state.profile;
    },

    updatePassword: async function (currentPassword, newPassword) {
      return FB().updatePassword(currentPassword, newPassword);
    },

    updateEmail: async function (currentPassword, newEmail) {
      await FB().updateEmail(currentPassword, newEmail);
      // E-posta değişince yeni adres doğrulanmalı → oturumu kapat
      await FB().signOut();
      state.session = null;
      state.profile = null;
      state.bindings = null;
      resetDeviceAccess();
      state.ready = true;
      emit();
      return true;
    },

    sendPasswordReset: async function (email) {
      return FB().sendPasswordResetEmail(email);
    },

    getLoginLogs: async function (uid, limit) {
      return FB().getLoginLogs(uid, limit);
    },

    /* =================================================== ADMIN ============ */

    listProfiles: async function () {
      const rows = await FB().rest('profiles?select=*&order=created_at.asc');
      return rows || [];
    },

    setRole: async function (id, role) {
      await FB().rest('profiles?id=eq.' + encodeURIComponent(id) + '&role=in.(admin,user)', {
        method: 'PATCH',
        prefer: 'return=representation',
        body: { role: role }
      });
      if (state.session && state.session.user && state.session.user.id === id) {
        await refreshProfile();
      }
      try { await FB().addAuditLog('set_role', id, { role: role }); } catch (e) { /* yoksay */ }
      emit();
    },

    removeProfile: async function (id) {
      await FB().rest('profiles?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
      try { await FB().addAuditLog('block_user', id, null); } catch (e) { /* yoksay */ }
      emit();
    },

    createUser: async function (email, password, role, displayName) {
      const me = state.session && state.session.user;
      if (!me) throw err('Giriş yapmalısınız.', 'Bu işlem için giriş yapmalısınız.');
      // İkincil Firebase uygulaması ile oluştur → mevcut admin oturumu KORUNUR
      const r = await FB().adminCreateUser(email, password, role, displayName);
      try { await FB().addAuditLog('create_user', r.user.id, { role: r.role, email: r.user.email }); } catch (e) { /* yoksay */ }
      emit();
      return r;
    },

    /* ================================================== DAVETLER ========== */

    listInvites: async function () { return FB().listInvites(); },
    verifyInvite: async function (code) { return FB().verifyInvite(code); },
    consumeInvite: async function (code, uid) { return FB().consumeInvite(code, uid); },

    createInvite: async function (email, role, createdBy) {
      const inv = await FB().createInvite(email, role, createdBy);
      try { await FB().addAuditLog('create_invite', inv.code, { role: role, email: email }); } catch (e) { /* yoksay */ }
      return inv;
    },

    revokeInvite: async function (code) {
      await FB().revokeInvite(code);
      try { await FB().addAuditLog('revoke_invite', code, null); } catch (e) { /* yoksay */ }
    },

    /* ================================================== AUDIT ============= */

    listAuditLogs: async function (limit) { return FB().listAuditLogs(limit); },

    /* ============================================== OLAY GÜNLÜĞÜ ========== */

    // Bir olayı buluta (Firestore) yazar. Yalnızca giriş yapılmışsa ve cihaz
    // kullanıcıya görünüyorsa yazılır (sahiplik/erişim sınırı korunur).
    logEvent: async function (ev) {
      const me = state.session && state.session.user;
      if (!me) return null;
      if (ev && ev.dev && !App.Auth.canView(ev.dev)) return null;
      return FB().addAlarmEvent(Object.assign({}, ev, { owner_id: me.id }));
    },

    // Kendi olaylarım (bulut).
    listMyEvents: async function (limit) {
      const me = state.session && state.session.user;
      if (!me) return [];
      return FB().listAlarmEvents(me.id, limit);
    },

    // Admin: tüm cihazların olayları.
    listAllEvents: async function (limit) {
      if (!App.Auth.isAdmin()) throw err('Yetki yok.', 'Bu listeyi yalnızca admin görebilir.');
      return FB().listAllAlarmEvents(limit);
    },

    deleteEvent: async function (id) {
      if (!App.Auth.isAdmin()) throw err('Yetki yok.', 'Yalnızca admin silebilir.');
      return FB().deleteAlarmEvent(id);
    },

    clearAllEvents: async function () {
      if (!App.Auth.isAdmin()) throw err('Yetki yok.', 'Yalnızca admin temizleyebilir.');
      const n = await FB().clearAllAlarmEvents();
      try { await FB().addAuditLog('clear_alarm_events', null, { count: n }); } catch (e) { /* yoksay */ }
      return n;
    },

    /* ============================================== CİHAZ MÜLKİYETİ ======= */

    // Admin: tüm bağlantılar | Kullanıcı: yalnızca kendi bağlantıları.
    // (Sunucu kuralları da listeyi owner_id ile kısıtlar.)
    listBindings: async function () {
      const me = state.session && state.session.user;
      try {
        let rows;
        if (!me) rows = [];
        else if (App.Auth.isAdmin()) rows = await FB().listBindings();
        else rows = await FB().listOwnBindings(me.id);
        rows = (rows || []).slice().sort(function (a, b) {
          return millis(b.bound_at) - millis(a.bound_at);
        });
        state.bindings = rows;
        state.setupRequired = false;
      } catch (e) {
        if (FB().isSetupMissing(e)) { state.setupRequired = true; state.bindings = []; }
        else { state.bindings = state.bindings || []; }
      }
      return state.bindings;
    },

    bindingOf: function (deviceId) {
      if (!deviceId || !state.bindings) return null;
      for (let i = 0; i < state.bindings.length; i++) {
        if (state.bindings[i].device_id === deviceId) return state.bindings[i];
      }
      return null;
    },

    // Bir cihazın durumunu YETKİLİ olarak sorgular ve erişim kararını önbelleğe
    // alır. app.js her karede erişim soramayacağı için karar burada saklanır.
    //
    //  'free'          → boşta, bağlanabilir
    //  'mine'          → bana bağlı
    //  'mine_pending'  → bana bağlı, bağlantı kesme talebi admin onayında
    //  'other'         → başkasına bağlı (ben admin'im)
    //  'pending_other' → başkasına bağlı, bağlantı kesme talebi var (ben admin'im)
    //  'hidden'        → başkasına bağlı, göremem (admin değilim)
    //  'local_mine'    → oturum yok ama tarayıcıda kalıcı sahiplik kaydı var
    //  'anon'          → oturum yok
    //  'error'         → okunamadı
    checkDevice: async function (deviceId) {
      state.deviceAccess = state.deviceAccess || {};
      if (!deviceId) { state.deviceInfo = { state: 'none' }; return state.deviceInfo; }

      const me = state.session && state.session.user;
      const local = localOwner(deviceId);
      let res;

      if (!me) {
        // Oturum yok: tarayıcıda kalıcı sahiplik kaydı varsa cihaz "bizim".
        res = local ? { state: 'local_mine', local: local } : { state: 'anon' };
      } else {
        try {
          const b = await FB().getBinding(deviceId);
          const admin = App.Auth.isAdmin();
          if (!b) {
            // Cihaz gerçekten boşta → eski yerel kaydı temizle.
            if (local && local.uid === me.id) forgetOwner(deviceId);
            res = { state: 'free' };
          } else if (b.owner_id === me.id) {
            // Sahibiyiz → yerel hafızayı tazele.
            rememberOwner(deviceId, me.id, me.email, b.label);
            res = { state: b.status === 'release_pending' ? 'mine_pending' : 'mine', binding: b };
          } else {
            // Sunucu başka bir sahip diyor → yerel kayıt bayat (admin yeniden
            // atamış olabilir) → temizle; sahiplik yerelden DEVRALINMAZ.
            if (local && local.uid === me.id) forgetOwner(deviceId);
            res = admin
              ? { state: b.status === 'release_pending' ? 'pending_other' : 'other', binding: b }
              : { state: 'hidden' };
          }
        } catch (e) {
          if (isPermDenied(e)) {
            /* Okuma reddedildi. Kurallar gereği BOŞTA cihazlar ve SAHİBİ
               olduğum cihazlar okunabilir; reddedildiyse cihaz var ve bana
               ait değil → yerel kayıt bayattır, temizle ve gizle. */
            if (local && local.uid === me.id) forgetOwner(deviceId);
            res = { state: 'hidden', error: e };
          } else if (local && local.uid === me.id) {
            // Ağ hatası / çevrimdışı: yerel sahiplik kaydına güven.
            res = { state: 'mine', binding: { device_id: deviceId, owner_id: me.id, label: local.label }, local_fallback: true };
          } else {
            res = { state: 'error', error: e };
          }
        }
      }

      let access;
      res.device_id = deviceId;
      switch (res.state) {
        case 'free': access = 'free'; break;
        case 'mine': access = 'granted'; break;
        case 'local_mine': access = 'granted'; break;
        case 'other':
        case 'pending_other': access = App.Auth.isAdmin() ? 'granted' : 'denied'; break;
        case 'anon': access = 'anon'; break;
        default: access = 'denied';
      }
      state.deviceAccess[deviceId] = access;
      state.deviceInfo = res;
      return res;
    },

    deviceAccess: function (deviceId) {
      return (state.deviceAccess && state.deviceAccess[deviceId]) || null;
    },

    // Son checkDevice sonucundaki durum adı ('free' | 'mine' | 'mine_pending'
    // | 'other' | 'pending_other' | 'hidden' | 'local_mine' | 'anon' | 'error').
    // UI metinleri bu duruma göre seçilir.
    deviceState: function (deviceId) {
      const info = state.deviceInfo;
      if (!info) return null;
      if (deviceId && info.device_id && info.device_id !== deviceId) return null;
      return info.state || null;
    },

    needsCheck: function (deviceId) {
      if (!deviceId) return false;
      return !(state.deviceAccess && state.deviceAccess[deviceId]);
    },

    // Cihaza kumanda edilebilir mi? (app.js her karede çağırır → senkron)
    canControl: function (deviceId) {
      const a = state.deviceAccess && state.deviceAccess[deviceId];
      if (a === 'granted') return true;
      // Boşta (bağlanmamış) ya da başkasına bağlı → kumanda yok.
      if (a === 'free' || a === 'denied') return false;
      // Henüz doğrulanmadı
      const me = state.session && state.session.user;
      if (!me) return true;   // oturum yok: eski davranış korunur
      return false;           // oturum var ama doğrulanmadı: güvenli tarafta kal
    },

    // Cihaz bu kullanıcıya GÖRÜNÜR mü?
    // Yalnızca SAHİBİ (bağlı hesap) veya admin görür. Boşta ('free') cihazın
    // telemetrisi/kumandası bağlanana kadar GÖSTERİLMEZ; cihaz yalnızca
    // Ayarlar > Hesap & Roller > "Mülkiyet & Erişim" kutusunda görünür ki
    // aktivasyon koduyla bağlanabilsin.
    canView: function (deviceId) {
      if (!deviceId) return false;
      const a = state.deviceAccess && state.deviceAccess[deviceId];
      return a === 'granted';
    },

    // Yalnızca BOŞTA bir cihaz "bağlanabilir" sayılır.
    canClaim: function (deviceId) {
      if (!state.session) return false;
      return (state.deviceAccess && state.deviceAccess[deviceId]) === 'free';
    },

    // Cihazı kendi hesabıma bağla (boşta ise) veya admin olarak yeniden ata.
    bindDevice: async function (deviceId, ownerId, label) {
      const me = state.session && state.session.user;
      if (!me) throw err('Giriş yapmalısınız.', 'Giriş yapmalısınız.');
      const owner = ownerId || me.id;

      const st = await App.Auth.checkDevice(deviceId);
      const admin = App.Auth.isAdmin();
      if (!(st.state === 'free' || (admin && (st.state === 'other' || st.state === 'pending_other')))) {
        throw err('Cihaz bağlı.', bindingBlockedText(st));
      }

      try {
        const topic = (App.settings ? App.settings().mqttTopic : '') || '';
        if (st.state === 'free') await FB().bindDevice(deviceId, owner, label || '', me.id, topic);
        else await FB().reassignBinding(deviceId, owner, me.id, topic);
      } catch (e) {
        throw err(e.human || e.message, bindingBlockedText(st));
      }

      try { await FB().addAuditLog('bind_device', deviceId, { owner: owner }); } catch (e) { /* yoksay */ }
      if (owner === me.id) rememberOwner(deviceId, me.id, me.email, label || '');
      await App.Auth.listBindings();
      await App.Auth.checkDevice(deviceId);
      emit();
    },

    // Aktivasyon koduyla bağlan: kod Firestore kurallarında sunucu tarafında
    // doğrulanır (düz metin asla istemciye dönmez), sonra cihaz bağlanır.
    activateDevice: async function (deviceId, code) {
      const me = state.session && state.session.user;
      if (!me) throw err('Giriş yapmalısınız.', 'Bu işlem için giriş yapmalısınız.');
      code = String(code || '').trim();
      if (!code) throw err('Kod boş.', 'Lütfen cihazın aktivasyon kodunu girin.');

      const st = await App.Auth.checkDevice(deviceId);
      if (st.state !== 'free') throw err('Cihaz bağlı.', bindingBlockedText(st));

      /* 1) Kodu sunucu tarafında doğrula (geçici device_unlocks kaydı).
         Kurallar kodu karşılaştırır; eşleşmezse yazma reddedilir. */
      try {
        await FB().unlockDevice(deviceId, code, me.id);
      } catch (e) {
        const help = await activationHelp(deviceId, code);
        try { await FB().clearUnlock(deviceId); } catch (e2) { /* yoksay */ }
        throw err(e.human || e.message, help);
      }

      /* 2) Kodu doğrulandı → cihazı bağla ve geçici kaydı temizle. */
      /* Profil dokümanı eksikse kurallardaki isAdmin() hata verip bağlamayı
         reddedebilir; önce profili garanti altına al. */
      if (!state.profile) { try { await refreshProfile(); } catch (e2) { /* yoksay */ } }
      try {
        await FB().bindDevice(deviceId, me.id, '', '', (App.settings ? App.settings().mqttTopic : '') || '');
      } catch (e) {
        const help = await bindFailureHelp(deviceId, e);
        try { await FB().clearUnlock(deviceId); } catch (e2) { /* yoksay */ }
        throw err(e.human || e.message, help);
      }
      try { await FB().clearUnlock(deviceId); } catch (e2) { /* yoksay */ }

      try { await FB().addAuditLog('bind_device', deviceId, { owner: me.id, via: 'code' }); } catch (e) { /* yoksay */ }
      rememberOwner(deviceId, me.id, me.email, '');
      await App.Auth.listBindings();
      await App.Auth.checkDevice(deviceId);
      emit();
    },

    // Bağlantıyı kes (sahibi) → cihaz kilitli kalır, admin onayı bekler.
    requestRelease: async function (deviceId) {
      const me = state.session && state.session.user;
      if (!me) throw err('Giriş yapmalısınız.', 'Giriş yapmalısınız.');
      await FB().requestRelease(deviceId, me.id);
      try { await FB().addAuditLog('device_release_request', deviceId, null); } catch (e) { /* yoksay */ }
      await App.Auth.listBindings();
      await App.Auth.checkDevice(deviceId);
      emit();
    },

    // Talebi geri al (sahibi) → bağlantı yeniden aktif.
    cancelRelease: async function (deviceId) {
      await FB().cancelRelease(deviceId);
      await App.Auth.listBindings();
      await App.Auth.checkDevice(deviceId);
      emit();
    },

    // Onayla (admin) → cihaz serbest kalır, artık başka bir hesap bağlanabilir.
    approveRelease: async function (deviceId) {
      await FB().approveRelease(deviceId);
      forgetOwner(deviceId);
      try { await FB().addAuditLog('device_release_approved', deviceId, null); } catch (e) { /* yoksay */ }
      await App.Auth.listBindings();
      await App.Auth.checkDevice(deviceId);
      emit();
    },

    // Reddet (admin) → bağlantı kesme iptal, yeniden aktif.
    rejectRelease: async function (deviceId) {
      await FB().cancelRelease(deviceId);
      try { await FB().addAuditLog('device_release_rejected', deviceId, null); } catch (e) { /* yoksay */ }
      await App.Auth.listBindings();
      await App.Auth.checkDevice(deviceId);
      emit();
    },

    // Zorla serbest bırak (admin) → sahibinden bağımsız.
    freeDevice: async function (deviceId) {
      await FB().approveRelease(deviceId);
      forgetOwner(deviceId);
      try { await FB().addAuditLog('device_force_free', deviceId, null); } catch (e) { /* yoksay */ }
      await App.Auth.listBindings();
      await App.Auth.checkDevice(deviceId);
      emit();
    },

    // Admin: cihazı doğrudan başka bir hesaba ata (hesap değiştirme).
    reassignDevice: async function (deviceId, ownerId) {
      const me = state.session && state.session.user;
      await FB().reassignBinding(deviceId, ownerId, me && me.id);
      if (me && ownerId === me.id) rememberOwner(deviceId, me.id, me.email, '');
      else forgetOwner(deviceId);
      try { await FB().addAuditLog('device_reassign', deviceId, { owner: ownerId }); } catch (e) { /* yoksay */ }
      await App.Auth.listBindings();
      await App.Auth.checkDevice(deviceId);
      emit();
    },

    // Bekleyen bağlantı kesme talepleri (admin paneli).
    pendingReleases: function () {
      return (state.bindings || []).filter(function (b) { return b.status === 'release_pending'; });
    },

    /* ============================================== AKTİVASYON KODLARI ==== */

    // Admin: tanımlı cihaz aktivasyon kodlarını listeler (yalnızca admin okur).
    listDeviceCodes: async function () {
      if (!App.Auth.isAdmin()) throw err('Yetki yok.', 'Bu listeyi yalnızca admin görebilir.');
      return FB().listDeviceCodes();
    },

    // Admin: bir cihaz için aktivasyon kodu tanımlar/günceller.
    setDeviceCode: async function (deviceId, code, label) {
      const me = state.session && state.session.user;
      if (!App.Auth.isAdmin()) throw err('Yetki yok.', 'Yalnızca admin kod tanımlayabilir.');
      const c = await FB().setDeviceCode(deviceId, code, label, me && me.id);
      try { await FB().addAuditLog('set_device_code', deviceId, { label: label || '' }); } catch (e) { /* yoksay */ }
      return c;
    },

    deleteDeviceCode: async function (deviceId) {
      if (!App.Auth.isAdmin()) throw err('Yetki yok.', 'Yalnızca admin silebilir.');
      await FB().deleteDeviceCode(deviceId);
      try { await FB().addAuditLog('delete_device_code', deviceId, null); } catch (e) { /* yoksay */ }
    },

    // Doğrulama e-postasını yeniden gönder (oturum yoksa e-posta+şifre ile)
    resendVerificationEmail: async function (email, password) {
      return FB().resendVerificationEmail(email, password);
    },

    /* E-posta doğrulama durumunu SUNUCUDAN tazele (kullanıcı bağlantıyı
       onaylamış olabilir; istemci önbelleği "doğrulanmamış" kalır) ve
       oturumu güncelleyip arayüzlere bildir. */
    refreshVerification: async function () {
      if (!state.session || !state.session.user) return false;
      let fresh = null;
      try { fresh = await FB().refreshUser(); } catch (e) { fresh = null; }
      if (fresh) {
        state.session.user.emailVerified = !!fresh.emailVerified;
        if (fresh.email) state.session.user.email = fresh.email;
        if (fresh.displayName) state.session.user.displayName = fresh.displayName;
        emit();
        return !!fresh.emailVerified;
      }
      return !!state.session.user.emailVerified;
    }
  };

  // Firebase auth state değişiminde (firebase.js tetikler) durumu tazele
  App.Auth._onAuthChange = function () {
    init().catch(function (e) { console.warn('[auth] durum tazelenemedi', e); });
  };

})();
