/* ==========================================================================
   emergency.js — Acil durum e-posta kişileri
   --------------------------------------------------------------------------
   Kullanıcı Ayarlar sayfasından yakınlarına ait e-posta adreslerini ekler.
   Alarm anında sunucu (api/push.js) bu listeye e-posta gönderir.

   Kişiler Firestore'da `emergency_contacts` koleksiyonunda tutulur ve
   yalnızca hesap sahibi tarafından okunabilir/yazılabilir.
   ========================================================================== */

(function () {
  'use strict';

  var App = window.App;
  if (!App) return;

  var uid = '';
  var contacts = [];
  var busy = false;

  function $(id) { return document.getElementById(id); }

  function currentUid() {
    try {
      var s = App.Auth && App.Auth.snapshot ? App.Auth.snapshot() : null;
      return (s && s.signedIn && s.user && s.user.id) || '';
    } catch (e) { return ''; }
  }

  function status(text, kind) {
    var el = $('emStatus');
    if (!el) {
      if (text && App.toast) App.toast(text, { kind: kind || 'ok' });
      return;
    }
    el.textContent = text || '';
    el.dataset.kind = kind || '';
  }

  function setBusy(value) {
    busy = !!value;
    var add = $('emAddBtn');
    var test = $('emTestBtn');
    if (add) add.disabled = busy;
    if (test) test.disabled = busy || !contacts.length;
  }

  function humanError(e) {
    if (!e) return 'Bilinmeyen hata.';
    return e.human || e.message || 'İşlem tamamlanamadı.';
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function render() {
    var list = $('emList');
    var empty = $('emEmpty');
    var count = $('emCount');
    if (!list) return;

    list.textContent = '';
    if (count) {
      count.textContent = contacts.length
        ? contacts.length + ' kişi'
        : 'Henüz kişi yok';
    }
    if (empty) empty.hidden = contacts.length > 0;

    contacts.forEach(function (c) {
      var row = el('div', 'em-item');

      var main = el('div', 'em-main');
      main.appendChild(el('strong', '', c.name || c.email));
      main.appendChild(el('span', '', c.email));
      if (c.enabled === false) {
        main.appendChild(el('span', 'em-off', 'kapalı'));
      }

      var toggle = el('label', 'em-toggle');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = c.enabled !== false;
      cb.setAttribute('aria-label', (c.name || c.email) + ' aktif');
      cb.addEventListener('change', function () {
        save(Object.assign({}, c, { enabled: cb.checked }));
      });
      toggle.appendChild(cb);
      toggle.appendChild(el('span', '', 'Aktif'));

      var del = el('button', 'btn sm ghost em-del', 'Sil');
      del.type = 'button';
      del.addEventListener('click', function () { remove(c); });

      row.appendChild(main);
      row.appendChild(toggle);
      row.appendChild(del);
      list.appendChild(row);
    });

    setBusy(busy);
    var test = $('emTestBtn');
    if (test) test.disabled = busy || !contacts.length;
  }

  async function load() {
    uid = currentUid();
    if (!uid) {
      contacts = [];
      render();
      status('Acil durum kişileri için önce hesabınıza giriş yapın.', 'warn');
      return;
    }
    if (!App.FB || typeof App.FB.listEmergencyContacts !== 'function') {
      status('Firebase yapılandırması bulunamadı.', 'danger');
      return;
    }

    status('Kişiler yükleniyor…');
    try {
      contacts = await App.FB.listEmergencyContacts(uid);
      render();
      status(contacts.length
        ? 'Alarm anında bu adreslere e-posta gönderilir.'
        : 'Henüz acil durum kişisi eklenmedi.', contacts.length ? 'ok' : '');
    } catch (e) {
      contacts = [];
      render();
      status('Kişiler yüklenemedi: ' + humanError(e), 'danger');
    }
  }

  async function save(contact) {
    if (!uid) {
      status('Önce hesabınıza giriş yapın.', 'warn');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await App.FB.saveEmergencyContact(uid, contact);
      await load();
      status(contact.id ? 'Kişi güncellendi.' : 'Kişi eklendi.', 'ok');
    } catch (e) {
      status('Kaydedilemedi: ' + humanError(e), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    var nameEl = $('emContactName');
    var emailEl = $('emContactEmail');
    var email = emailEl ? emailEl.value.trim().toLowerCase() : '';
    var name = nameEl ? nameEl.value.trim() : '';

    if (!email) {
      status('E-posta adresi gerekli.', 'warn');
      if (emailEl) emailEl.focus();
      return;
    }
    if (contacts.some(function (c) { return c.email === email; })) {
      status('Bu e-posta zaten listede.', 'warn');
      return;
    }
    if (contacts.length >= 20) {
      status('En fazla 20 acil durum kişisi eklenebilir.', 'warn');
      return;
    }

    await save({ name: name, email: email, enabled: true });
    if (nameEl) nameEl.value = '';
    if (emailEl) emailEl.value = '';
    if (nameEl) nameEl.focus();
  }

  async function remove(contact) {
    if (!uid || busy) return;
    if (!window.confirm((contact.name || contact.email) + ' acil durum listesinden silinsin mi?')) {
      return;
    }
    setBusy(true);
    try {
      await App.FB.deleteEmergencyContact(uid, contact.id);
      await load();
      status('Kişi silindi.', 'ok');
    } catch (e) {
      status('Silinemedi: ' + humanError(e), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (!uid) {
      status('Önce hesabınıza giriş yapın.', 'warn');
      return;
    }
    if (!contacts.length) {
      status('Önce en az bir acil durum kişisi ekleyin.', 'warn');
      return;
    }
    if (busy) return;

    setBusy(true);
    status('Test e-postası gönderiliyor…');
    try {
      var token = await App.FB.token();
      if (!token) {
        status('Oturum süresi dolmuş. Tekrar giriş yapın.', 'warn');
        return;
      }
      var res = await fetch('/api/notify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ emailTest: true })
      });
      var body = null;
      try { body = await res.json(); } catch (e) { body = null; }

      if (!res.ok) {
        var msg = (body && body.error) || ('HTTP ' + res.status);
        status('Gönderilemedi: ' + msg, res.status === 503 ? 'warn' : 'danger');
        return;
      }
      var sent = Number(body && body.email && body.email.sent) || 0;
      var targeted = Number(body && body.email && body.email.targeted) || 0;
      status(sent + '/' + targeted + ' kişiye test e-postası gönderildi.', sent ? 'ok' : 'warn');
    } catch (e) {
      status('Ağ hatası: ' + humanError(e), 'danger');
    } finally {
      setBusy(false);
    }
  }

  function bind() {
    var addBtn = $('emAddBtn');
    if (addBtn) addBtn.addEventListener('click', function (e) { e.preventDefault(); add(); });

    var form = $('emForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        add();
      });
    }

    var testBtn = $('emTestBtn');
    if (testBtn) testBtn.addEventListener('click', test);

    var emailEl = $('emContactEmail');
    if (emailEl) {
      emailEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          add();
        }
      });
    }

    try {
      if (App.Auth && App.Auth.onChange) {
        App.Auth.onChange(function (snap) {
          var next = (snap && snap.signedIn && snap.user && snap.user.id) || '';
          if (next !== uid) load();
        });
      }
    } catch (e) { /* yoksay */ }
  }

  function boot() {
    if (!$('emergencySection')) return;
    bind();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  App.Emergency = {
    load: load,
    contacts: function () { return contacts.slice(); },
    add: add,
    test: test
  };
})();
