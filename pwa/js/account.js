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

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('tr-TR', {
        day: '2-digit', month: '2-digit', year: 'numeric'
      });
    } catch (e) { return '—'; }
  }

  /* ------------------------------------------------------ görünüm -------- */

  function render(snap) {
    const chip = $('authChip');
    const setup = !!snap.setupRequired;

    $('authSetupBanner').hidden = !setup;

    $('authSignedOut').hidden = snap.signedIn;
    $('authSignedIn').hidden = !snap.signedIn;
    $('adminPanel').hidden = !snap.isAdmin;

    if (chip) {
      if (setup) { chip.dataset.state = 'warning'; chip.textContent = 'ŞEMA YOK'; }
      else if (snap.signedIn && snap.isAdmin) { chip.dataset.state = 'normal'; chip.textContent = 'ADMIN'; }
      else if (snap.signedIn) { chip.dataset.state = 'normal'; chip.textContent = 'GİRİŞLİ'; }
      else { chip.dataset.state = 'unknown'; chip.textContent = 'OTURUM YOK'; }
    }

    if (snap.signedIn) {
      $('authUserEmail').textContent = (snap.user && snap.user.email) || '—';
      $('authUserRole').textContent = snap.isAdmin ? 'Admin (tam yetki)' : 'Kullanıcı';
      $('authUserSince').textContent =
        fmtDate(snap.profile && snap.profile.created_at) ||
        fmtDate(snap.user && snap.user.created_at);
    }

    if (snap.isAdmin && !setup) loadUsers().catch(function (e) {
      setResult(e.human || e.message, 'err');
    });
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
        '<td><select class="role-select"' + (self ? ' disabled title="Kendi rolünüzü buradan değiştiremezsiniz"' : '') + '>' +
          '<option value="user"' + (u.role === 'user' ? ' selected' : '') + '>Kullanıcı</option>' +
          '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
        '</select></td>' +
        '<td class="u-date">' + esc(fmtDate(u.created_at)) + '</td>' +
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
      setResult('Rol güncellendi: ' + (sel.value === 'admin' ? 'Admin' : 'Kullanıcı'), 'ok');
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
    const email = $('authEmail').value.trim();
    const pass = $('authPass').value;
    if (!email || !pass) return setResult('E-posta ve şifre girin.', 'err');
    busy = true;
    $('authSignInBtn').disabled = true;
    setResult('Giriş yapılıyor…');
    try {
      await App.Auth.signIn(email, pass);
      setResult('Giriş başarılı.', 'ok');
      App.sound && App.sound.ok ? App.sound.ok() : (App.sound && App.sound.click());
      App.haptic && App.haptic(40);
    } catch (e) {
      setResult(e.human || e.message, 'err');
    } finally {
      busy = false;
      $('authSignInBtn').disabled = false;
    }
  }

  async function doSignUp() {
    const email = $('authEmail').value.trim();
    const pass = $('authPass').value;
    if (!email) return setResult('E-posta girin.', 'err');
    if (!pass || pass.length < 6) return setResult('Şifre en az 6 karakter olmalı.', 'err');
    busy = true;
    $('authSignUpBtn').disabled = true;
    setResult('Hesap açılıyor…');
    try {
      const r = await App.Auth.signUp(email, pass, email.split('@')[0]);
      if (r && r.pending) {
        setResult('Hesap oluşturuldu. E-postanıza gelen bağlantıya tıklayıp ' +
                  'onaylayın, sonra giriş yapın.', 'ok');
      } else {
        setResult('Hesap açıldı ve giriş yapıldı. İlk hesapsanız ADMINsiniz.', 'ok');
      }
      App.haptic && App.haptic(40);
    } catch (e) {
      setResult(e.human || e.message, 'err');
    } finally {
      busy = false;
      $('authSignUpBtn').disabled = false;
    }
  }

  async function doSignOut() {
    try { await App.Auth.signOut(); } catch (e) { /* yoksay */ }
    setResult('Çıkış yapıldı.', 'ok');
  }

  async function doCreateUser() {
    const email = $('newUserEmail').value.trim();
    const pass = $('newUserPass').value;
    const role = $('newUserRole').value;
    if (!email) return setResult('E-posta girin.', 'err');
    if (!pass || pass.length < 6) return setResult('Şifre en az 6 karakter olmalı.', 'err');
    busy = true;
    $('createUserBtn').disabled = true;
    setResult('Hesap oluşturuluyor…');
    try {
      const r = await App.Auth.createUser(email, pass, role, email.split('@')[0]);
      $('newUserEmail').value = '';
      $('newUserPass').value = '';
      if (r && r.pending) {
        setResult('Hesap açıldı (' + (role === 'admin' ? 'admin' : 'kullanıcı') +
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

  async function loadDevice() {
    const box = $('deviceOwnership');
    if (!box) return;
    let s = null;
    try { s = await App.api.status(); } catch (e) { s = null; }
    const dev = s && s.dev;
    lastDeviceId = dev || lastDeviceId;
    if (!lastDeviceId) { box.hidden = true; return; }

    box.hidden = false;
    $('ownDevId').textContent = lastDeviceId;

    await App.Auth.listBindings().catch(function () {});
    const b = App.Auth.bindingOf(lastDeviceId);
    const snap = App.Auth.snapshot();

    if (!b) {
      $('ownOwner').textContent = 'Bağlı değil (boşta)';
      $('ownState').textContent = snap.signedIn
        ? 'Herkes görebilir — ilk bağlayan sahip olur'
        : 'Herkes görebilir (giriş yaparak bağlayabilirsiniz)';
    } else {
      const isMe = snap.user && b.owner_id === snap.user.id;
      $('ownOwner').textContent = isMe ? 'Siz' :
        (b.label || b.owner_id.slice(0, 8) + '…') + (snap.isAdmin ? ' (admin)' : '');
      $('ownState').textContent = (isMe || snap.isAdmin)
        ? 'Serbest — komut gönderebilirsiniz'
        : 'KİLİTLİ — bu hesap komut gönderemez';
    }

    const claim = $('claimBtn');
    const release = $('releaseBtn');
    claim.disabled = !App.Auth.canClaim(lastDeviceId);
    claim.hidden = !!b && !App.Auth.canClaim(lastDeviceId);
    release.disabled = !b || !(snap.isAdmin || (snap.user && b && b.owner_id === snap.user.id));
    release.hidden = !b;
  }

  async function doClaim() {
    if (!lastDeviceId) return;
    if (!App.Auth.signedIn()) return setResult('Önce giriş yapın.', 'err');
    setResult('Cihaz bağlanıyor…');
    try {
      const snap = App.Auth.snapshot();
      await App.Auth.bindDevice(lastDeviceId, snap.user.id, '');
      setResult(lastDeviceId + ' cihazı hesabınıza bağlandı.', 'ok');
      await loadDevice();
      App.haptic && App.haptic(40);
    } catch (e) {
      setResult('Bağlanamadı: ' + (e.human || e.message), 'err');
    }
  }

  async function doRelease() {
    if (!lastDeviceId) return;
    if (!confirm(lastDeviceId + ' cihazının bağlaması kaldırılsın mı?\n\n' +
                 'Cihaz yeniden herkese açık hale gelir.')) return;
    setResult('Bağlantı kaldırılıyor…');
    try {
      await App.Auth.unbindDevice(lastDeviceId);
      setResult('Bağlama kaldırıldı.', 'ok');
      await loadDevice();
    } catch (e) {
      setResult('Kaldırılamadı: ' + (e.human || e.message), 'err');
    }
  }

  /* -------------------------------------------------------- init --------- */

  function init() {
    if (!$('accountCard')) return;

    $('authSignInBtn').addEventListener('click', doSignIn);
    $('authSignUpBtn').addEventListener('click', doSignUp);
    $('authSignOutBtn').addEventListener('click', doSignOut);
    $('createUserBtn').addEventListener('click', doCreateUser);
    $('claimBtn').addEventListener('click', doClaim);
    $('releaseBtn').addEventListener('click', doRelease);

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

    App.Auth.onChange(render);

    App.Auth.init().then(function (snap) {
      render(snap);
      return loadDevice();
    }).catch(function (e) {
      setResult(e.human || e.message, 'err');
    });

    /* Cihaz kimliği bağlantı gelince görünür hale gelir. */
    if (App.api && typeof App.api.onStatus === 'function') {
      App.api.onStatus(function (s) {
        if (s && s.dev && s.dev !== lastDeviceId) loadDevice().catch(function () {});
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
