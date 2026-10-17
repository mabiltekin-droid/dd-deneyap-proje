/* ==========================================================================
   events.js — Olay Günlüğü & Alarm Geçmişi

   Amaç: Gaz, alev, sarsıntı, su baskını, sensör arızası ve bağlantı
   kesilmesi gibi olayları ZAMAN DAMGALI olarak kaydetmek; panelde ve
   ayarlar sayfasında (admin) listelemek.

   İki katman:
     • YEREL (localStorage): her zaman çalışır; tarayıcıda saklanır.
     • BULUT (Firestore alarm_events): yalnızca giriş yapılmışsa ve cihaz
       kullanıcıya görünüyorsa yazılır. Başka hesabın olayları asla
       karıştırılmaz (her kayda sahip uid iliştirilir).

   Not: Olaylar panel AÇIKKEN tespit edilip kaydedilir. Cihazın kendi
   RAM geçmişi (history.js) ham telemetriyi tutar; bu modül ise okunabilir
   olay kayıtları üretir.
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});
  const $ = function (id) { return document.getElementById(id); };

  const KEY = 'deneyap.events.v1';
  const STATE_KEY = 'deneyap.events.state.v1';
  const MAX = 400;          /* yerel halka tampon kapasitesi */
  const CLOUD_LIMIT = 200;  /* kendi olaylarımı çekerken üst sınır */

  /* ------------------------------------------------------ olay türleri --- */

  const TYPE = {
    flame:   { label: 'Alev / Yangın',        sev: 'danger', group: 'flame'  },
    gas:     { label: 'Gaz Kaçağı',           sev: 'danger', group: 'gas'    },
    vib:     { label: 'Sarsıntı / Kurcalama', sev: 'danger', group: 'vib'    },
    flood:   { label: 'Su Baskını',           sev: 'danger', group: 'flood'  },
    gaswarn: { label: 'Gaz Yoğunluğu',        sev: 'warn',   group: 'gas'    },
    sensor:  { label: 'Sensör Arızası',       sev: 'warn',   group: 'system' },
    offline: { label: 'Bağlantı Kesildi',     sev: 'warn',   group: 'system' },
    online:  { label: 'Bağlantı Kuruldu',     sev: 'ok',     group: 'system' },
    boot:    { label: 'Cihaz Yeniden Başladı', sev: 'info',  group: 'system' },
    system:  { label: 'Sistem',               sev: 'info',   group: 'system' }
  };

  const ICONS = {
    flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c1 3 4 5.5 5.5 8.5a7 7 0 1 1-13 3.5c0-4 3.5-7.5 5-10.5.5 2 2 3 2.5 3 .5-.5 1-2.5 0-4.5Z"/></svg>',
    gas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A3.5 3.5 0 0 0 12 18a3.5 3.5 0 0 0 3.5-3.5c0-2-1.5-3-2-4.5-.5 1.5-1.5 2-1.5 2s-.5-1.5-1-2.5c-.8 1.5-2.5 3-2.5 5Z"/><path d="M17.5 6.5a7 7 0 0 0-11 0"/></svg>',
    vib: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h3l2-7 3 14 2.5-9 2 5h3.5"/></svg>',
    flood: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7s6 6.3 6 10.3a6 6 0 0 1-12 0c0-4 6-10.3 6-10.3Z"/></svg>',
    gaswarn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    sensor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M9 2v2M20 15h2M20 9h2M9 20v2M15 20v2M2 9h2M2 15h2"/></svg>',
    offline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.55a11 11 0 0 1 4.2-2.36M1.42 9a16 16 0 0 1 6.1-4.3"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
    online: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
    boot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/></svg>',
    system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  /* ------------------------------------------------------------ yardımcı -- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function meta(type) { return TYPE[type] || TYPE.system; }

  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function me() {
    try {
      const s = App.Auth && App.Auth.snapshot ? App.Auth.snapshot() : null;
      return (s && s.user && s.user.id) || null;
    } catch (e) { return null; }
  }

  function fmtFull(at) {
    try {
      return new Date(at).toLocaleString('tr-TR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch (e) { return '—'; }
  }

  function fmtClock(at) {
    try {
      return new Date(at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return '—'; }
  }

  /* -------------------------------------------------------- yerel depo ---- */

  function readLocal() {
    try {
      const a = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (!Array.isArray(a)) return [];
      /* Her zaman en yeni olay en üstte */
      return a.sort(function (x, y) { return (y.at || 0) - (x.at || 0); });
    } catch (e) { return []; }
  }

  function writeLocal(arr) {
    try {
      if (arr.length > MAX) arr = arr.slice(0, MAX);  /* yeniden eskiye saklanır */
      localStorage.setItem(KEY, JSON.stringify(arr));
    } catch (e) { /* kota dolu — sessiz geç */ }
  }

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function saveState(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) { /* yoksay */ }
  }

  /* ------------------------------------------------------------- kayıt --- */

  function record(type, dev, msg, opts) {
    opts = opts || {};
    const m = meta(type);
    const ev = {
      id: opts.id || newId(),
      at: Number(opts.at) || Date.now(),
      dev: dev || lastDev || '',
      type: type,
      sev: opts.sev || m.sev,
      msg: msg || m.label,
      owner: opts.owner !== undefined ? opts.owner : me(),
      syn: !!opts.syn
    };
    const arr = readLocal();
    arr.unshift(ev);
    writeLocal(arr);
    cloudWrite(ev);
    renderAll();
    return ev;
  }

  async function cloudWrite(ev) {
    if (!ev || ev.syn) return;
    if (!App.Auth || !App.Auth.logEvent) return;
    const mine = me();
    if (!mine || ev.owner !== mine) return;   /* yalnızca kendi olayımı buluta yaz */
    if (ev.dev && App.Auth.canView && !App.Auth.canView(ev.dev)) return;
    try {
      await App.Auth.logEvent({
        dev: ev.dev, type: ev.type, severity: ev.sev,
        message: ev.msg, at: ev.at, local_id: ev.id
      });
      markSynced(ev.id);
    } catch (e) { /* çevrimdışı; syncPending() sonra dener */ }
  }

  function markSynced(id) {
    const arr = readLocal();
    let changed = false;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].id === id && !arr[i].syn) { arr[i].syn = true; changed = true; break; }
    }
    if (changed) { writeLocal(arr); renderAll(); }
  }

  /* Bulutta bekleyen (syn=false) kendi olaylarımı yükler. */
  async function syncPending() {
    const mine = me();
    if (!mine || !App.Auth || !App.Auth.logEvent) return;
    const arr = readLocal();
    const pending = arr.filter(function (e) { return !e.syn && e.owner === mine; }).reverse();
    if (!pending.length) return;
    let any = false;
    for (let i = 0; i < pending.length; i++) {
      const e = pending[i];
      if (e.dev && App.Auth.canView && !App.Auth.canView(e.dev)) continue;
      try {
        await App.Auth.logEvent({
          dev: e.dev, type: e.type, severity: e.sev,
          message: e.msg, at: e.at, local_id: e.id
        });
        e.syn = true; any = true;
      } catch (err) { break; }
    }
    if (any) { writeLocal(arr); renderAll(); }
  }

  /* Buluttan kendi olaylarımı çeker, yerelde olmayanları ekler. */
  async function pullMine() {
    const mine = me();
    if (!mine || !App.Auth || !App.Auth.listMyEvents) return;
    let rows;
    try { rows = await App.Auth.listMyEvents(CLOUD_LIMIT); }
    catch (e) { return; }
    if (!Array.isArray(rows) || !rows.length) return;

    const arr = readLocal();
    const have = {};
    arr.forEach(function (e) {
      have[e.id] = true;
      if (e.cloudId) have[e.cloudId] = true;
    });
    let added = 0;
    rows.forEach(function (r) {
      const localKey = r.local_id || ('c' + r.id);
      if (have[localKey] || have[r.id]) return;
      arr.push({
        id: localKey,
        cloudId: r.id,
        at: Number(r.at) || 0,
        dev: r.dev || '',
        type: r.type || 'system',
        sev: r.severity || meta(r.type).sev,
        msg: r.message || meta(r.type).label,
        owner: r.owner_id || mine,
        syn: true
      });
      added += 1;
    });
    if (added) {
      arr.sort(function (a, b) { return b.at - a.at; });
      writeLocal(arr);
      renderAll();
    }
  }

  /* --------------------------------------------------- olay tespiti ------ */

  let lastDev = '';
  let prev = null;      /* localStorage'dan yüklenir */
  let onlineKnown = null;

  function note(data, state) {
    if (!data) return;
    const dev = data.dev || '';
    if (dev) lastDev = dev;

    if (prev === null) prev = loadState() || {};

    const ppm = Math.round(Number(data.gasPpm) || 0);
    const cur = {
      danger: state === 'danger',
      warn: state === 'warning' && state !== 'danger',
      flood: !!data.flood,
      vib: !!data.vib,
      flame: !!data.flame,
      sensor: !!data.gasFault,
      uptime: (typeof data.uptime === 'number') ? data.uptime : prev.uptime
    };

    if (data.flame && !prev.flame) {
      record('flame', dev, 'Alev (yangın) algılandı. Siren çaldı, pencere kapatıldı; fan ve su motoru durduruldu.');
    }
    if (data.vib && !prev.vib) {
      record('vib', dev, 'Sarsıntı / kurcalama algılandı. Siren çaldı ve pencere kapatıldı.');
    }
    if (data.flood && !prev.flood) {
      record('flood', dev, 'Su sensörü ıslaklık (su baskını) algıladı. Pencere kapatıldı.');
    }
    if (cur.danger && !prev.danger) {
      record('gas', dev, 'Gaz konsantrasyonu TEHLİKE eşiğini aştı (' + ppm + ' PPM). Fan tam güçte, motor kilitli.');
    } else if (cur.warn && !prev.warn && !cur.danger) {
      record('gaswarn', dev, 'Gaz yoğunluğu uyarı eşiğini aştı (' + ppm + ' PPM). Ortamı havalandırın.');
    }
    if (cur.sensor && !prev.sensor) {
      record('sensor', dev, 'Gaz sensörü ölçüm arızası / kalibrasyon uyarısı.');
    }
    if (typeof data.uptime === 'number' && typeof prev.uptime === 'number'
        && prev.uptime > 30000 && data.uptime < prev.uptime - 15000) {
      record('boot', dev, 'Cihaz yeniden başladı (açılış algılandı).');
    }

    prev = cur;
    saveState(cur);
  }

  /* Bağlantı durumu geçişlerini kaydeder (app.js markOnline/markOffline). */
  function setOnline(isOnline, reason) {
    if (onlineKnown === null) { onlineKnown = !!isOnline; return; }  /* ilk durumu kaydetme */
    if (onlineKnown === !!isOnline) return;
    onlineKnown = !!isOnline;
    if (isOnline) {
      record('online', lastDev, 'Cihaz bağlantısı kuruldu.');
    } else {
      record('offline', lastDev, 'Cihaz bağlantısı kesildi' + (reason ? ' (' + reason + ')' : '') + '.');
    }
  }

  /* -------------------------------------------------------- görünüm ------ */

  let filter = 'all';
  let cloudAll = [];

  function groupMatches(e) {
    if (filter === 'all') return true;
    return meta(e.type).group === filter;
  }

  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function itemHtml(e) {
    const m = meta(e.type);
    const dev = e.dev ? esc(e.dev) : 'yerel';
    return '<li class="ev-item" data-sev="' + m.sev + '">' +
      '<span class="ev-ico" aria-hidden="true">' + (ICONS[e.type] || ICONS.system) + '</span>' +
      '<div class="ev-body">' +
        '<div class="ev-top">' +
          '<span class="ev-type">' + esc(m.label) + '</span>' +
          '<time class="ev-time" datetime="' + new Date(e.at).toISOString() + '">' + fmtFull(e.at) + '</time>' +
        '</div>' +
        '<p class="ev-msg">' + esc(e.msg) + '</p>' +
        '<span class="ev-meta">' + dev +
          (e.syn ? ' · <span class="ev-cloud">bulutta</span>' : ' · <span class="ev-unsyn">yerel</span>') +
        '</span>' +
      '</div>' +
    '</li>';
  }

  function renderIndex() {
    const list = $('eventList');
    if (!list) return;

    const all = readLocal();
    const today = startOfToday();
    const counts = { all: all.length, today: 0, gas: 0, flame: 0, vib: 0, flood: 0, system: 0 };
    all.forEach(function (e) {
      if (e.at >= today) counts.today += 1;
      const g = meta(e.type).group;
      if (counts[g] !== undefined) counts[g] += 1;
    });

    setCount('evCountAll', counts.all);
    setCount('evCountToday', counts.today);
    setCount('evCountGas', counts.gas);
    setCount('evCountFlame', counts.flame);
    setCount('evCountVib', counts.vib);
    setCount('evCountFlood', counts.flood);
    setCount('evCountSystem', counts.system);

    const chip = $('evChip');
    if (chip) {
      chip.dataset.state = counts.today > 0 ? 'normal' : 'unknown';
      chip.textContent = counts.today + ' bugün';
    }

    document.querySelectorAll('[data-evfilter]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-evfilter') === filter);
    });

    const items = all.filter(groupMatches).slice(0, 120);
    const empty = $('evEmpty');
    if (!items.length) {
      list.innerHTML = '';
      if (empty) { empty.hidden = false; }
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = items.map(itemHtml).join('');
  }

  function setCount(id, n) {
    const el = $(id);
    if (el) el.textContent = String(n);
  }

  /* ------------------------------------------------------ admin görünüm -- */

  async function loadAdminEvents() {
    const body = $('eventTableBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="5">Yükleniyor…</td></tr>';
    try {
      const rows = await App.Auth.listAllEvents(300);
      cloudAll = Array.isArray(rows) ? rows.slice() : [];
      renderAdmin();
    } catch (e) {
      const msg = (App.FB && App.FB.human) ? App.FB.human(e) : (e && e.message) || 'Hata';
      body.innerHTML = '<tr><td colspan="5">Yüklenemedi: ' + esc(msg) + '</td></tr>';
    }
  }

  function renderAdmin() {
    const body = $('eventTableBody');
    if (!body) return;
    const rows = cloudAll.slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    const chip = $('adminEventChip');
    if (chip) { chip.dataset.state = rows.length ? 'normal' : 'unknown'; chip.textContent = rows.length + ' kayıt'; }
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5">Kayıt yok.</td></tr>';
      return;
    }
    body.innerHTML = rows.slice(0, 250).map(function (r) {
      const m = meta(r.type);
      const who = r.owner_id ? String(r.owner_id).slice(0, 8) + '…' : '—';
      return '<tr>' +
        '<td class="u-date">' + esc(fmtFull(Number(r.at) || 0)) + '</td>' +
        '<td class="d-id">' + esc(r.dev || '—') + '</td>' +
        '<td><span class="ev-tag" data-sev="' + m.sev + '">' + esc(m.label) + '</span></td>' +
        '<td class="ev-amsg">' + esc(r.message || '') + '</td>' +
        '<td class="d-act"><button class="btn sm ghost" type="button" data-evdel="' + esc(r.id) + '">Sil</button></td>' +
      '</tr>';
    }).join('');
  }

  /* --------------------------------------------------------- eylemler ---- */

  function exportCsv() {
    const rows = readLocal();
    const head = ['Zaman', 'Cihaz', 'Tur', 'Onem', 'Mesaj'];
    const lines = [head.join(';')];
    rows.forEach(function (e) {
      const m = meta(e.type);
      const vals = [
        new Date(e.at).toISOString(),
        e.dev || '',
        m.label,
        e.sev || m.sev,
        e.msg || ''
      ].map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; });
      lines.push(vals.join(';'));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deneyap-olay-gunlugu-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    if (App.toast) App.toast(rows.length + ' olay CSV olarak indirildi.', { kind: 'ok' });
  }

  function clearLocalAsk() {
    if (!window.confirm('Yerel olay günlüğü temizlensin mi? (Bulut kayıtları silinmez.)')) return;
    writeLocal([]);
    renderAll();
    if (App.toast) App.toast('Yerel olay günlüğü temizlendi.', { kind: 'ok' });
  }

  async function clearCloudAsk() {
    if (!window.confirm('TÜM cihazların bulut olay kayıtları silinsin mi? Bu işlem geri alınamaz.')) return;
    try {
      const n = await App.Auth.clearAllEvents();
      cloudAll = [];
      renderAdmin();
      if (App.toast) App.toast(n + ' bulut kaydı silindi.', { kind: 'ok' });
    } catch (e) {
      if (App.toast) App.toast('Silinemedi: ' + ((App.FB && App.FB.human) ? App.FB.human(e) : e.message), { kind: 'danger' });
    }
  }

  async function deleteCloudEvent(id) {
    try {
      await App.Auth.deleteEvent(id);
      cloudAll = cloudAll.filter(function (r) { return r.id !== id; });
      renderAdmin();
    } catch (e) {
      if (App.toast) App.toast('Silinemedi.', { kind: 'danger' });
    }
  }

  /* --------------------------------------------------------- bağlama ----- */

  function renderAll() {
    renderIndex();
    if (App.Auth && App.Auth.isAdmin && App.Auth.isAdmin() && $('eventTableBody')) renderAdmin();
  }

  function bindUi() {
    document.querySelectorAll('[data-evfilter]').forEach(function (b) {
      b.addEventListener('click', function () {
        filter = b.getAttribute('data-evfilter') || 'all';
        if (App.haptic) App.haptic(10);
        renderIndex();
      });
    });

    const exp = $('evExportBtn');
    if (exp) exp.addEventListener('click', exportCsv);
    const clr = $('evClearBtn');
    if (clr) clr.addEventListener('click', clearLocalAsk);
    const ref = $('evRefreshBtn');
    if (ref) ref.addEventListener('click', function () {
      Promise.all([syncPending(), pullMine()]).then(renderIndex);
    });

    const aref = $('adminEventRefresh');
    if (aref) aref.addEventListener('click', loadAdminEvents);
    const aclear = $('adminEventClear');
    if (aclear) aclear.addEventListener('click', clearCloudAsk);

    const tbody = $('eventTableBody');
    if (tbody) {
      tbody.addEventListener('click', function (e) {
        const btn = e.target && e.target.closest ? e.target.closest('[data-evdel]') : null;
        if (btn) deleteCloudEvent(btn.getAttribute('data-evdel'));
      });
    }
  }

  function init() {
    const hasUi = $('eventList') || $('eventTableBody');
    if (!hasUi) return;
    prev = loadState() || {};
    bindUi();
    renderIndex();

    if (App.Auth && App.Auth.onChange) {
      App.Auth.onChange(function () {
        syncPending();
        pullMine();
        if (App.Auth.isAdmin && App.Auth.isAdmin() && $('eventTableBody')) loadAdminEvents();
        else renderAll();
      });
    }

    /* Açılışta kısa gecikmeyle buluttan tazele */
    setTimeout(function () {
      syncPending();
      pullMine();
    }, 1500);
  }

  App.Events = {
    init: init,
    note: note,
    setOnline: setOnline,
    record: record,
    list: readLocal,
    exportCsv: exportCsv,
    clearLocal: function () { writeLocal([]); renderAll(); },
    syncPending: syncPending,
    pullMine: pullMine,
    loadAdminEvents: loadAdminEvents,
    TYPE: TYPE
  };

  /* Dashboard (app.js) yüklendiğinde otomatik başlat */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
