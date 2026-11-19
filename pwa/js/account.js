/* ==========================================================================
   account.js — Ayarlar sayfasındaki "Hesap & Roller" bölümünün davranışı

   Bağımlılıklar: config.js (App), supabase.js (App.SB), auth.js (App.Auth)
   ========================================================================== */

(function () {
  'use strict';

  const App = window.App;
  const $ = function (id) { return document.getElementById(id); };

  let busy = false;

  function setResult(text, kind) {
    const el = $('authResult');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'result' + (kind ? ' ' + kind : '');
  }

  function setChromeFallback(visible) {
    const row = $('googleChromeFallbackRow');
    if (row) row.hidden = !visible;
  }

  const NATIVE_PENDING_KEY = 'deneyap.native_auth.pending';
  const NATIVE_HANDOFF_STATE_KEY = 'deneyap.native_auth.handoff_state';
  const AUTH_STATE_RE = /^[A-Za-z0-9_-]{16,80}$/;
  const AUTH_CODE_RE = /^[A-Za-z0-9_-]{16,120}$/;

  let activeClaimStop = null;
  let handoffCompleting = false;

  function toBase64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    if (typeof btoa === 'function') {
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i];
      const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      const n = (a << 16) | (b << 8) | c;
      out += alphabet[(n >>> 18) & 63] + alphabet[(n >>> 12) & 63];
      if (i + 1 < bytes.length) out += alphabet[(n >>> 6) & 63];
      if (i + 2 < bytes.length) out += alphabet[n & 63];
    }
    return out;
  }

  function randomTokenBytes(size) {
    const arr = new Uint8Array(size);
    const cryptoObj = typeof crypto !== 'undefined' ? crypto : null;
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      cryptoObj.getRandomValues(arr);
      return arr;
    }
    throw Object.assign(new Error('Güvenli rastgele üreteç kullanılamıyor.'), { code: 'auth/crypto-unavailable' });
  }

  async function makePkcePair() {
    const cryptoObj = typeof crypto !== 'undefined' ? crypto : null;
    if (!cryptoObj || !cryptoObj.subtle || typeof cryptoObj.subtle.digest !== 'function') {
      throw Object.assign(
        new Error('Bu ortamda güvenli tarayıcı girişi başlatılamıyor.'),
        { code: 'auth/native-request-failed' }
      );
    }
    const state = toBase64Url(randomTokenBytes(24));
    const verifier = toBase64Url(randomTokenBytes(32));
    const encoded = typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(verifier)
      : Uint8Array.from(verifier, function (ch) { return ch.charCodeAt(0) & 255; });
    const digest = await cryptoObj.subtle.digest('SHA-256', encoded);
    const challenge = toBase64Url(new Uint8Array(digest));
    return { state: state, verifier: verifier, challenge: challenge };
  }

  function savePendingNativeAuth(entry) {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(NATIVE_PENDING_KEY, JSON.stringify(entry));
      }
    } catch (e) { /* yoksay */ }
  }

  function loadPendingNativeAuth() {
    try {
      if (typeof sessionStorage === 'undefined') return null;
      const raw = sessionStorage.getItem(NATIVE_PENDING_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !AUTH_STATE_RE.test(parsed.state || '') || !parsed.verifier) {
        sessionStorage.removeItem(NATIVE_PENDING_KEY);
        return null;
      }
      if (parsed.expiresAt && Date.now() > Number(parsed.expiresAt)) {
        sessionStorage.removeItem(NATIVE_PENDING_KEY);
        return null;
      }
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function clearPendingNativeAuth() {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(NATIVE_PENDING_KEY);
      }
    } catch (e) { /* yoksay */ }
  }

  function saveHandoffState(state) {
    try {
      if (typeof sessionStorage !== 'undefined') {
        if (state) sessionStorage.setItem(NATIVE_HANDOFF_STATE_KEY, state);
        else sessionStorage.removeItem(NATIVE_HANDOFF_STATE_KEY);
      }
    } catch (e) { /* yoksay */ }
  }

  function activeHandoffState() {
    if (window.AndroidApp) return '';
    try {
      const params = new URLSearchParams(location.search || '');
      if (params.get('native_auth') === 'google') {
        const s = params.get('state') || '';
        if (AUTH_STATE_RE.test(s)) return s;
      }
    } catch (e) { /* yoksay */ }
    try {
      if (typeof sessionStorage !== 'undefined') {
        const saved = sessionStorage.getItem(NATIVE_HANDOFF_STATE_KEY) || '';
        if (AUTH_STATE_RE.test(saved)) return saved;
      }
    } catch (e) { /* yoksay */ }
    return '';
  }

  function setHandoffStatus(text, kind) {
    const el = $('nativeAuthStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'result' + (kind ? ' ' + kind : '');
  }

  async function postMobileAuth(payload, bearerToken) {
    const headers = { 'Content-Type': 'application/json' };
    if (bearerToken) headers.Authorization = 'Bearer ' + bearerToken;
    const response = await fetch('/api/mobile-auth', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });
    let data = {};
    try { data = await response.json(); } catch (e) { data = {}; }
    return { status: response.status, ok: response.ok, data: data };
  }

  function buildBrowserAuthUrl(state) {
    const baseHref = (location && location.origin && location.origin !== 'null')
      ? (location.origin + (location.pathname || '/settings.html'))
      : './settings.html';
    return baseHref + '?native_auth=google&state=' + encodeURIComponent(state) + '&return=app#accountCard';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(timestamp) {
    if (timestamp == null || timestamp === '') return '';
    const value = typeof timestamp.toDate === 'function' ? timestamp.toDate()
      : typeof timestamp.seconds === 'number' ? timestamp.seconds * 1000
      : timestamp;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleDateString('tr-TR', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  }

  /* ------------------------------------------------------ görünüm -------- */

  function render(snap) {
    const chip = $('authChip');
    const setup = !!snap.setupRequired;
    const handoff = activeHandoffState();

    $('authSetupBanner').hidden = !setup;

    if (handoff) {
      $('authSignedOut').hidden = false;
      $('authSignedIn').hidden = true;
      $('adminPanel').hidden = true;
      if ($('nativeAuthHandoff')) $('nativeAuthHandoff').hidden = false;
      if ($('standardAuthBox')) $('standardAuthBox').hidden = true;
      const continueBtn = $('nativeAuthContinueExistingBtn');
      const googleBtnText = $('nativeAuthGoogleBtnText');
      if (continueBtn) {
        if (snap.signedIn && snap.user && snap.user.email) {
          continueBtn.hidden = false;
          const span = continueBtn.querySelector('span');
          if (span) span.textContent = snap.user.email + ' ile uygulamaya dön';
          if (googleBtnText) googleBtnText.textContent = 'Başka Google hesabıyla devam et';
        } else {
          continueBtn.hidden = true;
          if (googleBtnText) googleBtnText.textContent = 'Google ile devam et';
        }
      }
    } else {
      if ($('nativeAuthHandoff')) $('nativeAuthHandoff').hidden = true;
      if ($('standardAuthBox')) $('standardAuthBox').hidden = false;
      $('authSignedOut').hidden = snap.signedIn;
      $('authSignedIn').hidden = !snap.signedIn;
      $('adminPanel').hidden = !snap.isAdmin;
    }

    if (chip) {
      if (setup) { chip.dataset.state = 'warning'; chip.textContent = 'Şema yok'; }
      else if (snap.signedIn && snap.isAdmin) { chip.dataset.state = 'normal'; chip.textContent = 'Yönetici'; }
      else if (snap.signedIn) { chip.dataset.state = 'normal'; chip.textContent = 'Giriş yapıldı'; }
      else { chip.dataset.state = 'unknown'; chip.textContent = 'Oturum yok'; }
    }

    if (snap.signedIn) {
      setChromeFallback(false);
      $('authUserEmail').textContent = (snap.user && snap.user.email) || '—';
      $('authUserRole').textContent = snap.isAdmin ? 'Sistem Yöneticisi (Platform Admin)' : 'Kullanıcı';
      $('authUserSince').textContent =
        fmtDate(snap.profile && snap.profile.created_at) ||
        fmtDate(snap.user && snap.user.created_at) || '—';
    }

    if (snap.isAdmin && !setup) loadUsers().catch(function (e) {
      setResult(e.human || e.message, 'err');
    });

    // Doğrulama e-postası yeniden gönder butonunu göster/gizle
    updateResendVerificationButton(snap);

    /* Oturum/kimlik değişince cihaz durumunu yeniden doğrula (yetki
       değişmiş olabilir) ve sahiplik kutusunu/butonları güncelle.
       ÖNEMLİ: sonuç deviceStatus'a yazılmalı; aksi halde paintOwnership()
       bayat durumla çizer ve giriş yapıldığında kutu "giriş yapın" der. */
    if (lastDeviceId) {
      App.Auth.checkDevice(lastDeviceId)
        .then(function (st) { deviceStatus = st; paintOwnership(); })
        .catch(function () { paintOwnership(); });
    } else {
      paintOwnership();
    }
    renderDeviceTable();
  }

  // Kullanıcı girişi yapılmamış ama Firebase'de emailVerified=false olan kullanıcı varsa butonu göster
  let showResend = false;
  function updateResendVerificationButton(snap) {
    const row = $('resendVerificationRow');
    if (!row) return;
    if (snap.signedIn) { showResend = false; }
    row.hidden = !(showResend && !snap.signedIn);
  }

  /* ------------------------------------------------ kullanıcı listesi ----- */

  async function loadUsers() {
    const rows = await App.Auth.listProfiles();
    const me = App.Auth.snapshot().user;
    const body = $('userTableBody');
    if (!body) return;

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4">Henüz kayıt yok.</td></tr>';
      return;
    }

    body.innerHTML = rows.map(function (u) {
      const self = me && u.id === me.id;
      return '<tr data-id="' + esc(u.id) + '">' +
        '<td class="u-mail">' + esc(u.email) + (self ? ' <em>(sen)</em>' : '') + '</td>' +
        '<td><select class="role-select" aria-label="' + esc(u.email) + ' rolü"' + (self ? ' disabled title="Kendi rolünüzü buradan değiştiremezsiniz"' : '') + '>' +
          '<option value="user"' + (u.role === 'user' ? ' selected' : '') + '>Kullanıcı</option>' +
          '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Yönetici</option>' +
        '</select></td>' +
        '<td class="u-date">' + esc(fmtDate(u.created_at) || '—') + '</td>' +
        '<td class="u-act"><button type="button" class="btn sm ghost u-del"' +
          (self ? ' disabled title="Kendi hesabınızı silemezsiniz"' : '') + '>Engelle</button></td>' +
        '</tr>';
    }).join('');
  }

  async function onRoleChange(sel) {
    const tr = sel.closest('tr');
    if (!tr) return;
    busy = true;
    try {
      await App.Auth.setRole(tr.dataset.id, sel.value);
      setResult('Rol güncellendi: ' + (sel.value === 'admin' ? 'Yönetici' : 'Kullanıcı'), 'ok');
      App.sound && App.sound.click();
    } catch (e) {
      setResult('Rol değiştirilemedi: ' + (e.human || e.message), 'err');
      sel.value = sel.value === 'admin' ? 'user' : 'admin';
    } finally { busy = false; }
  }

  async function onDelete(btn) {
    const tr = btn.closest('tr');
    if (!tr) return;
    const mail = tr.querySelector('.u-mail').textContent.trim();
    if (!confirm(mail + ' hesabının ERİŞİMİ kapatılsın mı?\n\n' +
                 'Kullanıcı tekrar giriş yapamaz (profil satırı silinir).')) return;
    busy = true;
    btn.disabled = true;
    try {
      await App.Auth.removeProfile(tr.dataset.id);
      tr.remove();
      setResult('Hesabın erişimi kapatıldı: ' + mail, 'ok');
      App.haptic && App.haptic(30);
    } catch (e) {
      setResult('Silinemedi: ' + (e.human || e.message), 'err');
      btn.disabled = false;
    } finally { busy = false; }
  }

  /* ------------------------------------------------ kayıt / giriş --------- */

  async function doSignIn() {
    if (busy) return;
    const email = $('authEmail').value.trim();
    const pass = $('authPass').value;
    if (!email || !pass) return setResult('E-posta ve şifre girin.', 'err');
    busy = true;
    $('authSignInBtn').disabled = true;
    setChromeFallback(false);
    setResult('Giriş yapılıyor…');
    try {
      await App.Auth.signIn(email, pass);
      setResult('Giriş başarılı.', 'ok');
      App.sound && App.sound.ok ? App.sound.ok() : (App.sound && App.sound.click());
      App.haptic && App.haptic(40);
    } catch (e) {
      // Doğrulanmamış hesap → yeniden gönderme butonunu göster
      if (e && e.code === 'auth/email-not-verified') {
        showResend = true;
        const row = $('resendVerificationRow');
        if (row) row.hidden = false;
      }
      setResult(e.human || e.message, 'err');
    } finally {
      busy = false;
      $('authSignInBtn').disabled = false;
    }
  }

  async function requestAccountDeletion() {
    if (busy) return;
    const trigger = $('accountDeleteRequestBtn');
    busy = true;
    trigger.disabled = true;
    setResult('Silme talebi gönderiliyor…');
    try {
      const token = await App.FB.token();
      if (!token) {
        setResult('Talep göndermek için hesabınıza yeniden giriş yapın.', 'err');
        return;
      }
      const response = await fetch('/api/account-deletion', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token }
      });
      if (response.status === 401 || response.status === 403) {
        setResult('Doğrulanmış hesabınıza yeniden giriş yapıp tekrar deneyin.', 'err');
      } else if (response.status === 202) {
        setResult('Silme talebiniz alındı. En geç 30 gün içinde sonuç e-postayla bildirilir.', 'ok');
      } else {
        throw new Error('Talep kaydedilemedi');
      }
    } catch (e) {
      setResult('Talep gönderilemedi. Daha sonra tekrar deneyin.', 'err');
    } finally {
      busy = false;
      trigger.disabled = false;
    }
  }

  async function doSignUp() {
    if (busy) return;
    const email = $('authEmail').value.trim();
    const pass = $('authPass').value;
    if (!email) return setResult('E-posta girin.', 'err');
    const sorun = App.passwordIssue ? App.passwordIssue(pass) : '';
    if (sorun) return setResult(sorun, 'err');
    busy = true;
    $('authSignUpBtn').disabled = true;
    setResult('Hesap açılıyor…');
    try {
      const r = await App.Auth.signUp(email, pass, email.split('@')[0]);
      if (r && r.pending) {
        setResult('Hesap oluşturuldu. E-postanıza gelen bağlantıya tıklayıp ' +
                  'onaylayın, sonra giriş yapın.', 'ok');
      } else {
        setResult('Hesap açıldı ve giriş yapıldı. İlk hesapsanız yöneticisiniz.', 'ok');
      }
      App.haptic && App.haptic(40);
    } catch (e) {
      setResult(e.human || e.message, 'err');
    } finally {
      busy = false;
      $('authSignUpBtn').disabled = false;
    }
  }

  const SOCIAL_BTN = {
    google: { id: 'googleSignInBtn', label: 'Google' },
    github: { id: 'githubSignInBtn', label: 'GitHub' },
    apple:  { id: 'appleSignInBtn',  label: 'Apple'  }
  };

  function stopClaimMonitor() {
    if (typeof activeClaimStop === 'function') {
      const fn = activeClaimStop;
      activeClaimStop = null;
      fn();
    }
  }

  function unlockGoogleButton() {
    busy = false;
    const btn = $('googleSignInBtn');
    if (btn) btn.disabled = false;
  }

  function beginPendingClaimMonitor(state, verifier, opts) {
    stopClaimMonitor();
    opts = opts || {};
    let settled = false;
    let claiming = false;
    let intervalId = null;

    function cleanup() {
      settled = true;
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      try {
        if (typeof document !== 'undefined' && document.removeEventListener) {
          document.removeEventListener('visibilitychange', onReturn);
        }
        if (typeof window !== 'undefined' && window.removeEventListener) {
          window.removeEventListener('focus', onReturn);
          window.removeEventListener('pageshow', onReturn);
        }
      } catch (e) { /* yoksay */ }
      if (window.DeneyapNative && window.DeneyapNative._activeClaimHandler === onNativeCallback) {
        delete window.DeneyapNative.onAuthCallback;
        delete window.DeneyapNative._activeClaimHandler;
      }
      if (activeClaimStop === cleanup) activeClaimStop = null;
    }

    async function attemptClaim(code, fromReturnEvent) {
      if (settled || claiming) return;
      const snap = App.Auth && App.Auth.snapshot ? App.Auth.snapshot() : {};
      if (snap.signedIn) {
        clearPendingNativeAuth();
        cleanup();
        unlockGoogleButton();
        return;
      }
      const stored = loadPendingNativeAuth();
      if (!stored || stored.state !== state) {
        cleanup();
        unlockGoogleButton();
        return;
      }
      claiming = true;
      try {
        const res = await postMobileAuth({
          action: 'claim',
          state: state,
          verifier: verifier,
          ...(code && AUTH_CODE_RE.test(code) ? { code: code } : {})
        });
        if (settled) return;
        if (res.ok && res.data && res.data.customToken) {
          clearPendingNativeAuth();
          cleanup();
          setResult('Google oturumu doğrulanıyor…');
          await App.Auth.signInWithCustomToken(res.data.customToken, 'google');
          setChromeFallback(false);
          setResult('Giriş başarılı.', 'ok');
          App.sound && App.sound.ok ? App.sound.ok() : (App.sound && App.sound.click());
          App.haptic && App.haptic(40);
          unlockGoogleButton();
          return;
        }
        if (res.ok && res.data && res.data.pending) {
          if (fromReturnEvent && busy) {
            unlockGoogleButton();
          }
          return;
        }
        if (res.status === 410 || res.status === 404 || res.status === 403) {
          clearPendingNativeAuth();
          cleanup();
          unlockGoogleButton();
          setResult(res.status === 410
            ? 'Google giriş süresi doldu. Tekrar deneyin.'
            : 'Google girişi doğrulanamadı. Tekrar deneyin.', 'err');
          if (window.AndroidApp && typeof window.AndroidApp.openInChrome === 'function') {
            setChromeFallback(true);
          }
        }
      } catch (e) {
        if (fromReturnEvent && busy) unlockGoogleButton();
      } finally {
        claiming = false;
      }
    }

    function onNativeCallback(cbCode, cbState) {
      if (cbState && cbState !== state) return;
      attemptClaim(cbCode, true);
    }

    function onReturn() {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      attemptClaim('', true);
    }

    window.DeneyapNative = window.DeneyapNative || {};
    window.DeneyapNative.onAuthCallback = onNativeCallback;
    window.DeneyapNative._activeClaimHandler = onNativeCallback;

    try {
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', onReturn);
      }
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('focus', onReturn);
        window.addEventListener('pageshow', onReturn);
      }
    } catch (e) { /* yoksay */ }

    const pollMs = typeof opts.pollMs === 'number' ? opts.pollMs : 2000;
    if (pollMs > 0) {
      intervalId = setInterval(function () { attemptClaim('', false); }, pollMs);
    }

    activeClaimStop = cleanup;
    return { attemptClaim: attemptClaim, cleanup: cleanup, isSettled: function () { return settled; } };
  }

  async function startAndroidBrowserGoogleSignIn() {
    const android = window.AndroidApp;
    const bridge = window.DeneyapGoogleSignIn;
    const hasNativeBrowserBridge = bridge && typeof bridge.startBrowserSignIn === 'function';
    const hasCustomAuthUrlBridge = android && typeof android.openAuthInChrome === 'function';
    const hasLegacyChromeBridge = android && typeof android.openInChrome === 'function';

    if (!hasNativeBrowserBridge && !hasCustomAuthUrlBridge && !hasLegacyChromeBridge) {
      setResult('Google girişi bu uygulama sürümünde kullanılamıyor. Uygulamayı güncelleyin veya e-posta ve şifreyle giriş yapın.', 'err');
      return;
    }

    const btn = $('googleSignInBtn');
    busy = true;
    if (btn) btn.disabled = true;
    setChromeFallback(false);
    setResult('Google girişi hazırlanıyor…');

    let pkce;
    try {
      pkce = await makePkcePair();
      const initRes = await postMobileAuth({
        action: 'init',
        state: pkce.state,
        challenge: pkce.challenge
      });
      if (!initRes.ok || !initRes.data || !initRes.data.ok) {
        throw Object.assign(
          new Error('Google giriş oturumu başlatılamadı. Tekrar deneyin.'),
          { code: 'auth/native-request-failed' }
        );
      }
    } catch (e) {
      unlockGoogleButton();
      setResult((e && (e.human || e.message)) || 'Google girişi bu cihazda başlatılamadı.', 'err');
      if (hasLegacyChromeBridge) setChromeFallback(true);
      return;
    }

    const ttlSec = 180;
    savePendingNativeAuth({
      state: pkce.state,
      verifier: pkce.verifier,
      expiresAt: Date.now() + ttlSec * 1000
    });

    const authUrl = buildBrowserAuthUrl(pkce.state);
    const monitor = beginPendingClaimMonitor(pkce.state, pkce.verifier);
    setResult('Tarayıcıda Google girişi açılıyor… Giriş yaptıktan sonra uygulamaya döneceksiniz.');

    if (hasNativeBrowserBridge) {
      bridge.startBrowserSignIn(pkce.state).then(function (reply) {
        if (reply && reply.code && reply.state === pkce.state) {
          return monitor.attemptClaim(reply.code, true);
        }
      }).catch(function (err) {
        if (monitor.isSettled()) return;
        const code = err && err.code;
        if (code === 'auth/native-sign-in-timeout') {
          clearPendingNativeAuth();
          monitor.cleanup();
          unlockGoogleButton();
          setResult((err && err.message) || 'Google girişinden yanıt alınamadı. Tekrar deneyin.', 'err');
          if (hasLegacyChromeBridge) setChromeFallback(true);
          return;
        }
        if (code === 'auth/cancelled-popup-request') {
          monitor.cleanup();
          clearPendingNativeAuth();
          unlockGoogleButton();
          setResult('Google girişi iptal edildi.', 'err');
          return;
        }
        monitor.attemptClaim('', true).then(function () {
          if (!monitor.isSettled()) {
            if (code === 'auth/native-request-failed') {
              monitor.cleanup();
              clearPendingNativeAuth();
            }
            unlockGoogleButton();
            setResult((err && err.message) || 'Google girişi tamamlanamadı. Tekrar deneyin.', 'err');
            if (hasLegacyChromeBridge) setChromeFallback(true);
          }
        });
      });
      return;
    }

    if (hasCustomAuthUrlBridge) {
      try {
        android.openAuthInChrome(authUrl);
      } catch (e) {
        monitor.cleanup();
        clearPendingNativeAuth();
        unlockGoogleButton();
        setResult('Google girişi tarayıcıda açılamadı. Tekrar deneyin.', 'err');
        if (hasLegacyChromeBridge) setChromeFallback(true);
      }
      return;
    }

    /* Eski APK (v13-v15): WebView'in o anki adresini geçici olarak authUrl yapıp
       AndroidApp.openInChrome() ile Chrome Custom Tabs'i bu URL'de açar. */
    const originalHref = location.href;
    try {
      if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
        history.replaceState(null, '', authUrl);
      }
      setTimeout(function () {
        try {
          android.openInChrome();
        } catch (err) {
          monitor.cleanup();
          clearPendingNativeAuth();
          unlockGoogleButton();
          setResult('Tarayıcı açılamadı. Tekrar deneyin.', 'err');
        }
        setTimeout(function () {
          try {
            if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
              history.replaceState(null, '', originalHref);
            }
          } catch (e2) { /* yoksay */ }
        }, 1200);
      }, 120);
    } catch (e) {
      monitor.cleanup();
      clearPendingNativeAuth();
      unlockGoogleButton();
      setResult('Google girişi başlatılamadı. Tekrar deneyin.', 'err');
    }
  }

  async function completeNativeAuthHandoff(state, idToken) {
    if (handoffCompleting || !AUTH_STATE_RE.test(state || '') || !idToken) return;
    handoffCompleting = true;
    const btn = $('nativeAuthGoogleBtn');
    const contBtn = $('nativeAuthContinueExistingBtn');
    if (btn) btn.disabled = true;
    if (contBtn) contBtn.disabled = true;
    setHandoffStatus('Uygulama oturumu hazırlanıyor…');
    try {
      const res = await postMobileAuth({ action: 'complete', state: state }, idToken);
      if (!res.ok || !res.data || !res.data.code) {
        saveHandoffState('');
        if (res.status === 404 || res.status === 410) {
          setHandoffStatus('Giriş isteğinin süresi dolmuş. Uygulamaya dönüp "Google ile devam et" düğmesine yeniden dokunun.', 'err');
        } else {
          setHandoffStatus('Uygulama oturumu tamamlanamadı. Tekrar deneyin.', 'err');
        }
        return;
      }
      saveHandoffState('');
      const returnUrl = 'deneyapevkoruma://auth-callback?code='
        + encodeURIComponent(res.data.code) + '&state=' + encodeURIComponent(state);
      const returnLink = $('nativeAuthReturnLink');
      if (returnLink) {
        returnLink.href = returnUrl;
        returnLink.hidden = false;
      }
      if (contBtn) contBtn.hidden = true;
      setHandoffStatus(
        'Giriş tamamlandı! DD Ev Koruma uygulamasına yönlendiriliyorsunuz… '
        + 'Otomatik dönmezse aşağıdaki "Uygulamaya dön" düğmesine veya üstteki kapat (✕) tuşuna dokunun.',
        'ok'
      );
      try {
        location.href = returnUrl;
      } catch (e) { /* Düğmeyle devam edilebilir */ }
    } catch (e) {
      setHandoffStatus((e && (e.human || e.message)) || 'Bağlantı hatası. Tekrar deneyin.', 'err');
    } finally {
      handoffCompleting = false;
      if (btn) btn.disabled = false;
      if (contBtn) contBtn.disabled = false;
    }
  }

  async function startHandoffGoogleSignIn(state) {
    if (busy || !AUTH_STATE_RE.test(state || '')) return;
    busy = true;
    const btn = $('nativeAuthGoogleBtn');
    if (btn) btn.disabled = true;
    setHandoffStatus('Google girişi açılıyor…');
    saveHandoffState(state);
    try {
      /* Kullanıcı tıklaması içinde senkron başlatılır ki mobil tarayıcı açılır pencereyi engellemesin. */
      const res = await App.FB.signInWithProvider('google');
      if (res && res.redirect) {
        setHandoffStatus('Google sayfasına yönlendiriliyorsunuz…');
        return;
      }
      if (!res || !res.access_token) {
        throw new Error('Google oturum anahtarı alınamadı.');
      }
      await completeNativeAuthHandoff(state, res.access_token);
    } catch (e) {
      saveHandoffState('');
      if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) {
        setHandoffStatus('Google girişi iptal edildi.', 'err');
      } else {
        setHandoffStatus((e && (e.human || e.message)) || 'Google girişi başarısız oldu. Tekrar deneyin.', 'err');
      }
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
    }
  }

  async function doSocialSignIn(provider) {
    if (busy) return;
    setChromeFallback(false);
    const android = window.AndroidApp;
    if (provider === 'google' && android) {
      return startAndroidBrowserGoogleSignIn();
    }
    if (android && typeof android.openInChrome === 'function') {
      if (confirm('Tarayıcı açılacak ve oturum orada devam edecek. Devam edilsin mi?')) {
        android.openInChrome();
      }
      return;
    }
    const def = SOCIAL_BTN[provider] || { id: '', label: provider };
    const btn = def.id ? $(def.id) : null;
    busy = true;
    if (btn) btn.disabled = true;
    setResult(def.label + ' ile giriş yapılıyor…');
    try {
      const r = await App.Auth.signInWithProvider(provider);
      if (r && r.redirect) {
        setResult(def.label + ' sayfasına yönlendiriliyorsunuz…');
        return;
      }
      setChromeFallback(false);
      setResult('Giriş başarılı.', 'ok');
      App.sound && App.sound.ok ? App.sound.ok() : (App.sound && App.sound.click());
      App.haptic && App.haptic(40);
    } catch (e) {
      if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) {
        setResult(def.label + ' girişi iptal edildi.', 'err');
      } else {
        const msg = (e && (e.human || e.message))
          || (typeof e === 'string' && e)
          || (def.label + ' girişi başarısız oldu. Tekrar deneyin.');
        setResult(msg, 'err');
      }
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
    }
  }

  async function doSignOut() {
    const button = $('authSignOutBtn');
    button.disabled = true;
    setResult('Çıkış yapılıyor…');
    try {
      await App.Auth.signOut();
      setResult('Çıkış yapıldı.', 'ok');
    } catch (e) {
      setResult('Çıkış yapılamadı. Tekrar deneyin.', 'err');
    } finally {
      button.disabled = false;
    }
  }

  async function doResendVerification() {
    const email = $('authEmail').value.trim();
    const pass = $('authPass').value;
    if (!email || !pass) {
      return setResult('Doğrulama e-postası için e-posta ve şifrenizi girin.', 'err');
    }
    busy = true;
    $('resendVerificationBtn').disabled = true;
    setResult('Doğrulama e-postası gönderiliyor…');
    try {
      const r = await App.Auth.resendVerificationEmail(email, pass);
      if (r && r.emailVerified) {
        setResult('Bu hesap zaten doğrulanmış. Giriş yapabilirsiniz.', 'ok');
      } else {
        setResult('Doğrulama e-postası gönderildi. Gelen kutunuzu (ve spam klasörünü) kontrol edin.', 'ok');
      }
      App.sound && App.sound.chime();
      App.haptic && App.haptic(30);
    } catch (e) {
      setResult(e.human || e.message, 'err');
    } finally {
      busy = false;
      $('resendVerificationBtn').disabled = false;
    }
  }

  async function doForgotPassword() {
    const email = $('authEmail').value.trim();
    if (!email) return setResult('Önce e-posta adresinizi girin.', 'err');
    busy = true;
    $('forgotPasswordBtn').disabled = true;
    setResult('Sıfırlama bağlantısı gönderiliyor…');
    try {
      await App.Auth.sendPasswordReset(email);
      setResult('Şifre sıfırlama bağlantısı gönderildi: ' + email, 'ok');
      App.sound && App.sound.chime();
    } catch (e) {
      setResult('Gönderilemedi: ' + (e.human || e.message), 'err');
    } finally {
      busy = false;
      $('forgotPasswordBtn').disabled = false;
    }
  }

  async function doCreateUser() {
    if (busy) return;
    const email = $('newUserEmail').value.trim();
    const pass = $('newUserPass').value;
    const role = $('newUserRole').value;
    if (!email) return setResult('E-posta girin.', 'err');
    const sorun = App.passwordIssue ? App.passwordIssue(pass) : '';
    if (sorun) return setResult(sorun, 'err');
    busy = true;
    $('createUserBtn').disabled = true;
    setResult('Hesap oluşturuluyor…');
    try {
      const r = await App.Auth.createUser(email, pass, role, email.split('@')[0]);
      $('newUserEmail').value = '';
      $('newUserPass').value = '';
      if (r && r.pending) {
        setResult('Hesap açıldı (' + (role === 'admin' ? 'yönetici' : 'kullanıcı') +
                  '). Kullanıcı e-postasını onaylamalı.', 'ok');
      } else {
        setResult('Hesap açıldı ve giriş yapıldı: ' + email, 'ok');
      }
      await loadUsers();
      App.haptic && App.haptic(40);
    } catch (e) {
      setResult('Hesap açılamadı: ' + (e.human || e.message), 'err');
    } finally {
      busy = false;
      $('createUserBtn').disabled = false;
    }
  }

  /* ------------------------------------------------- cihaz mülkiyeti ----- */

  let lastDeviceId = null;
  let deviceStatus = null;   // App.Auth.checkDevice() sonucu

  /* Sahiplik kutusu + Bağla/Serbest bırak butonlarını çizer.
     loadDevice() cihaz kimliği değişince, paintOwnership() oturum/kimlik
     değişince de çağrılır — giriş yapılınca butonun pasif kalmasını önler. */
  function paintOwnership() {
    const box = $('deviceOwnership');
    if (!box) return;
    if (!lastDeviceId) { box.hidden = true; return; }

    box.hidden = false;
    $('ownDevId').textContent = lastDeviceId;

    const snap = App.Auth.snapshot();
    const st = (deviceStatus && deviceStatus.state) || 'unknown';
    const b = deviceStatus && deviceStatus.binding;
    const ownerLabel = b && b.owner_id
      ? (snap.user && b.owner_id === snap.user.id ? 'Siz' : (b.label || b.owner_id.slice(0, 8) + '...'))
      : '-';

    let owner = '-';
    let stateText = '-';

    switch (st) {
      case 'anon':
        owner = 'Gizli';
        stateText = 'Bağlı cihazı görmek ve yönetmek için giriş yapın.';
        break;
      case 'local_mine':
        owner = 'Siz';
        stateText = 'Bu tarayıcıda hesabınıza bağlı — çıkış yapsanız da cihaz sizin' +
          (deviceStatus.local && deviceStatus.local.email ? ' (' + deviceStatus.local.email + ')' : '');
        break;
      case 'free':
        owner = 'Bağlı değil (boşta)';
        stateText = snap.signedIn
          ? 'Boşta — ilk bağlayan sahip olur'
          : 'Boşta (giriş yaparak bağlanabilirsiniz)';
        break;
      case 'mine':
        owner = 'Siz';
        stateText = 'Bağlı — komut gönderebilirsiniz';
        break;
      case 'mine_pending':
        owner = 'Siz';
        stateText = 'Bağlantı kesildi — yönetici onayı bekleniyor';
        break;
      case 'other':
        owner = ownerLabel + ' (başka hesap)';
        stateText = 'Yönetici erişimi — kumanda edebilirsiniz';
        break;
      case 'pending_other':
        owner = ownerLabel + ' (başka hesap)';
        stateText = 'Bağlantı kesme talebi — onayınız bekleniyor';
        break;
      case 'hidden':
        owner = '[GİZLİ]';
        stateText = 'Başka bir hesaba bağlı — yalnızca sahibi ve yönetici görebilir';
        break;
      default:
        owner = '-';
        stateText = 'Durum okunamadı';
    }

    $('ownOwner').textContent = owner;
    $('ownState').textContent = stateText;

    const claim = $('claimBtn');
    const release = $('releaseBtn');
    const cancel = $('cancelReleaseBtn');
    const codeRow = $('claimCodeRow');
    const adminAssign = snap.isAdmin && (st === 'free' || st === 'other');

    if (codeRow) codeRow.hidden = !(snap.signedIn && st === 'free' && !snap.isAdmin);

    claim.hidden = !snap.signedIn || (st !== 'free' && !adminAssign);
    claim.disabled = !(App.Auth.canClaim(lastDeviceId) || adminAssign);
    claim.textContent = adminAssign ? 'Bu Cihazı Bana Ata' : 'Kodu Gir ve Bağla';

    release.hidden = !(st === 'mine');
    release.disabled = false;

    if (cancel) {
      cancel.hidden = !(st === 'mine_pending');
      cancel.disabled = false;
    }
  }

  async function loadDevice() {
    const box = $('deviceOwnership');
    if (!box) return;
    let s = null;
    try { s = await App.api.status(); } catch (e) { s = null; }
    const dev = s && s.dev;
    if (dev && dev !== lastDeviceId) { lastDeviceId = dev; deviceStatus = null; }
    if (!lastDeviceId) { box.hidden = true; return; }

    try {
      await App.Auth.listBindings();
      deviceStatus = await App.Auth.checkDevice(lastDeviceId);
    } catch (e) {
      deviceStatus = { state: 'error', error: e };
    }
    /* Admin kod formunda "Cihaz Kimliği" boşsa otomatik doldur. Böylece kod
       yanlış bir kimlikle kaydedilmez (yazım hatası → "kod yanlış" hatası). */
    const codeIdEl = $('codeDeviceId');
    if (codeIdEl && !codeIdEl.value.trim()) codeIdEl.value = lastDeviceId;
    paintOwnership();
    renderDeviceTable();
  }

  async function doClaim() {
    if (!lastDeviceId) return;
    if (!App.Auth.signedIn()) return setResult('Önce giriş yapın.', 'err');

    const snap = App.Auth.snapshot();
    const st = deviceStatus && deviceStatus.state;

    /* Admin, boştaki veya başka hesaba bağlı cihazı kod olmadan kendine atayabilir. */
    if (snap.isAdmin && (st === 'free' || st === 'other')) {
      setResult('Cihaz size atanıyor…');
      try {
        await App.Auth.bindDevice(lastDeviceId, snap.user.id, '');
        setResult(lastDeviceId + ' cihazı hesabınıza bağlandı.', 'ok');
        await loadDevice();
        App.haptic && App.haptic(40);
      } catch (e) {
        setResult('Bağlanamadı: ' + (e.human || e.message), 'err');
      }
      return;
    }

    /* Normal bağlanma: cihazın aktivasyon kodunu doğrula. */
    const codeEl = $('claimCodeInput');
    const code = (codeEl && codeEl.value || '').trim();
    if (!code) return setResult('Lütfen cihazın aktivasyon kodunu girin.', 'err');

    setResult('Kod doğrulanıyor ve cihaz bağlanıyor…');
    try {
      await App.Auth.activateDevice(lastDeviceId, code);
      if (codeEl) codeEl.value = '';
      setResult(lastDeviceId + ' cihazı hesabınıza bağlandı.', 'ok');
      await loadDevice();
      App.haptic && App.haptic(40);
    } catch (e) {
      setResult('Bağlanamadı: ' + (e.human || e.message), 'err');
    }
  }

  async function doRelease() {
    if (!lastDeviceId) return;
    if (!confirm(lastDeviceId + ' cihazının bağlantısı kesilsin mi?\n\n' +
                 'Cihaz kilitli kalır ve ancak bir yönetici onaylayınca yeniden ' +
                 'başka bir hesaba bağlanabilir.')) return;
    setResult('Bağlantı kesme talebi gönderiliyor…');
    try {
      await App.Auth.requestRelease(lastDeviceId);
      setResult('Bağlantı kesildi. Yönetici onayı bekleniyor.', 'ok');
      await loadDevice();
    } catch (e) {
      setResult('Kesilemedi: ' + (e.human || e.message), 'err');
    }
  }

  async function doCancelRelease() {
    if (!lastDeviceId) return;
    setResult('Talep geri alınıyor…');
    try {
      await App.Auth.cancelRelease(lastDeviceId);
      setResult('Talep geri alındı; bağlantı yeniden aktif.', 'ok');
      await loadDevice();
    } catch (e) {
      setResult('Geri alınamadı: ' + (e.human || e.message), 'err');
    }
  }

  /* ------------------------------------------- admin: cihaz bağlantıları -- */

  let deviceUsers = [];

  function ownerEmail(uid) {
    for (let i = 0; i < deviceUsers.length; i++) {
      if (deviceUsers[i].id === uid) return deviceUsers[i].email;
    }
    return uid ? uid.slice(0, 8) + '...' : '-';
  }

  async function renderDeviceTable() {
    const body = $('deviceTableBody');
    const wrap = $('adminDevices');
    if (!body || !wrap) return;
    const snap = App.Auth.snapshot();
    if (!snap.isAdmin) {
      wrap.hidden = true;
      const codesWrap = $('adminCodes');
      if (codesWrap) codesWrap.hidden = true;
      return;
    }
    wrap.hidden = false;

    renderCodeTable().catch(function () { /* yoksay */ });

    if (!deviceUsers.length) {
      try { deviceUsers = await App.Auth.listProfiles(); } catch (e) { /* yoksay */ }
    }
    let rows = [];
    try { rows = await App.Auth.listBindings(); } catch (e) { rows = []; }

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4">Bağlı cihaz yok.</td></tr>';
      return;
    }

    const opts = deviceUsers.map(function (u) {
      return '<option value="' + esc(u.id) + '">' + esc(u.email) + '</option>';
    }).join('');

    body.innerHTML = rows.map(function (b) {
      const pending = b.status === 'release_pending';
      const actions = pending
        ? '<button type="button" class="btn sm d-approve">Onayla</button>' +
          '<button type="button" class="btn sm ghost d-reject">Reddet</button>'
        : '<button type="button" class="btn sm ghost d-free">Serbest Bırak</button>';
      return '<tr data-dev="' + esc(b.device_id) + '">' +
        '<td class="d-id">' + esc(b.device_id) + '</td>' +
        '<td class="d-owner">' + esc(ownerEmail(b.owner_id)) + '</td>' +
        '<td class="d-state">' + (pending ? 'Bağlantı kesme talebi' : 'Bağlı') + '</td>' +
        '<td class="d-act">' + actions +
          '<select class="assign-select" aria-label="' + esc(b.device_id) + ' hesabına ata" title="Hesaba ata"><option value="">Ata…</option>' +
          opts + '</select></td>' +
        '</tr>';
    }).join('');
  }

  async function onDeviceAction(e) {
    const tr = e.target.closest('tr[data-dev]');
    if (!tr) return;
    const dev = tr.dataset.dev;

    if (e.target.classList.contains('d-approve')) {
      if (!confirm(dev + ' için bağlantı kesme onaylansın mı?\n\nCihaz serbest bırakılır ve başka bir hesap bağlanabilir.')) return;
      setResult('Onaylanıyor…');
      try { await App.Auth.approveRelease(dev); setResult('Onaylandı; cihaz serbest.', 'ok'); await loadDevice(); }
      catch (x) { setResult('Onaylanamadı: ' + (x.human || x.message), 'err'); }

    } else if (e.target.classList.contains('d-reject')) {
      setResult('Reddediliyor…');
      try { await App.Auth.rejectRelease(dev); setResult('Talep reddedildi; bağlantı aktif.', 'ok'); await loadDevice(); }
      catch (x) { setResult('Reddedilemedi: ' + (x.human || x.message), 'err'); }

    } else if (e.target.classList.contains('d-free')) {
      if (!confirm(dev + ' cihazı zorla serbest bırakılsın mı?\n\nSahibinin bağlantısı silinir.')) return;
      setResult('Serbest bırakılıyor…');
      try { await App.Auth.freeDevice(dev); setResult('Cihaz serbest bırakıldı.', 'ok'); await loadDevice(); }
      catch (x) { setResult('Bırakılamadı: ' + (x.human || x.message), 'err'); }
    }
  }

  async function onAssignChange(sel) {
    const tr = sel.closest('tr[data-dev]');
    if (!tr || !sel.value) return;
    const dev = tr.dataset.dev;
    const email = sel.options[sel.selectedIndex].textContent;
    if (!confirm(dev + ' cihazı ' + email + ' hesabına atansın mı?')) { sel.value = ''; return; }
    setResult('Atanıyor…');
    try {
      await App.Auth.reassignDevice(dev, sel.value);
      setResult('Cihaz atandı: ' + email, 'ok');
      await loadDevice();
    } catch (x) {
      setResult('Atanamadı: ' + (x.human || x.message), 'err');
    } finally { sel.value = ''; }
  }

  /* ------------------------------------- admin: aktivasyon kodları -------- */

  let deviceCodes = [];

  function randomActivationCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 10; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
  }

  async function renderCodeTable() {
    const body = $('codeTableBody');
    const wrap = $('adminCodes');
    if (!body || !wrap) return;
    const snap = App.Auth.snapshot();
    if (!snap.isAdmin) { wrap.hidden = true; return; }
    wrap.hidden = false;

    try { deviceCodes = await App.Auth.listDeviceCodes(); }
    catch (e) { deviceCodes = deviceCodes || []; }

    if (!deviceCodes.length) {
      body.innerHTML = '<tr><td colspan="4">Tanımlı kod yok. Yukarıdan cihaz kimliği ile kod ekleyin.</td></tr>';
      return;
    }

    deviceCodes.sort(function (a, b) {
      return String(a.device_id).localeCompare(String(b.device_id));
    });

    body.innerHTML = deviceCodes.map(function (c) {
      return '<tr data-code-dev="' + esc(c.device_id) + '">' +
        '<td class="d-id">' + esc(c.device_id) + '</td>' +
        '<td class="d-code"><code>' + esc(c.code) + '</code></td>' +
        '<td class="d-label">' + esc(c.label || '-') + '</td>' +
        '<td class="d-act"><button type="button" class="btn sm ghost c-del">Sil</button></td>' +
        '</tr>';
    }).join('');
  }

  async function doSaveCode() {
    const idEl = $('codeDeviceId');
    const codeEl = $('codeValue');
    const id = ((idEl && idEl.value) || '').trim();
    if (!id) return setResult('Cihaz kimliği gerekli.', 'err');
    let code = ((codeEl && codeEl.value) || '').trim();
    if (!code) code = randomActivationCode();

    setResult('Kod kaydediliyor…');
    try {
      const c = await App.Auth.setDeviceCode(id, code, '');
      if (codeEl) codeEl.value = '';
      if (idEl) idEl.value = '';
      const kayitli = String((c && c.code != null) ? c.code : code);
      const aktif = !!(c && c.active === true);
      setResult('Kod kaydedildi → ' + id + ' : ' + kayitli +
                (aktif ? '  (aktif)' : '  (DİKKAT: pasif kaydedildi!)') +
                '  — kodu kullanıcıya iletin', aktif ? 'ok' : 'err');
      await renderCodeTable();
    } catch (e) {
      setResult('Kaydedilemedi: ' + (e.human || e.message), 'err');
    }
  }

  async function onCodeAction(e) {
    const tr = e.target.closest('tr[data-code-dev]');
    if (!tr || !e.target.classList.contains('c-del')) return;
    const dev = tr.dataset.codeDev;
    if (!confirm(dev + ' için tanımlı aktivasyon kodu silinsin mi?\n\n' +
                 'Bu cihaz kod olmadan yeni bir hesaba bağlanamaz. Mevcut bağlantı devam eder.')) return;
    setResult('Kod siliniyor…');
    try {
      await App.Auth.deleteDeviceCode(dev);
      setResult('Kod silindi.', 'ok');
      await renderCodeTable();
    } catch (x) {
      setResult('Silinemedi: ' + (x.human || x.message), 'err');
    }
  }

  /* -------------------------------------------------------- init --------- */

  let boundCard = null;   /* hangi #accountCard düğümüne bağlandık */

  function onStatusChanged(s) {
    if (s && s.dev && s.dev !== lastDeviceId) loadDevice().catch(function () {});
  }

  function init() {
    const card = $('accountCard');
    if (!card) return;
    /* initAccount() üç yerden çağrılabilir: settings.js'in init'i,
       parallax.js'in SPA geçişi ve account.js'in kendi DOMContentLoaded
       kaydı. Aynı DOM düğümüne ikinci kez bağlanılırsa her buton (giriş,
       kayıt, cihazı bağla...) iki kez tetiklenir. */
    if (boundCard === card) return;
    boundCard = card;

    /* Davet bağlantısı (?invite=KOD) ile gelindiyse kodu sakla ve bilgilendir */
    try {
      const m = location.search.match(/[?&]invite=([A-Za-z0-9]+)/);
      if (m && m[1]) {
        localStorage.setItem('deneyap.invite', m[1]);
        setResult('Davet kodu algılandı: ' + m[1] + ' — "Yeni Hesap Aç" ile katılın.', 'ok');
      }
    } catch (e) { /* yoksay */ }

    if ($('authSignInForm')) {
      $('authSignInForm').addEventListener('submit', function (e) {
        e.preventDefault();
        doSignIn();
      });
    } else {
      $('authSignInBtn').addEventListener('click', doSignIn);
    }
    $('authSignUpBtn').addEventListener('click', doSignUp);
    ['google', 'github', 'apple'].forEach(function (p) {
      const id = SOCIAL_BTN[p].id;
      if ($(id)) $(id).addEventListener('click', function () { doSocialSignIn(p); });
    });
    if ($('googleChromeFallbackBtn')) {
      $('googleChromeFallbackBtn').addEventListener('click', function () {
        const android = window.AndroidApp;
        if (android && typeof android.openInChrome === 'function') {
          android.openInChrome();
        }
      });
    }
    if ($('nativeAuthGoogleBtn')) {
      $('nativeAuthGoogleBtn').addEventListener('click', function () {
        const state = activeHandoffState();
        if (state) startHandoffGoogleSignIn(state);
      });
    }
    if ($('nativeAuthContinueExistingBtn')) {
      $('nativeAuthContinueExistingBtn').addEventListener('click', async function () {
        const state = activeHandoffState();
        if (!state || !App.FB || typeof App.FB.token !== 'function') return;
        const token = await App.FB.token();
        if (token) await completeNativeAuthHandoff(state, token);
      });
    }
    $('authSignOutBtn').addEventListener('click', doSignOut);
    const deletionDialog = $('accountDeletionDialog');
    const deletionButton = $('accountDeleteRequestBtn');
    if (deletionDialog && deletionButton) {
      deletionButton.addEventListener('click', function () {
        if (busy) return;
        deletionDialog.returnValue = 'cancel';
        deletionDialog.showModal();
      });
      deletionDialog.addEventListener('close', function () {
        if (deletionDialog.returnValue === 'request') requestAccountDeletion();
      });
    }
    $('forgotPasswordBtn').addEventListener('click', doForgotPassword);
    if ($('adminCreateForm')) {
      $('adminCreateForm').addEventListener('submit', function (e) {
        e.preventDefault();
        doCreateUser();
      });
    } else {
      $('createUserBtn').addEventListener('click', doCreateUser);
    }
    $('claimBtn').addEventListener('click', doClaim);
    $('releaseBtn').addEventListener('click', doRelease);
    $('resendVerificationBtn').addEventListener('click', doResendVerification);
    if ($('cancelReleaseBtn')) $('cancelReleaseBtn').addEventListener('click', doCancelRelease);

    if ($('deviceTableBody')) {
      $('deviceTableBody').addEventListener('click', function (e) {
        if (e.target.closest('button') && !busy) onDeviceAction(e);
      });
      $('deviceTableBody').addEventListener('change', function (e) {
        if (e.target.classList.contains('assign-select') && !busy) onAssignChange(e.target);
      });
    }

    if ($('saveCodeBtn')) $('saveCodeBtn').addEventListener('click', doSaveCode);
    if ($('genCodeBtn')) $('genCodeBtn').addEventListener('click', function () {
      const el = $('codeValue');
      if (el) el.value = randomActivationCode();
    });
    if ($('codeTableBody')) {
      $('codeTableBody').addEventListener('click', function (e) {
        if (e.target.closest('button') && !busy) onCodeAction(e);
      });
    }

    /* Enter ile giriş */
    ['authEmail', 'authPass'].forEach(function (id) {
      $(id).addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); doSignIn(); }
      });
    });

    $('userTableBody').addEventListener('change', function (e) {
      if (e.target.classList.contains('role-select') && !busy) onRoleChange(e.target);
    });
    $('userTableBody').addEventListener('click', function (e) {
      const b = e.target.closest('.u-del');
      if (b && !b.disabled && !busy) onDelete(b);
    });

    const handoff = activeHandoffState();
    if (handoff && App.StudioNav && typeof App.StudioNav.show === 'function') {
      try { App.StudioNav.show('accountCard', { focus: false }); } catch (e) { /* yoksay */ }
    }

    App.Auth.onChange(render);

    App.Auth.init().then(async function (snap) {
      render(snap);
      if (snap.redirectError && !snap.signedIn) {
        if (handoff) setHandoffStatus(snap.redirectError, 'err');
        else setResult(snap.redirectError, 'err');
      }
      if (handoff && snap.signedIn) {
        let pendingHandoff = '';
        try {
          if (typeof sessionStorage !== 'undefined') {
            pendingHandoff = sessionStorage.getItem(NATIVE_HANDOFF_STATE_KEY) || '';
          }
        } catch (e) { /* yoksay */ }
        if (pendingHandoff === handoff && App.FB && typeof App.FB.token === 'function') {
          const token = await App.FB.token();
          if (token) await completeNativeAuthHandoff(handoff, token);
        }
      } else if (window.AndroidApp && !snap.signedIn) {
        const pending = loadPendingNativeAuth();
        if (pending) {
          const monitor = beginPendingClaimMonitor(pending.state, pending.verifier);
          monitor.attemptClaim('', false);
        }
      }
      return loadDevice();
    }).catch(function (e) {
      setResult(e.human || e.message, 'err');
    });

    /* Cihaz kimliği bağlantı gelince görünür hale gelir. Set tabanlı
       onStatus yalnızca fonksiyon kimliğine bakar — anonim closure her
       init'te yeniden eklenirdi, bu yüzden sabit isimli fonksiyon. */
    if (App.api && typeof App.api.onStatus === 'function') {
      App.api.onStatus(onStatusChanged);
    }
  }

  window.App.initAccount = init;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
