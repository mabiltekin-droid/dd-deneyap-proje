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
    mode:    { label: 'Mod Değişikliği',      sev: 'info',   group: 'system' },
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
    mode: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/></svg>',
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

  function canReadLocalEvent(event, owner) {
    if (!owner) {
      return !event.owner && !!event.dev && !!(App.Auth && App.Auth.canView && App.Auth.canView(event.dev));
    }
    if (event.owner === owner) return true;
    return !!(event.home && App.Auth && App.Auth.canViewHome && App.Auth.canViewHome(event.home));
  }

  function readVisible() {
    const owner = me();
    return readLocal().filter(function (event) { return canReadLocalEvent(event, owner); });
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

  const writesInProgress = new Set();

  async function cloudWrite(ev) {
    if (!ev || ev.syn) return true;
    if (!App.Auth || !App.Auth.logEvent) return;
    const mine = me();
    if (!mine || ev.owner !== mine) return;   /* yalnızca kendi olayımı buluta yaz */
    if (ev.dev && App.Auth.canView && !App.Auth.canView(ev.dev)) return;
    if (writesInProgress.has(ev.id)) return;
    writesInProgress.add(ev.id);
    try {
      const id = await App.Auth.logEvent({
        dev: ev.dev, type: ev.type, severity: ev.sev,
        message: ev.msg, at: ev.at, local_id: ev.id
      });
      if (id) markSynced(ev.id);
      return true;
    } catch (e) { return false; /* çevrimdışı; syncPending() sonra dener */ }
    finally { writesInProgress.delete(ev.id); }
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
    for (let i = 0; i < pending.length; i++) {
      if (me() !== mine) break;
      if (await cloudWrite(pending[i]) === false) break;
    }
  }

  /* Buluttan kendi olaylarımı çeker, yerelde olmayanları ekler. */
  async function pullMine() {
    const mine = me();
    if (!mine || !App.Auth || !App.Auth.listMyEvents) return;
    let rows;
    try { rows = await App.Auth.listMyEvents(CLOUD_LIMIT); }
    catch (e) { return; }
    if (me() !== mine || !Array.isArray(rows) || !rows.length) return;

    const arr = readLocal();
    const have = new Map();
    arr.forEach(function (e) {
      if (e.id) have.set(e.id, e);
      if (e.cloudId) have.set(e.cloudId, e);
    });
    let changed = false;
    rows.forEach(function (r) {
      const localKey = r.local_id || ('c' + r.id);
      const record = {
        id: localKey,
        cloudId: r.id,
        at: Number(r.at) || 0,
        dev: r.dev || '',
        type: r.type || 'system',
        sev: r.severity || meta(r.type).sev,
        msg: r.message || meta(r.type).label,
        owner: r.owner_id || mine,
        home: r.home_id || '',
        syn: true
      };
      if (!canReadLocalEvent(record, mine)) return;
      const existing = have.get(r.id) || have.get(localKey);
      if (existing && existing.owner === record.owner) {
        if (existing.home !== record.home || existing.cloudId !== record.cloudId || !existing.syn) {
          Object.assign(existing, record);
          changed = true;
        }
        return;
      }
      arr.push(record);
      changed = true;
    });
    if (changed) {
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
      /* Sistem bildirimi (tercih kapalıysa App.notify sessizce atlar). */
      if (App.notify && App.notify.alarm) {
        try {
          App.notify.alarm('offline', 'Cihaz Bağlantısı Kesildi',
            'Deneyap Kart yanıt vermiyor' + (reason ? ' (' + reason + ')' : '') + '.');
        } catch (e) { /* bildirim hatası günlüğü bozmasın */ }
      }
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

    const all = readVisible();
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
      const active = b.getAttribute('data-evfilter') === filter;
      b.classList.toggle('active', active);
      b.classList.toggle('primary', active);
      b.setAttribute('aria-pressed', String(active));
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
    const owner = me();
    if (!body || !owner || !App.Auth.isAdmin()) return;
    body.innerHTML = '<tr><td colspan="5">Yükleniyor…</td></tr>';
    try {
      const rows = await App.Auth.listAllEvents(300);
      if (owner !== me() || !App.Auth.isAdmin()) return;
      cloudAll = Array.isArray(rows) ? rows.slice() : [];
      renderAdmin();
    } catch (e) {
      if (owner !== me() || !App.Auth.isAdmin()) return;
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
    const rows = readVisible();
    if (!rows.length) {
      if (App.toast) App.toast('İndirmek için henüz olay kaydı yok.', { kind: 'warn' });
      return;
    }
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

  /* ------------------------------------------------------ PDF rapor ----
     Android uygulamasında PDF'i native taraf çizer (Türkçe karakterler ve
     paylaşım sayfası sorunsuz). Tarayıcıda yazdırma penceresi açılır:
     kullanıcı "PDF olarak kaydet" seçebilir. */
  function pdfModel() {
    const rows = readVisible().slice(0, 1000);
    const tr = function (ms) {
      try {
        return new Date(ms).toLocaleString('tr-TR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });
      } catch (e) { return ''; }
    };

    let critical = 0;
    let warning = 0;
    const devices = {};
    rows.forEach(function (e) {
      const m = meta(e.type);
      const sev = e.sev || m.sev;
      if (sev === 'danger') critical += 1;
      else if (sev === 'warn') warning += 1;
      if (e.dev) devices[e.dev] = true;
    });

    const times = rows.map(function (e) { return Number(e.at) || 0; }).filter(Boolean);
    const first = times.length ? Math.min.apply(null, times) : Date.now();
    const last = times.length ? Math.max.apply(null, times) : Date.now();

    const sevLabel = { danger: 'Kritik', warn: 'Uyarı', info: 'Bilgi' };

    return {
      title: 'Deneyap Ev Koruma — Olay Raporu',
      range: tr(first) + ' – ' + tr(last),
      generated: tr(Date.now()),
      summary: [
        { label: 'Toplam olay', value: String(rows.length) },
        { label: 'Kritik', value: String(critical) },
        { label: 'Uyarı', value: String(warning) },
        { label: 'Cihaz', value: String(Object.keys(devices).length) }
      ],
      rows: rows.map(function (e) {
        const m = meta(e.type);
        const sev = e.sev || m.sev;
        return {
          time: tr(e.at),
          device: e.dev || '—',
          type: m.label,
          severity: sevLabel[sev] || 'Bilgi',
          message: e.msg || ''
        };
      })
    };
  }

  function printFallback(model) {
    const esc = function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };
    const rows = model.rows.map(function (r) {
      return '<tr><td>' + esc(r.time) + '</td><td>' + esc(r.device) + '</td><td>' +
        esc(r.type) + '</td><td>' + esc(r.severity) + '</td><td>' + esc(r.message) + '</td></tr>';
    }).join('');

    const w = window.open('', '_blank');
    if (!w) {
      if (App.toast) App.toast('Yazdırma penceresi engellendi. CSV indirmeyi deneyin.', { kind: 'warn' });
      return;
    }
    w.document.write(
      '<!doctype html><html lang="tr"><head><meta charset="utf-8">' +
      '<title>' + esc(model.title) + '</title><style>' +
      'body{font:12px/1.5 system-ui,sans-serif;color:#0f172a;margin:28px}' +
      'h1{font-size:18px;margin:0 0 4px}p.meta{color:#64748b;margin:0 0 16px}' +
      'table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px;border-bottom:1px solid #e2e8f0;vertical-align:top}' +
      'th{color:#64748b;font-size:10px;text-transform:uppercase}' +
      '@media print{@page{size:A4;margin:14mm}}' +
      '</style></head><body>' +
      '<h1>' + esc(model.title) + '</h1>' +
      '<p class="meta">' + esc(model.range) + ' · Oluşturma: ' + esc(model.generated) + '</p>' +
      '<p><strong>Toplam:</strong> ' + esc(model.summary[0].value) +
      ' · <strong>Kritik:</strong> ' + esc(model.summary[1].value) +
      ' · <strong>Uyarı:</strong> ' + esc(model.summary[2].value) + '</p>' +
      '<table><thead><tr><th>Zaman</th><th>Cihaz</th><th>Tür</th><th>Önem</th><th>Mesaj</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>' +
      '</body></html>'
    );
    w.document.close();
  }

  function exportPdf() {
    const model = pdfModel();
    if (!model.rows.length) {
      if (App.toast) App.toast('Rapor için henüz olay kaydı yok.', { kind: 'warn' });
      return;
    }

    if (window.AndroidApp && typeof window.AndroidApp.exportPdf === 'function') {
      try {
        window.AndroidApp.exportPdf(JSON.stringify(model));
        if (App.toast) {
          App.toast(model.rows.length + ' olaylık PDF hazırlanıyor…', { kind: 'ok' });
        }
        return;
      } catch (e) {
        /* Native başarısızsa yazdırma penceresine düş. */
      }
    }
    printFallback(model);
  }

  function clearVisible() {
    const owner = me();
    writeLocal(readLocal().filter(function (event) { return !canReadLocalEvent(event, owner); }));
    renderAll();
  }

  function clearLocalAsk() {
    if (!window.confirm('Yerel olay günlüğü temizlensin mi? (Bulut kayıtları silinmez.)')) return;
    clearVisible();
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
    const pdf = $('evPdfBtn');
    if (pdf) pdf.addEventListener('click', exportPdf);
    const clr = $('evClearBtn');
    if (clr) clr.addEventListener('click', clearLocalAsk);
    const ref = $('evRefreshBtn');
    if (ref) ref.addEventListener('click', async function () {
      ref.disabled = true;
      try { await refreshCloud(); }
      finally { ref.disabled = false; }
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

  const refreshes = new Map();

  function cloudScope(snap) {
    if (!snap || !snap.ready || !snap.user) return '';
    const homes = (snap.homes || []).map(function (home) { return home.id; }).sort();
    return JSON.stringify([snap.user.id, homes]);
  }

  function refreshCloud(snap) {
    if (!snap && App.Auth && App.Auth.snapshot) snap = App.Auth.snapshot();
    const scope = cloudScope(snap);
    if (!$('eventList') || !scope) return Promise.resolve();
    if (refreshes.has(scope)) return refreshes.get(scope);
    const refresh = Promise.all([syncPending(), pullMine()]).finally(function () {
      refreshes.delete(scope);
      renderIndex();
    });
    refreshes.set(scope, refresh);
    return refresh;
  }

  let initialized = false;

  function init() {
    if (initialized || (!$('eventList') && !$('eventTableBody'))) return;
    initialized = true;
    prev = loadState() || {};
    bindUi();
    renderIndex();

    if (App.Auth && App.Auth.onChange && App.Auth.snapshot) {
      let previousScope = '';
      let previousAdmin = false;
      const onAuthChange = function (snap) {
        const nextScope = cloudScope(snap);
        const admin = !!(snap.ready && snap.isAdmin && $('eventTableBody'));
        if (nextScope !== previousScope) refreshCloud(snap);
        if (admin && (!previousAdmin || nextScope !== previousScope)) loadAdminEvents();
        if (!admin) {
          cloudAll = [];
          const body = $('eventTableBody');
          if (body) body.replaceChildren();
        }
        previousScope = nextScope;
        previousAdmin = admin;
        renderAll();
      };
      App.Auth.onChange(onAuthChange);
      onAuthChange(App.Auth.snapshot());
      window.addEventListener('online', function () { refreshCloud(); });
    }
  }

  App.Events = {
    init: init,
    note: note,
    setOnline: setOnline,
    record: record,
    list: readVisible,
    exportCsv: exportCsv,
    exportPdf: exportPdf,
    clearLocal: clearVisible,
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
