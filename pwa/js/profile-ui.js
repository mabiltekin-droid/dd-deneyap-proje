/* ==========================================================================
   profile-ui.js — "Profilim" bölümü (settings.html)

   Görünen ad, avatar, e-posta/şifre değiştirme, şifre sıfırlama,
   bu cihazdan çıkış ve son giriş etkinlikleri.
   App.Auth (yüksek seviye) üzerinden çalışır.
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});
  const $ = function (id) { return document.getElementById(id); };

  let bound = false;
  let loading = false;

  /* -------------------------------------------------- Yardımcılar ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function tsMillis(ts) {
    if (!ts) return null;
    try {
      if (typeof ts === 'number') return ts;
      if (typeof ts === 'string') { const n = Date.parse(ts); return isNaN(n) ? null : n; }
      if (ts.seconds != null) return ts.seconds * 1000;
      if (typeof ts.toDate === 'function') return ts.toDate().getTime();
    } catch (e) { /* yoksay */ }
    return null;
  }

  function fmtDateTime(ts) {
    const ms = tsMillis(ts);
    if (!ms) return '—';
    try {
      return new Date(ms).toLocaleString('tr-TR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return '—'; }
  }

  function shortUA(ua) {
    const s = String(ua || '');
    const os = /Windows/i.test(s) ? 'Windows'
      : /Android/i.test(s) ? 'Android'
      : /iPhone|iPad|iPod/i.test(s) ? 'iOS'
      : /Mac OS X/i.test(s) ? 'macOS'
      : /Linux/i.test(s) ? 'Linux' : 'Bilinmeyen';
    const br = /Edg\//i.test(s) ? 'Edge'
      : /OPR\/|Opera/i.test(s) ? 'Opera'
      : /Chrome/i.test(s) ? 'Chrome'
      : /Firefox/i.test(s) ? 'Firefox'
      : /Safari/i.test(s) ? 'Safari' : 'Tarayıcı';
    return os + ' · ' + br;
  }

  const AVATAR_FALLBACK =
    'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8899aa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>'
    );

  function setResult(text, kind) {
    const el = $('profileResult');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'result' + (kind ? ' ' + kind : '');
  }

  function toggle(row, show) {
    const el = $(row);
    if (el) el.hidden = show === undefined ? !el.hidden : !show;
  }

  /* -------------------------------------------------- Render --------------- */

  let currentUser = null;

  function render(snap) {
    const card = $('profileCard');
    if (!card) return;
    card.hidden = !snap.signedIn;
    const nav = $('navProfile');
    if (nav) nav.hidden = !snap.signedIn;
    if (!snap.signedIn) { currentUser = null; return; }

    currentUser = snap.user || null;
    const profile = snap.profile || {};

    const av = $('avatarPreview');
    if (av) av.src = profile.avatar_url || (currentUser && currentUser.photoURL) || AVATAR_FALLBACK;

    const nameEl = $('displayName');
    if (nameEl && document.activeElement !== nameEl) {
      nameEl.value = profile.display_name || (currentUser && currentUser.displayName) || '';
    }

    const mailEl = $('profileEmail');
    if (mailEl) mailEl.value = (currentUser && currentUser.email) || '';

    const badge = $('emailVerifiedBadge');
    if (badge) {
      const ok = !!(currentUser && currentUser.emailVerified);
      badge.className = 'badge ' + (ok ? 'ok' : 'warn');
      badge.textContent = ok ? 'Doğrulanmış' : 'Doğrulanmamış';
    }

    if (!loading) loadLoginLogs();
  }

  /* -------------------------------------------------- Avatar --------------- */

  function pickAvatar() {
    const input = $('avatarInput');
    if (input) input.click();
  }

  function onAvatarChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { setResult('Sadece resim dosyası seçin.', 'err'); return; }
    if (file.size > 5 * 1024 * 1024) { setResult("Dosya 5 MB'dan küçük olmalı.", 'err'); return; }

    const reader = new FileReader();
    reader.onload = function (evt) {
      const img = new Image();
      img.onload = function () {
        // 160x160'a küçült (Firestore belge boyutunu şişirmemek için)
        const size = 160;
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        const dataUrl = c.toDataURL('image/jpeg', 0.82);
        const av = $('avatarPreview');
        if (av) av.src = dataUrl;
        saveAvatar(dataUrl);
      };
      img.onerror = function () { setResult('Resim okunamadı.', 'err'); };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function saveAvatar(dataUrl) {
    if (!currentUser) return;
    setResult('Avatar kaydediliyor…');
    try {
      await App.Auth.updateProfile(currentUser.id, { avatar_url: dataUrl });
      setResult('Avatar güncellendi.', 'ok');
      if (App.sound && App.sound.chime) App.sound.chime();
    } catch (err) {
      setResult('Avatar kaydedilemedi: ' + (err.human || err.message), 'err');
    }
  }

  /* -------------------------------------------------- Profil kaydet -------- */

  async function saveProfile() {
    if (!currentUser) return;
    const nameEl = $('displayName');
    const name = nameEl ? nameEl.value.trim() : '';
    if (!name) { setResult('Görünen ad boş olamaz.', 'err'); return; }
    setResult('Kaydediliyor…');
    try {
      await App.Auth.updateProfile(currentUser.id, { display_name: name });
      setResult('Profil güncellendi.', 'ok');
      if (App.sound && App.sound.chime) App.sound.chime();
      if (App.haptic) App.haptic(30);
    } catch (err) {
      setResult('Kaydedilemedi: ' + (err.human || err.message), 'err');
    }
  }

  /* -------------------------------------------------- E-posta değiştir ----- */

  async function saveEmail() {
    if (!currentUser) return;
    const neu = ($('newEmailInput') || {}).value || '';
    const pass = ($('emailCurrentPass') || {}).value || '';
    const email = neu.trim();
    if (!email || !pass) { setResult('Yeni e-posta ve mevcut şifre gerekli.', 'err'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setResult('Geçerli bir e-posta girin.', 'err'); return; }
    if (email === currentUser.email) { setResult('Mevcut e-posta ile aynı.', 'err'); return; }

    setResult('E-posta değiştiriliyor…');
    try {
      await App.Auth.updateEmail(pass, email);
      toggle('changeEmailRow', false);
      const msg = 'E-posta güncellendi. Yeni adrese doğrulama bağlantısı gönderildi. ' +
                  'Doğruladıktan sonra tekrar giriş yapın.';
      setResult(msg, 'ok');
      const ar = $('authResult');
      if (ar) { ar.textContent = msg; ar.className = 'result ok'; }
      if (App.toast) App.toast(msg, { kind: 'ok', duration: 6000 });
      if (App.sound && App.sound.chime) App.sound.chime();
    } catch (err) {
      setResult('E-posta değiştirilemedi: ' + (err.human || err.message), 'err');
    }
  }

  /* -------------------------------------------------- Şifre değiştir ------- */

  async function savePassword() {
    if (!currentUser) return;
    const cur = ($('currentPassword') || {}).value || '';
    const neu = ($('newPassword') || {}).value || '';
    const conf = ($('confirmPassword') || {}).value || '';
    if (!cur || !neu || !conf) { setResult('Tüm şifre alanlarını doldurun.', 'err'); return; }
    if (neu !== conf) { setResult('Yeni şifreler eşleşmiyor.', 'err'); return; }
    if (neu.length < 6) { setResult('Yeni şifre en az 6 karakter olmalı.', 'err'); return; }

    setResult('Şifre değiştiriliyor…');
    try {
      await App.Auth.updatePassword(cur, neu);
      toggle('changePasswordRow', false);
      ['currentPassword', 'newPassword', 'confirmPassword'].forEach(function (id) {
        const el = $(id); if (el) el.value = '';
      });
      setResult('Şifre güncellendi.', 'ok');
      if (App.sound && App.sound.chime) App.sound.chime();
    } catch (err) {
      setResult('Şifre değiştirilemedi: ' + (err.human || err.message), 'err');
    }
  }

  /* -------------------------------------------------- Şifre sıfırlama ------ */

  async function sendReset() {
    if (!currentUser || !currentUser.email) {
      const typed = ($('authEmail') || {}).value || '';
      if (!typed) { setResult('Önce e-posta adresinizi girin.', 'err'); return; }
      try {
        await App.Auth.sendPasswordReset(typed.trim());
        setResult('Sıfırlama bağlantısı gönderildi: ' + typed.trim(), 'ok');
      } catch (err) { setResult(err.human || err.message, 'err'); }
      return;
    }
    setResult('Sıfırlama bağlantısı gönderiliyor…');
    try {
      await App.Auth.sendPasswordReset(currentUser.email);
      setResult('Şifre sıfırlama bağlantısı e-postanıza gönderildi.', 'ok');
    } catch (err) {
      setResult('Gönderilemedi: ' + (err.human || err.message), 'err');
    }
  }

  /* -------------------------------------------------- Giriş kayıtları ------ */

  async function loadLoginLogs() {
    const body = $('loginLogsList');
    if (!body || !currentUser) return;
    loading = true;
    try {
      const logs = await App.Auth.getLoginLogs(currentUser.id, 20);
      if (!logs || !logs.length) {
        body.innerHTML = '<tr><td colspan="3">Kayıt yok.</td></tr>';
        return;
      }
      body.innerHTML = logs.map(function (log) {
        const kind = log.success ? 'ok' : 'err';
        const label = log.action === 'logout' ? 'Çıkış' : (log.success ? 'Giriş' : 'Başarısız');
        return '<tr>' +
          '<td>' + esc(fmtDateTime(log.timestamp)) + '</td>' +
          '<td><span class="badge ' + kind + '">' + esc(label) + '</span></td>' +
          '<td>' + esc(shortUA(log.userAgent)) + '</td>' +
          '</tr>';
      }).join('');
    } catch (err) {
      body.innerHTML = '<tr><td colspan="3">Yüklenemedi: ' + esc(err.human || err.message) + '</td></tr>';
    } finally {
      loading = false;
    }
  }

  /* -------------------------------------------------- Init ----------------- */

  function init() {
    const card = $('profileCard');
    if (!card || bound) return;
    bound = true;

    if ($('saveProfileBtn')) $('saveProfileBtn').addEventListener('click', saveProfile);
    if ($('avatarPreview')) $('avatarPreview').addEventListener('click', pickAvatar);
    if ($('avatarPickBtn')) $('avatarPickBtn').addEventListener('click', pickAvatar);
    if ($('avatarInput')) $('avatarInput').addEventListener('change', onAvatarChange);
    if ($('changeEmailBtn')) $('changeEmailBtn').addEventListener('click', function () { toggle('changeEmailRow'); });
    if ($('cancelEmailBtn')) $('cancelEmailBtn').addEventListener('click', function () { toggle('changeEmailRow', false); });
    if ($('saveEmailBtn')) $('saveEmailBtn').addEventListener('click', saveEmail);
    if ($('changePasswordBtn')) $('changePasswordBtn').addEventListener('click', function () { toggle('changePasswordRow'); });
    if ($('cancelPasswordBtn')) $('cancelPasswordBtn').addEventListener('click', function () { toggle('changePasswordRow', false); });
    if ($('savePasswordBtn')) $('savePasswordBtn').addEventListener('click', savePassword);
    if ($('sendResetBtn')) $('sendResetBtn').addEventListener('click', sendReset);
    if ($('signOutThisDeviceBtn')) {
      $('signOutThisDeviceBtn').addEventListener('click', function () {
        App.Auth.signOut().catch(function () {});
        setResult('Çıkış yapıldı.', 'ok');
      });
    }

    App.Auth.onChange(render);
    if (App.Auth.snapshot().ready) render(App.Auth.snapshot());
  }

  window.App.initProfile = init;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
