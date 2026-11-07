/* ==========================================================================
   homes.js — Ayarlar > Ev ve aile erişimi

   Çoklu kullanıcı modeli:
     • Ev oluşturma ve yeniden adlandırma
     • Üye listesi + rol değiştirme / çıkarma
     • Süreli davet kodu oluşturma, kopyalama, iptal etme
     • Kodla eve katılma
     • Cihazı eve bağlama / evden ayırma / eski cihazları taşıma

   Yetki kararları App.Auth içindedir; bu dosya yalnızca arayüz ve çağrıları
   yönetir. İzleyici rolü kumanda edemez (bkz. api.js roleBlock).
   ========================================================================== */

(function () {
  'use strict';

  const App = window.App;
  const $ = function (id) { return document.getElementById(id); };

  let currentHomeId = '';
  let busy = false;
  let lastSig = '';

  const ROLE = {
    admin: 'Yönetici',
    maintainer: 'Bakımcı',
    viewer: 'İzleyici'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function setResult(text, kind) {
    const el = $('homeResult');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'result' + (kind ? ' ' + kind : '');
  }

  function roleLabel(role) { return ROLE[role] || 'Üye'; }

  function fmtDate(ms) {
    if (!ms) return '—';
    try {
      return new Date(Number(ms)).toLocaleDateString('tr-TR', {
        day: '2-digit', month: '2-digit', year: 'numeric'
      });
    } catch (e) { return '—'; }
  }

  function millis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    if (typeof ts === 'number') return ts;
    const d = Date.parse(ts);
    return isNaN(d) ? 0 : d;
  }

  function busyStart(on) {
    busy = !!on;
    ['homeCreateBtn', 'homeJoinBtn', 'homeInviteBtn', 'homeAttachBtn',
     'homeMigrateBtn', 'homeLeaveBtn', 'homeRenameBtn'].forEach(function (id) {
      const b = $(id);
      if (b) b.disabled = !!on;
    });
  }

  function snapshot() {
    return (App.Auth && App.Auth.snapshot) ? App.Auth.snapshot() : {};
  }

  /* ------------------------------------------------------------- ev listesi */

  function renderList(homes) {
    const box = $('homeList');
    if (!box) return;

    if (!homes.length) {
      box.innerHTML = '<p class="help">Henüz bir eviniz yok. Yukarıdan ilk evinizi oluşturun ' +
        'veya bir aile üyesinin davet kodunu kullanın.</p>';
      return;
    }

    box.innerHTML = homes.map(function (h) {
      const active = h.id === currentHomeId;
      return '<button type="button" class="home-card' + (active ? ' is-active' : '') +
        '" data-home-id="' + esc(h.id) + '" role="listitem">' +
        '<span class="home-card-main">' +
          '<strong>' + esc(h.name || 'Ev') + '</strong>' +
          '<small>' + esc(roleLabel(h.role)) + (h.owner ? ' · Ev sahibi' : '') + '</small>' +
        '</span>' +
        '<span class="home-card-arrow" aria-hidden="true">›</span>' +
      '</button>';
    }).join('');

    box.querySelectorAll('.home-card').forEach(function (b) {
      b.addEventListener('click', function () {
        currentHomeId = b.getAttribute('data-home-id') || '';
        refreshDetail();
      });
    });
  }

  /* ------------------------------------------------------------- detay ---- */

  async function refreshDetail() {
    const box = $('homeDetail');
    if (!box) return;

    const homes = (App.Auth && App.Auth.listHomes) ? await App.Auth.listHomes() : [];
    const home = homes.find(function (h) { return h.id === currentHomeId; });
    if (!home) {
      box.hidden = true;
      currentHomeId = '';
      return;
    }

    const canManage = App.Auth.canManageHome(currentHomeId);
    box.hidden = false;

    const nameEl = $('homeDetailName');
    if (nameEl) nameEl.textContent = home.name || 'Ev';
    const meta = $('homeDetailMeta');
    if (meta) {
      meta.textContent = roleLabel(home.role) +
        (home.owner ? ' · Ev sahibi' : '') +
        ' · ID: ' + home.id;
    }

    const rename = $('homeRenameBtn');
    if (rename) rename.hidden = !canManage;

    const inviteBtn = $('homeInviteBtn');
    if (inviteBtn) inviteBtn.hidden = !canManage;
    const invRole = $('homeInviteRole');
    if (invRole) invRole.disabled = !canManage;
    const invEmail = $('homeInviteEmail');
    if (invEmail) invEmail.disabled = !canManage;
    const invList = $('homeInviteList');
    if (invList) invList.hidden = !canManage;

    const attach = $('homeAttachBtn');
    if (attach) attach.hidden = !canManage;
    const migrate = $('homeMigrateBtn');
    if (migrate) migrate.hidden = !canManage;
    const addSel = $('homeAddDevice');
    if (addSel) addSel.disabled = !canManage;

    const leave = $('homeLeaveBtn');
    if (leave) leave.hidden = !!(home.owner);

    await Promise.all([
      renderMembers(home, canManage),
      canManage ? renderInvites(home) : Promise.resolve(renderInvitesEmpty()),
      renderDevices(home, canManage)
    ]);
  }

  function renderInvitesEmpty() {
    const box = $('homeInviteList');
    if (box) box.innerHTML = '';
  }

  async function renderMembers(home, canManage) {
    const box = $('homeMemberList');
    if (!box) return;
    let rows = [];
    try { rows = await App.Auth.listHomeMembers(home.id); }
    catch (e) {
      box.innerHTML = '<p class="help">Üyeler okunamadı: ' + esc(e.human || e.message) + '</p>';
      return;
    }

    const me = (snapshot().user || {}).id;
    box.innerHTML = (rows || []).map(function (m) {
      const owner = m.uid === home.owner_id;
      const self = m.uid === me;
      const canEdit = canManage && !owner;
      return '<div class="home-member" role="listitem">' +
        '<div class="home-member-main">' +
          '<strong>' + esc(m.display_name || m.email || m.uid) + '</strong>' +
          (self ? ' <span class="dev-badge ok">siz</span>' : '') +
          (owner ? ' <span class="dev-badge">ev sahibi</span>' : '') +
          '<small>' + esc(m.email || '') + '</small>' +
        '</div>' +
        '<div class="home-member-actions">' +
          (canEdit
            ? '<select class="home-role-select" data-uid="' + esc(m.uid) + '" aria-label="Üye rolü">' +
                ['admin', 'maintainer', 'viewer'].map(function (r) {
                  return '<option value="' + r + '"' + (m.role === r ? ' selected' : '') + '>' +
                    roleLabel(r) + '</option>';
                }).join('') +
              '</select>' +
              '<button type="button" class="btn ghost danger home-remove" data-uid="' + esc(m.uid) +
                '" data-name="' + esc(m.display_name || m.email || m.uid) + '">Çıkar</button>'
            : '<span class="home-role">' + esc(roleLabel(owner ? 'admin' : m.role)) + '</span>') +
        '</div>' +
      '</div>';
    }).join('');

    box.querySelectorAll('.home-role-select').forEach(function (sel) {
      sel.addEventListener('change', async function () {
        const uid = sel.getAttribute('data-uid');
        try {
          await App.Auth.updateHomeMemberRole(home.id, uid, sel.value);
          setResult('Üye rolü güncellendi.', 'ok');
          if (App.toast) App.toast('Üye rolü güncellendi', { kind: 'ok' });
          await refreshDetail();
        } catch (e) {
          setResult(e.human || e.message, 'fail');
          await refreshDetail();
        }
      });
    });

    box.querySelectorAll('.home-remove').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        const uid = btn.getAttribute('data-uid');
        const name = btn.getAttribute('data-name') || 'üye';
        if (!window.confirm(name + ' bu evden çıkarılsın mı?')) return;
        try {
          await App.Auth.removeHomeMember(home.id, uid);
          setResult('Üye evden çıkarıldı.', 'ok');
          await refreshDetail();
        } catch (e) {
          setResult(e.human || e.message, 'fail');
        }
      });
    });
  }

  async function renderInvites(home) {
    const box = $('homeInviteList');
    if (!box) return;
    let rows = [];
    try { rows = await App.Auth.listHomeInvites(home.id); }
    catch (e) {
      box.innerHTML = '<p class="help">Davetler okunamadı: ' + esc(e.human || e.message) + '</p>';
      return;
    }

    const live = (rows || []).filter(function (r) { return !r.used; });
    if (!live.length) {
      box.innerHTML = '<p class="help">Etkin davet yok.</p>';
      return;
    }

    box.innerHTML = live.map(function (r) {
      const exp = millis(r.expires_at) || Number(r.expires_at_ms) || 0;
      return '<div class="home-invite" role="listitem">' +
        '<div class="home-invite-main">' +
          '<code>' + esc(r.code || r.id) + '</code>' +
          '<small>' + esc(roleLabel(r.role)) +
            (r.email ? ' · ' + esc(r.email) : '') +
            ' · ' + esc(fmtDate(exp)) + '</small>' +
        '</div>' +
        '<div class="home-invite-actions">' +
          '<button type="button" class="btn ghost home-copy" data-code="' + esc(r.code || r.id) + '">Kopyala</button>' +
          '<button type="button" class="btn ghost danger home-revoke" data-code="' + esc(r.code || r.id) + '">İptal</button>' +
        '</div>' +
      '</div>';
    }).join('');

    box.querySelectorAll('.home-copy').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        const code = btn.getAttribute('data-code') || '';
        try {
          await navigator.clipboard.writeText(code);
          btn.textContent = 'Kopyalandı';
          setTimeout(function () { btn.textContent = 'Kopyala'; }, 1600);
        } catch (e) {
          window.prompt('Davet kodunu kopyalayın:', code);
        }
      });
    });

    box.querySelectorAll('.home-revoke').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        const code = btn.getAttribute('data-code') || '';
        if (!window.confirm('Davet kodu iptal edilsin mi?')) return;
        try {
          await App.Auth.revokeHomeInvite(home.id, code);
          setResult('Davet iptal edildi.', 'ok');
          await refreshDetail();
        } catch (e) {
          setResult(e.human || e.message, 'fail');
        }
      });
    });
  }

  async function renderDevices(home, canManage) {
    const box = $('homeDeviceList');
    const sel = $('homeAddDevice');
    if (!box) return;

    let rows = [];
    try { rows = await App.Auth.listBindings(); }
    catch (e) { rows = []; }

    const inHome = (rows || []).filter(function (b) { return b && b.home_id === home.id; });
    box.innerHTML = inHome.length ? inHome.map(function (b) {
      return '<div class="home-device" role="listitem">' +
        '<div class="home-device-main">' +
          '<strong>' + esc(b.label || b.device_id) + '</strong>' +
          '<small>' + esc(b.device_id) + (b.topic ? ' · ' + esc(b.topic) : '') + '</small>' +
        '</div>' +
        (canManage
          ? '<button type="button" class="btn ghost danger home-detach" data-id="' + esc(b.device_id) + '">Evden ayır</button>'
          : '') +
      '</div>';
    }).join('') : '<p class="help">Bu eve bağlı cihaz yok.</p>';

    box.querySelectorAll('.home-detach').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        const id = btn.getAttribute('data-id') || '';
        if (!window.confirm(id + ' bu evden ayrılsın mı? Cihaz hesabınızda kalır.')) return;
        try {
          await App.Auth.detachDeviceFromHome(id);
          setResult('Cihaz evden ayrıldı.', 'ok');
          await refreshDetail();
        } catch (e) {
          setResult(e.human || e.message, 'fail');
        }
      });
    });

    if (!sel) return;
    const candidates = (rows || []).filter(function (b) {
      return b && b.device_id && !b.home_id;
    });
    sel.innerHTML = candidates.length
      ? candidates.map(function (b) {
          return '<option value="' + esc(b.device_id) + '">' +
            esc(b.label || b.device_id) + '</option>';
        }).join('')
      : '<option value="">Evde bağlanmamış cihaz yok</option>';
    sel.disabled = !canManage || !candidates.length;
  }

  /* ------------------------------------------------------------- işlemler - */

  async function refresh() {
    const snap = snapshot();
    const signedOut = $('homesSignedOut');
    const signedIn = $('homesSignedIn');
    if (signedOut) signedOut.hidden = !!snap.signedIn;
    if (signedIn) signedIn.hidden = !snap.signedIn;
    if (!snap.signedIn) {
      const box = $('homeList');
      if (box) box.innerHTML = '';
      const det = $('homeDetail');
      if (det) det.hidden = true;
      return;
    }

    let homes = [];
    try { homes = await App.Auth.listHomes(); }
    catch (e) { homes = []; }

    const sig = homes.map(function (h) { return h.id + ':' + h.name + ':' + h.role; }).join('|');
    if (sig !== lastSig) {
      lastSig = sig;
      if (currentHomeId && !homes.some(function (h) { return h.id === currentHomeId; })) {
        currentHomeId = '';
      }
      if (!currentHomeId && homes.length) currentHomeId = homes[0].id;
      renderList(homes);
    }
    await refreshDetail();
  }

  async function createHome() {
    const input = $('newHomeName');
    const name = input ? input.value.trim() : '';
    if (name.length < 2) { setResult('Ev adı en az 2 karakter olmalı.', 'fail'); return; }
    busyStart(true);
    setResult('');
    try {
      const home = await App.Auth.createHome(name);
      if (input) input.value = '';
      currentHomeId = home.id;
      lastSig = '';
      setResult('Ev oluşturuldu. Şimdi aile üyelerini davet edebilirsiniz.', 'ok');
      if (App.toast) App.toast('Ev oluşturuldu', { kind: 'ok' });
      await refresh();
    } catch (e) {
      setResult(e.human || e.message, 'fail');
    } finally {
      busyStart(false);
      if (busy) busy = false;
    }
  }

  async function joinHome() {
    const input = $('homeJoinCode');
    const code = input ? input.value.trim().toUpperCase() : '';
    if (!code) { setResult('Davet kodu girin.', 'fail'); return; }
    busyStart(true);
    setResult('');
    try {
      const inv = await App.Auth.joinHomeByCode(code);
      if (input) input.value = '';
      currentHomeId = inv.home_id;
      lastSig = '';
      setResult('Eve katıldınız: ' + (inv.home_name || inv.home_id), 'ok');
      if (App.toast) App.toast('Eve katıldınız', { kind: 'ok' });
      await refresh();
    } catch (e) {
      setResult(e.human || e.message, 'fail');
    } finally {
      busyStart(false);
    }
  }

  async function createInvite() {
    const home = (App.Auth.listHomes ? await App.Auth.listHomes() : [])
      .find(function (h) { return h.id === currentHomeId; });
    if (!home) { setResult('Önce bir ev seçin.', 'fail'); return; }
    const role = ($('homeInviteRole') || {}).value || 'viewer';
    const email = (($('homeInviteEmail') || {}).value || '').trim();
    busyStart(true);
    setResult('');
    try {
      const inv = await App.Auth.createHomeInvite(home.id, role, email);
      if ($('homeInviteEmail')) $('homeInviteEmail').value = '';
      setResult('Davet oluşturuldu: ' + inv.code + ' (7 gün geçerli)', 'ok');
      try {
        await navigator.clipboard.writeText(inv.code);
        setResult('Davet oluşturuldu ve panoya kopyalandı: ' + inv.code, 'ok');
      } catch (e) { /* pano izni yoksa kodu göster */ }
      await refreshDetail();
    } catch (e) {
      setResult(e.human || e.message, 'fail');
    } finally {
      busyStart(false);
    }
  }

  async function renameHome() {
    const homes = App.Auth.listHomes ? await App.Auth.listHomes() : [];
    const home = homes.find(function (h) { return h.id === currentHomeId; });
    if (!home) return;
    const next = window.prompt('Yeni ev adı:', home.name || '');
    if (next == null) return;
    if (next.trim().length < 2) { setResult('Ev adı en az 2 karakter olmalı.', 'fail'); return; }
    busyStart(true);
    try {
      await App.Auth.renameHome(home.id, next.trim());
      lastSig = '';
      setResult('Ev adı güncellendi.', 'ok');
      await refresh();
    } catch (e) {
      setResult(e.human || e.message, 'fail');
    } finally {
      busyStart(false);
    }
  }

  async function attachDevice() {
    const sel = $('homeAddDevice');
    const id = sel ? sel.value : '';
    if (!id) { setResult('Bağlanacak cihaz seçin.', 'fail'); return; }
    busyStart(true);
    try {
      await App.Auth.assignDeviceToHome(id, currentHomeId);
      setResult(id + ' eve bağlandı.', 'ok');
      await refreshDetail();
    } catch (e) {
      setResult(e.human || e.message, 'fail');
    } finally {
      busyStart(false);
    }
  }

  async function migrateDevices() {
    if (!window.confirm('Hesabınızdaki evsiz cihazlar bu eve taşınsın mı?')) return;
    busyStart(true);
    try {
      const n = await App.Auth.migrateOwnedDevices(currentHomeId);
      setResult(n ? (n + ' cihaz eve taşındı.') : 'Taşınacak evsiz cihaz yok.', n ? 'ok' : '');
      await refreshDetail();
    } catch (e) {
      setResult(e.human || e.message, 'fail');
    } finally {
      busyStart(false);
    }
  }

  async function leaveHome() {
    if (!window.confirm('Bu evden ayrılmak istediğinize emin misiniz? Cihazlara erişiminiz kapanır.')) return;
    busyStart(true);
    try {
      await App.Auth.leaveHome(currentHomeId);
      currentHomeId = '';
      lastSig = '';
      setResult('Evden ayrıldınız.', 'ok');
      await refresh();
    } catch (e) {
      setResult(e.human || e.message, 'fail');
    } finally {
      busyStart(false);
    }
  }

  function bindButtons() {
    const pairs = [
      ['homeCreateBtn', createHome],
      ['homeJoinBtn', joinHome],
      ['homeInviteBtn', createInvite],
      ['homeRenameBtn', renameHome],
      ['homeAttachBtn', attachDevice],
      ['homeMigrateBtn', migrateDevices],
      ['homeLeaveBtn', leaveHome]
    ];
    pairs.forEach(function (p) {
      const el = $(p[0]);
      if (el) el.addEventListener('click', function () { if (!busy) p[1](); });
    });
    const join = $('homeJoinCode');
    if (join) join.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); joinHome(); }
    });
    const create = $('newHomeName');
    if (create) create.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); createHome(); }
    });
  }

  function init() {
    if (!$('homesSection')) return;
    bindButtons();
    if (App.Auth && App.Auth.onChange) App.Auth.onChange(function () { refresh(); });
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
