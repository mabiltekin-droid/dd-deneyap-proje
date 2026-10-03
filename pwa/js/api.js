/* ==========================================================================
   api.js — cihazla iletişim.
   Tüm ağ trafiği buradan geçer: zaman aşımı, iptal (AbortController), token
   başlığı ve JSON ayrıştırma hatalarının tek yerde ele alınması için.
   ========================================================================== */

(function () {
  'use strict';

  const App = window.App;
  const DEFAULT_TIMEOUT = 6000;

  function buildUrl(path) {
    return App.baseUrl() + path;
  }

  async function request(path, options) {
    const o = options || {};
    const s = App.settings();
    const controller = new AbortController();
    const timeout = setTimeout(function () { controller.abort(); }, o.timeout || DEFAULT_TIMEOUT);

    try {
      const headers = { Accept: 'application/json' };
      if (s.token) headers['X-Auth-Token'] = s.token;
      if (o.json) headers['Content-Type'] = 'application/json';

      const res = await fetch(buildUrl(path), {
        method: o.method || 'GET',
        headers: headers,
        body: o.json ? JSON.stringify(o.json) : undefined,
        cache: 'no-store',
        signal: controller.signal
      });

      const text = await res.text();

      if (!res.ok) {
        let msg = res.status + ' ' + res.statusText;
        try {
          const parsed = JSON.parse(text);
          if (parsed && parsed.error) msg = parsed.error;
        } catch (e) { /* JSON değil, varsayılan mesaj kalsın */ }
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }

      try {
        return JSON.parse(text);
      } catch (e) {
        /* HTML dönen eski firmware sürümlerini ayırt et */
        const err = new Error('Cihaz JSON döndürmedi. Firmware güncel mi? ' +
                              '(pwa/ klasörünü olduğu gibi cihaza yükleyin)');
        err.legacy = true;
        throw err;
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        const e = new Error('Cihaz zamanında yanıt vermedi');
        e.timeout = true;
        throw e;
      }
      if (err instanceof TypeError) {
        /* fetch ağ hatası: cihaz kapalı, IP değişmiş, hata sayfası dönüyor... */
        const e = new Error('Cihaza ulaşılamıyor (' + App.baseUrl() + ')');
        e.network = true;
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  App.api = {
    url: buildUrl,

    status: function () {
      return request('/api/status');
    },

    control: function (device, action, value) {
      return request('/api/control', {
        method: 'POST',
        json: { device: device, action: action, value: value || 0 }
      });
    },

    /* Gecikme ölçümü — ayarlar sayfasındaki "Bağlantıyı Test Et" düğmesi */
    ping: async function () {
      const t0 = performance.now();
      const s = await request('/api/status', { timeout: 4000 });
      return { ms: Math.round(performance.now() - t0), status: s };
    }
  };
})();