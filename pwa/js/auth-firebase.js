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
    await refreshProfile();
    if (!state.session) {
      try { state.setupRequired = !(await FB().probeSetup()); }
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
      const s = await FB().signIn(email, password);
      state.session = s;
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

    /* ============================================== CİHAZ MÜLKİYETİ ======= */

    listBindings: async function () {
      try {
        const rows = await FB().rest('device_bindings?select=*&order=bound_at.desc');
        state.bindings = rows || [];
        state.setupRequired = false;
      } catch (e) {
        if (FB().isSetupMissing(e)) { state.setupRequired = true; state.bindings = []; }
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
      if (!me) throw err('Giriş yapmalısınız.', 'Giriş yapmalısınız.');
      const owner = ownerId || me.id;
      await FB().rest('device_bindings', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=representation',
        body: { device_id: deviceId, owner_id: owner, label: label || '', bound_by: me.id }
      });
      await App.Auth.listBindings();
      emit();
    },

    unbindDevice: async function (deviceId) {
      await FB().rest('device_bindings?device_id=eq.' + encodeURIComponent(deviceId), {
        method: 'DELETE'
      });
      await App.Auth.listBindings();
      emit();
    },

    canControl: function (deviceId) {
      const b = App.Auth.bindingOf(deviceId);
      if (!b) return true;
      const me = state.session && state.session.user;
      if (!me) return false;
      return b.owner_id === me.id || App.Auth.isAdmin();
    },

    canClaim: function (deviceId) {
      if (!state.session) return false;
      const b = App.Auth.bindingOf(deviceId);
      if (!b) return true;
      return b.owner_id === state.session.user.id || App.Auth.isAdmin();
    },

    // Doğrulama e-postasını yeniden gönder (oturum yoksa e-posta+şifre ile)
    resendVerificationEmail: async function (email, password) {
      return FB().resendVerificationEmail(email, password);
    }
  };

  // Firebase auth state değişiminde (firebase.js tetikler) durumu tazele
  App.Auth._onAuthChange = function () {
    init().catch(function (e) { console.warn('[auth] durum tazelenemedi', e); });
  };

})();
