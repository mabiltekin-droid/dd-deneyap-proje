/* ==========================================================================
   admin-invite-ui.js — Admin davet sistemi + yönetici işlem kayıtları

   Admin kullanıcı davet kodu üretir ve paylaşır. Davet linkindeki
   "?invite=KOD" ile kayıt olan kullanıcı, davet edilen role atanır.
   Yönetici işlemleri (rol değişimi, hesap kapatma, davet...) audit_logs'a yazılır.
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});
  const $ = function (id) { return document.getElementById(id); };

  let bound = false;
  let invBusy = false;

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

  function fmtDate(ts) {
    const ms = tsMillis(ts);
    if (!ms) return '—';
    try {
      return new Date(ms).toLocaleString('tr-TR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return '—'; }
  }

  function setResult(text, kind) {
    const el = $('inviteResult');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'result' + (kind ? ' ' + kind : '');
  }

  /* -------------------------------------------------- Render --------------- */

  function renderInvites(invites) {
    const body = $('invitesTableBody');
    if (!body) return;

    const chip = $('pendingInvitesChip');
    if (chip) {
      const pending = (invites || []).filter(function (i) { return !i.used; }).length;
      chip.textContent = pending + ' bekliyor';
      chip.dataset.state = pending ? 'normal' : 'unknown';
    }

    if (!invites || !invites.length) {
      body.innerHTML = '<tr><td colspan="6">Henüz davet yok.</td></tr>';
      return;
    }

    body.innerHTML = invites.map(function (inv) {
      const expired = inv.expires_at_ms && Date.now() > inv.expires_at_ms && !inv.used;
      const durum = inv.used
        ? '<span class="badge ok">Kullanıldı</span>'
        : (expired ? '<span class="badge err">Süresi doldu</span>' : '<span class="badge warn">Bekliyor</span>');
      return '<tr data-code="' + esc(inv.code) + '">' +
        '<td><code>' + esc(inv.code) + '</code></td>' +
        '<td>' + esc(inv.email || '—') + '</td>' +
        '<td><span class="badge ' + (inv.role === 'admin' ? 'warn' : '') + '">' + esc(inv.role) + '</span></td>' +
        '<td>' + esc(fmtDate(inv.created_at_ms || inv.created_at)) + '</td>' +
        '<td>' + durum + '</td>' +
        '<td>' +
          '<button class="btn sm ghost copy-invite" type="button" data-code="' + esc(inv.code) + '">Kopyala</button> ' +
          (!inv.used ? '<button class="btn sm ghost revoke-invite" type="button" data-code="' + esc(inv.code) + '">İptal</button>' : '') +
        '</td>' +
        '</tr>';
    }).join('');
  }

  async function loadInvites() {
    try {
      const invites = await App.Auth.listInvites();
      renderInvites(invites);
    } catch (e) {
      const body = $('invitesTableBody');
      if (body) body.innerHTML = '<tr><td colspan="6">Yüklenemedi: ' + esc(e.human || e.message) + '</td></tr>';
    }
  }

  async function loadAudit() {
    const body = $('auditTableBody');
    if (!body) return;
    try {
      const logs = await App.Auth.listAuditLogs(30);
      if (!logs || !logs.length) {
        body.innerHTML = '<tr><td colspan="4">Kayıt yok.</td></tr>';
        return;
      }
      body.innerHTML = logs.map(function (l) {
        const detail = l.detail ? JSON.stringify(l.detail) : '';
        return '<tr>' +
          '<td>' + esc(fmtDate(l.timestamp)) + '</td>' +
          '<td>' + esc(l.action || '—') + '</td>' +
          '<td>' + esc(l.actor_email || l.actor || '—') + '</td>' +
          '<td>' + esc((l.target || '') + (detail ? ' ' + detail : '')) + '</td>' +
          '</tr>';
      }).join('');
    } catch (e) {
      body.innerHTML = '<tr><td colspan="4">Yüklenemedi: ' + esc(e.human || e.message) + '</td></tr>';
    }
  }

  /* -------------------------------------------------- Actions ------------- */

  function inviteLink(code) {
    const base = location.href.split('#')[0].split('?')[0].replace(/settings\.html$/, 'index.html');
    return base + '?invite=' + code;
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* yoksay */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  async function createInvite() {
    if (invBusy) return;
    const email = ($('inviteEmail') || {}).value || '';
    const role = ($('inviteRole') || {}).value || 'user';
    if (!email.trim()) { setResult('E-posta girin.', 'err'); return; }

    const snap = App.Auth.snapshot();
    if (!snap.isAdmin) { setResult('Bu işlem için admin yetkisi gerekli.', 'err'); return; }

    invBusy = true;
    const btn = $('createInviteBtn');
    if (btn) btn.disabled = true;
    setResult('Davet oluşturuluyor…');
    try {
      const inv = await App.Auth.createInvite(email.trim(), role, snap.user && snap.user.id);
      const link = inviteLink(inv.code);
      const copied = await copyText(link);
      setResult('Davet oluşturuldu: ' + inv.code + ' — ' + (copied ? 'bağlantı kopyalandı.' : link), 'ok');
      const ef = $('inviteEmail'); if (ef) ef.value = '';
      await loadInvites();
      if (App.sound && App.sound.chime) App.sound.chime();
      if (App.haptic) App.haptic(30);
    } catch (e) {
      setResult('Oluşturulamadı: ' + (e.human || e.message), 'err');
    } finally {
      invBusy = false;
      if (btn) btn.disabled = false;
    }
  }

  async function onInviteClick(e) {
    const copy = e.target.closest('.copy-invite');
    if (copy) {
      const ok = await copyText(inviteLink(copy.dataset.code));
      setResult(ok ? 'Bağlantı kopyalandı.' : 'Kopyalanamadı.', ok ? 'ok' : 'err');
      return;
    }
    const rev = e.target.closest('.revoke-invite');
    if (rev) {
      if (!confirm('Bu davet iptal edilsin mi? Kod geçersiz olacak.')) return;
      try {
        await App.Auth.revokeInvite(rev.dataset.code);
        setResult('Davet iptal edildi.', 'ok');
        await loadInvites();
      } catch (err) {
        setResult('İptal edilemedi: ' + (err.human || err.message), 'err');
      }
    }
  }

  /* -------------------------------------------------- Init --------------- */

  function renderVisibility(snap) {
    const card = $('inviteCard');
    if (card) card.hidden = !snap.isAdmin;
    const nav = $('navInvites');
    if (nav) nav.hidden = !snap.isAdmin;
  }

  function init() {
    const card = $('inviteCard');
    if (!card || bound) return;
    bound = true;

    if ($('createInviteBtn')) $('createInviteBtn').addEventListener('click', createInvite);
    if ($('invitesTableBody')) $('invitesTableBody').addEventListener('click', onInviteClick);

    App.Auth.onChange(function (snap) {
      renderVisibility(snap);
      if (snap.isAdmin && !snap.setupRequired) {
        loadInvites();
        loadAudit();
      }
    });

    const snap = App.Auth.snapshot();
    renderVisibility(snap);
    if (snap.isAdmin) { loadInvites(); loadAudit(); }
  }

  window.App.initInvites = init;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
