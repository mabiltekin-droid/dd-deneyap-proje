/* ==========================================================================
   auth.js — Hesap, rol ve cihaz mülkiyeti

   Kaynaklar:
     profiles          → kim, hangi rolde (admin | user)
     device_bindings   → DK-XXXX kimlikli kart kime ait

   Kural (münhasırlık):
     • Cihaz KİMSEYE bağlı değilse  → herkes görebilir/çalıştırabilir ve
       ilk giriş yapan kişi "benim" diyerek bağlayabilir.
     • Cihaz bir hesaba bağlıysa    → yalnızca sahibi veya ADMIN komut
       gönderebilir; başkası görünüm alır ama kumanda kilitlidir.

   Bu modül yalnızca PANEL tarafında yetkilendirme yapar. Cihazın kendisi
   (firmware) ayrıca kendi kararlarını verir; haberleşme koptuğunda yerel
   güvenlik hiçbir zaman hesaba bağlı değildir.
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});
  const SB = () => App.SB;

  const state = {
    ready: false,
    session: null,
    profile: null,
    bindings: null,       // tüm erişilebilir bağlamalar (cache)
    setupRequired: false, // supabase şeması henüz yüklenmemiş
    error: null
  };

  const listeners = [];

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(App.Auth.snapshot()); } catch (e) { console.warn('[auth] dinleyici hatası', e); }
    });
  }

  /* ------------------------------------------------------- oturum ---------- */

  async function refreshProfile() {
    if (!state.session) { state.profile = null; return null; }
    try {
      const p = await SB().profile();
      if (p && p.__setupRequired) { state.setupRequired = true; state.profile = null; }
      else { state.profile = p; state.setupRequired = false; }
    } catch (e) {
      console.warn('[auth] profil okunamadı', e);
      state.error = e.human || e.message;
      state.profile = null;
    }
    return state.profile;
  }

  async function init() {
    try {
      state.session = await SB().ensureSession();
    } catch (e) { state.session = null; }
    await refreshProfile();
    if (!state.session) {
      /* Oturum yokken de şema denetimi: panel açılır açılmaz
         "veritabanı şeması henüz yüklenmedi" söylenebilsin. */
      try { state.setupRequired = !(await SB().probeSetup()); }
      catch (e) { state.setupRequired = false; }
    }
    state.ready = true;
    emit();
    return App.Auth.snapshot();
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
      const s = await SB().signIn(email, password);
      state.session = s;
      await refreshProfile();
      state.ready = true;
      emit();
      return App.Auth.snapshot();
    },

    signUp: async function (email, password, displayName) {
      state.error = null;
      const r = await SB().signUp(email, password, { display_name: displayName || '' });
      if (r && r.pending) {
        /* E-posta onayı beklendiği için oturum yok. */
        state.session = null;
        state.profile = null;
        emit();
        return { pending: true };
      }
      state.session = r;
      await refreshProfile();
      emit();
      return App.Auth.snapshot();
    },

    signOut: async function () {
      await SB().signOut();
      state.session = null;
      state.profile = null;
      state.bindings = null;
      state.ready = true;
      emit();
      return App.Auth.snapshot();
    },

    /* Yenile: panel her açıldığında ve uzun süren sayfalarda çağrılır. */
    reload: async function () {
      try { state.session = await SB().ensureSession(); } catch (e) { state.session = null; }
      await refreshProfile();
      emit();
      return App.Auth.snapshot();
    },

    /* =================================================== ADMIN ============ */

    /* Kayıtlı herkesin profili. Admin tümünü, normal kullanıcı yalnızca
       kendini görür (RLS zaten bu kadarını döndürür). */
    listProfiles: async function () {
      const rows = await SB().rest('profiles?select=*&order=created_at.asc');
      return rows || [];
    },

    setRole: async function (id, role) {
      await SB().rest('profiles?id=eq.' + encodeURIComponent(id) +
                      '&role=in.(admin,user)', {
        method: 'PATCH',
        prefer: 'return=representation',
        body: { role: role }
      });
      if (state.session && state.session.user && state.session.user.id === id) {
        await refreshProfile();
      }
      emit();
    },

    /* Profil satırını siler → o hesabı yetkisiz bırakır (giriş yapsa bile
       panel onu "yetkisiz" sayar; Supabase Auth kaydı kalır çünkü silme
       anahtarı yalnızca service_role'de vardır). */
    removeProfile: async function (id) {
      await SB().rest('profiles?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
      emit();
    },

    /* Admin menüsünden yeni hesap açar. E-posta onayı açıksa kullanıcı
       ilk girişini kendi onay bağlantısıyla yapar. */
    createUser: async function (email, password, role, displayName) {
      const r = await SB().signUp(email, password, { display_name: displayName || '' });
      const uid = r && r.user && r.user.id;
      if (!uid) return r; // onay bekleniyor
      /* Trigger rolü 'user' yapar; admin istendiyse yükselt. */
      if (role === 'admin') {
        try { await App.Auth.setRole(uid, 'admin'); } catch (e) { /* RLS izin vermediyse user kalır */ }
      }
      return r;
    },

    /* ============================================== CİHAZ MÜLKİYETİ ======= */

    listBindings: async function () {
      try {
        const rows = await SB().rest('device_bindings?select=*&order=bound_at.desc');
        state.bindings = rows || [];
        state.setupRequired = false;
      } catch (e) {
        if (SB().isSetupMissing(e)) { state.setupRequired = true; state.bindings = []; }
        else throw e;
      }
      return state.bindings;
    },

    bindingOf: function (deviceId) {
      if (!deviceId || !state.bindings) return null;
      return state.bindings.find(function (b) { return b.device_id === deviceId; }) || null;
    },

    bindDevice: async function (deviceId, ownerId, label) {
      const me = state.session && state.session.user;
      if (!me) throw Object.assign(new Error('Giriş yapmalısınız.'), { human: 'Giriş yapmalısınız.' });
      const owner = ownerId || me.id;
      await SB().rest('device_bindings', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=representation',
        body: { device_id: deviceId, owner_id: owner, label: label || '', bound_by: me.id }
      });
      await App.Auth.listBindings();
      emit();
    },

    unbindDevice: async function (deviceId) {
      await SB().rest('device_bindings?device_id=eq.' + encodeURIComponent(deviceId), {
        method: 'DELETE'
      });
      await App.Auth.listBindings();
      emit();
    },

    /* Bir cihaza kumanda gönderebilir miyim?
       - bağlanmamış  → evet (ve bağlayabilir)
       - bağlı        → sahibi ya da admin
       - oturum yok   → yalnız bağlanmamış cihazlar            */
    canControl: function (deviceId) {
      const b = App.Auth.bindingOf(deviceId);
      if (!b) return true;
      const me = state.session && state.session.user;
      if (!me) return false;
      return b.owner_id === me.id || App.Auth.isAdmin();
    },

    /* Bağlı olmayan cihazı hesabıma bağlayabilir miyim? */
    canClaim: function (deviceId) {
      if (!state.session) return false;
      const b = App.Auth.bindingOf(deviceId);
      if (!b) return true;
      return b.owner_id === state.session.user.id || App.Auth.isAdmin();
    }
  };
})();
