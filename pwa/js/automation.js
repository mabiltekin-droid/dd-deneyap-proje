/* ==========================================================================
   automation.js — Modlar & Zamanlanmış Otomasyon
   --------------------------------------------------------------------------
   • Çalışma modları: Evde / Gece / Tatil / İzleme
       - Mod seçimi cihazın MEVCUT komutlarıyla uygulanır (autoControl +
         sndVolume); böylece yeniden flash gerekmez.
       - Mod ayrıca panel davranışını yönetir: gece/izleme modunda panel
         anonsları ve hoparlör alarmı susar (safety: kritik anonslar hariç).
   • Zamanlanmış geçiş: gün + saat aralığına göre otomatik mod değişimi.
       - Gece yarısını aşan aralıklar (ör. 23:00 → 07:00) desteklenir.
       - Bir kural aktif değilse kullanıcının elle seçtiği moda dönülür.
   • Ayarlar sayfasında kural düzenleyici, panelde mod seçici sağlar.
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});
  const $ = function (id) { return document.getElementById(id); };
  const esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* ------------------------------------------------------------ mod profilleri */

  const MODES = {
    home: {
      label: 'Evde', auto: true, vol: 70, quiet: false, tts: true,
      desc: 'Normal koruma. Tüm sensörler ve otonom müdahale etkin, anonslar açık.'
    },
    night: {
      label: 'Gece', auto: true, vol: 25, quiet: true, tts: false,
      desc: 'Sessiz koruma. Siren kısık; panel anons ve sesleri kapalı.'
    },
    away: {
      label: 'Tatil', auto: true, vol: 100, quiet: false, tts: true,
      desc: 'Yüksek hassasiyet. Siren en yüksek, anonslar açık; ev boşken tam koruma.'
    },
    off: {
      label: 'İzleme', auto: false, vol: 0, quiet: true, tts: false,
      desc: 'Yalnızca izleme. Otonom müdahale ve siren kapalı; telemetri kaydedilir.'
    }
  };
  const ORDER = ['home', 'night', 'away', 'off'];

  const ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.6V21h14V9.6"/><path d="M10 21v-6h4v6"/></svg>',
    night: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>',
    away: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/></svg>',
    off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>'
  };

  /* JS getDay() düzeni: 0=Pazar … 6=Cumartesi */
  const DAYS = [
    { n: 1, s: 'Pzt' }, { n: 2, s: 'Sal' }, { n: 3, s: 'Çar' },
    { n: 4, s: 'Per' }, { n: 5, s: 'Cum' }, { n: 6, s: 'Cmt' },
    { n: 0, s: 'Paz' }
  ];

  let tickTimer = null;
  let bound = false;

  /* ------------------------------------------------------------------ yardımcı */

  function S() { return App.settings(); }
  function currentMode() { const m = S().mode; return MODES[m] ? m : 'home'; }
  function manualMode() { const m = S().modeManual; return MODES[m] ? m : 'home'; }
  function profile(mode) { return MODES[mode] || MODES.home; }
  function schedule() { const a = S().modeSchedule; return Array.isArray(a) ? a : []; }
  function autoEnabled() { return !!S().modeAuto; }
  function syncEnabled() { return S().modeSync !== false; }

  function hmToMin(hm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm == null ? '' : hm));
    if (!m) return null;
    return Math.min(23, parseInt(m[1], 10)) * 60 + Math.min(59, parseInt(m[2], 10));
  }
  function nowMin(d) { d = d || new Date(); return d.getHours() * 60 + d.getMinutes(); }

  function ruleActive(rule, date) {
    if (!rule || rule.enabled === false) return false;
    const start = hmToMin(rule.start), end = hmToMin(rule.end);
    if (start === null || end === null || start === end) return false;
    const days = (Array.isArray(rule.days) && rule.days.length) ? rule.days : [0, 1, 2, 3, 4, 5, 6];
    const t = nowMin(date);
    const dow = date.getDay();
    if (end > start) {
      return t >= start && t < end && days.indexOf(dow) !== -1;
    }
    /* gece yarısını aşan kural (ör. 23:00 → 07:00) */
    if (t >= start) return days.indexOf(dow) !== -1;
    if (t < end) return days.indexOf((dow + 6) % 7) !== -1;
    return false;
  }

  /* Aktif kuralın modu; hiçbiri etkin değilse null */
  function scheduledMode(date) {
    const rules = schedule();
    for (let i = 0; i < rules.length; i++) {
      if (ruleActive(rules[i], date || new Date())) return rules[i].mode;
    }
    return null;
  }

  /* --------------------------------------------------------- mod uygulama */

  /* Başka bir hesaba bağlı (görünmez) cihaza komut gönderilmesin. */
  function deviceControllable() {
    let t = null;
    try { t = App.lastTelemetry ? App.lastTelemetry() : null; } catch (e) { t = null; }
    if (t && t.dev && App.Auth && App.Auth.canControl) return App.Auth.canControl(t.dev);
    return true;
  }

  /* Moda göre cihaz ayarlarını yerel aynaya ve cihaza uygula.
     Böylece Ayarlar formu da gerçek cihaz durumunu yansıtır. */
  function applyDeviceSync(mode) {
    if (!syncEnabled()) return;
    if (!deviceControllable()) return;
    const p = profile(mode);
    const payload = { autoControl: !!p.auto, sndVolume: p.vol };
    /* Yerel ayna (settings.js formu bu değerleri okur) */
    try { App.saveSettings(payload); } catch (e) { /* yoksay */ }
    if (!App.api || !App.api.saveSettings) return;
    try {
      Promise.resolve(App.api.saveSettings(payload)).catch(function () {
        /* cihaz yok/çevrimdışı — yerel kalır */
      });
    } catch (e) { /* yoksay */ }
  }

  function logMode(mode, source) {
    if (!App.Events || !App.Events.record) return;
    const p = profile(mode);
    const tail = source === 'schedule' ? ' (zamanlanmış)' : '';
    try {
      App.Events.record('mode', '', 'Çalışma modu "' + p.label + '" olarak ayarlandı' + tail + '.', { sev: 'info' });
    } catch (e) { /* günlük hatası sessiz geç */ }
  }

  /* Sadece görsel durumu tazele (cihaza komut göndermez) */
  function syncUI() {
    const cur = currentMode();
    document.body.setAttribute('data-mode', cur);
    const btns = document.querySelectorAll('.mode-btn[data-mode]');
    for (let i = 0; i < btns.length; i++) {
      const on = btns[i].getAttribute('data-mode') === cur;
      btns[i].classList.toggle('active', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const lbl = $('modeLabel');
    if (lbl) lbl.textContent = profile(cur).label;
    const desc = $('modeDesc');
    if (desc) desc.textContent = profile(cur).desc;
    const inp = $('modeAuto');
    if (inp) inp.checked = autoEnabled();
    const sync = $('modeSync');
    if (sync) sync.checked = syncEnabled();
  }

  function applyMode(mode, opts) {
    opts = opts || {};
    if (!MODES[mode]) mode = 'home';
    const prev = currentMode();
    const patch = { mode: mode };
    if (opts.manual !== false) patch.modeManual = mode;
    App.saveSettings(patch);
    syncUI();
    if (prev !== mode) {
      if (opts.toast !== false) {
        if (App.toast) App.toast('Mod: ' + profile(mode).label +
          (opts.source === 'schedule' ? ' (zamanlanmış)' : ''), { kind: 'ok' });
      }
      if (App.sound && App.sound.click) App.sound.click();
      logMode(mode, opts.source);
    }
    if (opts.push === true) applyDeviceSync(mode);
    return mode;
  }

  /* Zamanlanmış geçiş motoru */
  function tick() {
    if (!autoEnabled()) return;
    const sm = scheduledMode(new Date());
    if (sm) {
      if (sm !== currentMode()) applyMode(sm, { source: 'schedule', push: true });
    } else if (currentMode() !== manualMode()) {
      /* Aktif kural yok → kullanıcının seçtiği moda dön */
      applyMode(manualMode(), { source: 'schedule', manual: false, push: true });
    }
  }

  function start() {
    if (tickTimer) clearInterval(tickTimer);
    tick();
    tickTimer = setInterval(tick, 30000);
  }
  function stop() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }

  /* ------------------------------------------------------------- mod seçici */

  function renderSwitchers() {
    const mounts = document.querySelectorAll('.mode-switch[data-mode-mount]');
    if (!mounts.length) return;
    let html = '';
    ORDER.forEach(function (m, i) {
      html += '<button class="mode-btn" type="button" data-mode="' + m + '"' +
        ' aria-pressed="false" title="' + esc(MODES[m].label) + ' — ' + esc(MODES[m].desc) + '">' +
        '<span class="mode-ico">' + ICONS[m] + '</span>' +
        '<span class="mode-txt">' + esc(MODES[m].label) + '</span>' +
        '</button>';
      if (i < ORDER.length - 1) html += '<span class="mode-sep" aria-hidden="true"></span>';
    });
    for (let i = 0; i < mounts.length; i++) mounts[i].innerHTML = html;

    document.addEventListener('click', function (e) {
      const b = e.target && e.target.closest ? e.target.closest('.mode-btn[data-mode]') : null;
      if (!b) return;
      applyMode(b.getAttribute('data-mode'), { source: 'manual', push: true });
    });
  }

  /* ------------------------------------------------------- kural düzenleyici */

  function dayButtons(rule) {
    const days = Array.isArray(rule.days) ? rule.days : [0, 1, 2, 3, 4, 5, 6];
    let out = '';
    DAYS.forEach(function (d) {
      const on = days.indexOf(d.n) !== -1;
      out += '<button type="button" class="sched-day' + (on ? ' on' : '') + '"' +
        ' data-sched="day" data-day="' + d.n + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        esc(d.s) + '</button>';
    });
    return out;
  }

  function modeOptions(sel) {
    let out = '';
    ORDER.forEach(function (m) {
      out += '<option value="' + m + '"' + (m === sel ? ' selected' : '') + '>' +
        esc(MODES[m].label) + '</option>';
    });
    return out;
  }

  function renderSchedule() {
    const host = $('scheduleList');
    if (!host) return;
    const rules = schedule();
    if (!rules.length) {
      host.innerHTML = '<p class="sched-empty">Henüz kural yok. “Kural Ekle” ile ilk zamanlanmış geçişi tanımlayın.</p>';
      return;
    }
    let html = '';
    rules.forEach(function (r) {
      html += '<div class="sched-row" data-id="' + esc(r.id) + '">' +
        '<label class="sched-toggle" title="Kural etkin">' +
          '<input type="checkbox" data-sched="enabled"' + (r.enabled === false ? '' : ' checked') + '>' +
        '</label>' +
        '<select class="sched-mode" data-sched="mode" aria-label="Mod">' + modeOptions(r.mode) + '</select>' +
        '<input class="sched-time" type="time" data-sched="start" value="' + esc(r.start || '23:00') + '" aria-label="Başlangıç">' +
        '<span class="sched-arrow" aria-hidden="true">→</span>' +
        '<input class="sched-time" type="time" data-sched="end" value="' + esc(r.end || '07:00') + '" aria-label="Bitiş">' +
        '<div class="sched-days">' + dayButtons(r) + '</div>' +
        '<button type="button" class="sched-del" data-sched="del" title="Kuralı sil" aria-label="Kuralı sil">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/></svg>' +
        '</button>' +
      '</div>';
    });
    host.innerHTML = html;
  }

  function newRuleId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function addRule() {
    const rules = schedule().slice();
    rules.push({ id: newRuleId(), days: [0, 1, 2, 3, 4, 5, 6], start: '23:00', end: '07:00', mode: 'night', enabled: true });
    App.saveSettings({ modeSchedule: rules });
    renderSchedule();
    flash('Yeni kural eklendi. Saat ve günleri düzenleyebilirsiniz.');
  }

  function updateRule(id, patch) {
    const rules = schedule().map(function (r) {
      return r.id === id ? Object.assign({}, r, patch) : r;
    });
    App.saveSettings({ modeSchedule: rules });
  }

  function removeRule(id) {
    const rules = schedule().filter(function (r) { return r.id !== id; });
    App.saveSettings({ modeSchedule: rules });
    renderSchedule();
    flash('Kural silindi.');
  }

  function flash(msg) {
    const el = $('scheduleResult');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    if (msg) {
      clearTimeout(flash._t);
      flash._t = setTimeout(function () { el.hidden = true; el.textContent = ''; }, 3500);
    }
  }

  function bindScheduleEditor() {
    const host = $('scheduleList');
    if (!host) return;

    host.addEventListener('change', function (e) {
      const t = e.target;
      if (!t || !t.getAttribute) return;
      const key = t.getAttribute('data-sched');
      const row = t.closest ? t.closest('.sched-row') : null;
      if (!key || !row) return;
      const id = row.getAttribute('data-id');
      if (key === 'enabled') updateRule(id, { enabled: !!t.checked });
      else if (key === 'mode') updateRule(id, { mode: t.value });
      else if (key === 'start') updateRule(id, { start: t.value });
      else if (key === 'end') updateRule(id, { end: t.value });
    });

    host.addEventListener('click', function (e) {
      const t = e.target && e.target.closest ? e.target.closest('[data-sched]') : null;
      if (!t) return;
      const key = t.getAttribute('data-sched');
      const row = t.closest('.sched-row');
      if (!row) return;
      const id = row.getAttribute('data-id');
      if (key === 'del') { removeRule(id); return; }
      if (key === 'day') {
        const r = schedule().filter(function (x) { return x.id === id; })[0];
        if (!r) return;
        const d = parseInt(t.getAttribute('data-day'), 10);
        const days = (Array.isArray(r.days) ? r.days.slice() : []);
        const i = days.indexOf(d);
        if (i === -1) days.push(d); else days.splice(i, 1);
        updateRule(id, { days: days });
        renderSchedule();
      }
    });

    const add = $('scheduleAddBtn');
    if (add) add.addEventListener('click', addRule);

    const autoInp = $('modeAuto');
    if (autoInp) {
      autoInp.addEventListener('change', function () {
        App.saveSettings({ modeAuto: !!autoInp.checked });
        if (autoInp.checked) { start(); flash('Zamanlanmış geçiş etkinleştirildi.'); }
        else { flash('Zamanlanmış geçiş kapatıldı.'); }
      });
    }

    const syncInp = $('modeSync');
    if (syncInp) {
      syncInp.addEventListener('change', function () {
        App.saveSettings({ modeSync: !!syncInp.checked });
        if (syncInp.checked) { applyDeviceSync(currentMode()); flash('Moda göre cihaz ayarları uygulanacak.'); }
        else flash('Cihaz senkronu kapatıldı; mod yalnızca paneli etkiler.');
      });
    }
  }

  /* ------------------------------------------------------------------ genel */

  function init() {
    renderSwitchers();
    syncUI();
    renderSchedule();
    if (!bound) { bound = true; bindScheduleEditor(); }
    start();
  }

  App.Automation = {
    init: init,
    MODES: MODES,
    ORDER: ORDER,
    profile: profile,
    current: currentMode,
    apply: applyMode,
    ttsAllowed: function () { return profile(currentMode()).tts; },
    isQuiet: function () { return profile(currentMode()).quiet; },
    scheduledMode: function () { return scheduledMode(new Date()); },
    start: start,
    stop: stop,
    syncUI: syncUI,
    renderSchedule: renderSchedule
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
