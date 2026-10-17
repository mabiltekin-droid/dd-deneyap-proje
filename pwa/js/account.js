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

  const SOCIAL_BTN = {
    google: { id: 'googleSignInBtn', label: 'Google' },
    github: { id: 'githubSignInBtn', label: 'GitHub' },
    apple:  { id: 'appleSignInBtn',  label: 'Apple'  }
  };

  async function doSocialSignIn(provider) {
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
      setResult('Giriş başarılı.', 'ok');
      App.sound && App.sound.ok ? App.sound.ok() : (App.sound && App.sound.click());
      App.haptic && App.haptic(40);
    } catch (e) {
      if (e && e.code === 'auth/popup-closed-by-user') {
        setResult(def.label + ' girişi iptal edildi.', 'err');
      } else {
        setResult(e.human || e.message, 'err');
      }
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
    }
  }

  async function doSignOut() {
    try { await App.Auth.signOut(); } catch (e) { /* yoksay */ }
    setResult('Çıkış yapıldı.', 'ok');
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
        stateText = 'Bağlantı kesildi — admin onayı bekleniyor';
        break;
      case 'other':
        owner = ownerLabel + ' (başka hesap)';
        stateText = 'Admin erişimi — kumanda edebilirsiniz';
        break;
      case 'pending_other':
        owner = ownerLabel + ' (başka hesap)';
        stateText = 'Bağlantı kesme talebi — onayınız bekleniyor';
        break;
      case 'hidden':
        owner = '[GİZLİ]';
        stateText = 'Başka bir hesaba bağlı — yalnızca sahibi ve admin görebilir';
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
                 'Cihaz kilitli kalır ve ancak bir admin ONAYLAYINCA yeniden ' +
                 'başka bir hesaba bağlanabilir.')) return;
    setResult('Bağlantı kesme talebi gönderiliyor…');
    try {
      await App.Auth.requestRelease(lastDeviceId);
      setResult('Bağlantı kesildi. Admin onayı bekleniyor.', 'ok');
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
          '<select class="assign-select" title="Hesaba ata"><option value="">Ata…</option>' +
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

    $('authSignInBtn').addEventListener('click', doSignIn);
    $('authSignUpBtn').addEventListener('click', doSignUp);
    ['google', 'github', 'apple'].forEach(function (p) {
      const id = SOCIAL_BTN[p].id;
      if ($(id)) $(id).addEventListener('click', function () { doSocialSignIn(p); });
    });
    $('authSignOutBtn').addEventListener('click', doSignOut);
    $('forgotPasswordBtn').addEventListener('click', doForgotPassword);
    $('createUserBtn').addEventListener('click', doCreateUser);
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

    App.Auth.onChange(render);

    App.Auth.init().then(function (snap) {
      render(snap);
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
