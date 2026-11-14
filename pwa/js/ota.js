/* ==========================================================================
   ota.js — Ayarlar > Cihaz yazılımı

   • Kartın bildirdiği sürümü ve otomatik OTA durumunu gösterir.
   • Buluttaki son yayın bilgisini (api/ota-status) okur.
   • "Şimdi denetle" düğmesi cihaza MQTT/HTTP üzerinden `ota check` gönderir.
   ========================================================================== */

(function () {
  'use strict';

  const App = window.App;
  const $ = function (id) { return document.getElementById(id); };
  let latest = null;
  let lastTelemetry = null;

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text || '—';
  }

  function setResult(text, kind) {
    const el = $('otaResult');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'result' + (kind ? ' ' + kind : '');
  }

  function currentDevice() {
    const t = App.lastTelemetry ? App.lastTelemetry() : null;
    if (t && t.dev) return t.dev;
    if (App.Devices && App.Devices.currentId) return App.Devices.currentId();
    return (App.settings ? App.settings().activeDeviceId : '') || '';
  }

  function currentStatus() {
    const t = App.lastTelemetry ? App.lastTelemetry() : null;
    if (t && (t.fw || t.otaState || t.otaLast)) return t;
    return lastTelemetry;
  }

  function renderCurrent() {
    const t = currentStatus();
    if (!t) {
      setText('otaCurrent', '—');
      setText('otaState', 'Kart bağlanınca okunur.');
      return;
    }
    setText('otaCurrent', t.fw ? ('v' + t.fw) : '—');

    const parts = [];
    if (t.otaAuto === false) parts.push('Otomatik denetim kapalı');
    if (t.otaState) parts.push(String(t.otaState));
    if (t.otaLast) parts.push('Son: ' + String(t.otaLast));
    if (t.otaNext) {
      const ms = Number(t.otaNext);
      if (ms > 0) {
        const dk = Math.max(1, Math.round(ms / 60000));
        parts.push('Sonraki denetim ~' + dk + ' dk');
      }
    }
    setText('otaState', parts.length ? parts.join(' · ') : 'Otomatik denetim etkin.');
  }

  function renderLatest() {
    if (!latest) {
      setText('otaLatest', '—');
      setText('otaNotes', 'Yayın bilgisi alınamadı.');
      return;
    }
    setText('otaLatest', latest.latest ? ('v' + latest.latest) : '—');
    const bits = [];
    if (latest.published_at) {
      try {
        bits.push(new Date(latest.published_at).toLocaleDateString('tr-TR'));
      } catch (e) { /* yoksay */ }
    }
    if (latest.notes) bits.push(String(latest.notes));
    if (latest.mandatory) bits.push('Zorunlu güncelleme');
    setText('otaNotes', bits.length ? bits.join(' · ') : 'Yayınlanmış sürüm yok.');
  }

  async function fetchLatest() {
    try {
      const r = await fetch('/api/ota-status?channel=stable', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      latest = data && data.ok ? data : null;
    } catch (e) {
      latest = null;
    }
    renderLatest();
  }

  async function fetchCurrent() {
    try {
      const s = await App.api.status();
      if (s && s.dev) lastTelemetry = s;
    } catch (e) { /* cihaz kapalı olabilir */ }
    renderCurrent();
  }

  async function checkNow() {
    const dev = currentDevice();
    if (!dev) {
      setResult('Önce bir cihaz seçin.', 'fail');
      return;
    }
    const btn = $('otaCheckBtn');
    if (btn) btn.disabled = true;
    setResult('Cihazdan güncelleme denetimi istendi…');
    try {
      await App.api.control('ota', 'check');
      setResult('İstek gönderildi. Kart yeni sürüm bulursa arka planda indirip doğrular.', 'ok');
      if (App.toast) App.toast('OTA denetimi istendi', { kind: 'ok' });
    } catch (e) {
      setResult(e.human || e.message, 'fail');
    } finally {
      setTimeout(function () { if (btn) btn.disabled = false; }, 2000);
    }
  }

  function init() {
    if (!$('otaSection')) return;
    const check = $('otaCheckBtn');
    if (check) check.addEventListener('click', checkNow);
    const refresh = $('otaRefreshBtn');
    if (refresh) refresh.addEventListener('click', function () {
      setResult('Yayın bilgisi yenileniyor…');
      fetchLatest().then(function () { setResult('Yayın bilgisi güncellendi.', 'ok'); });
    });

    if (App.api && App.api.onStatus) {
      App.api.onStatus(function (ev) {
        const msg = ev && ev.msg ? ev.msg : (ev && ev.__device ? null : ev);
        if (msg && msg.dev) {
          lastTelemetry = msg;
          renderCurrent();
        }
      });
    }

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(function ([entry]) {
        if (!entry.isIntersecting) return;
        fetchLatest();
        fetchCurrent();
      });
      observer.observe($('otaSection'));
    } else {
      fetchLatest();
      fetchCurrent();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
