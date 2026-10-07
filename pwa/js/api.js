/* ==========================================================================
   api.js — cihazla iletişim.

   İki taşıma (transport) katmanı vardır; App.settings().transport ile seçilir:

     'http'  Cihazın kendi web sunucusuna doğrudan fetch.
             Yalnızca panel cihazın kendi ağından açıldığında çalışır
             (http://192.168.4.1 gibi).

     'mqtt'  Cihaz bir MQTT yayıncısına (broker) bağlanır, panel de aynı
             yayıncıya WebSocket ile bağlanır (bkz. js/mqtt.js).
             Panel https üzerinden açılsa BİLE çalışır; tarayıcının mixed
             content engeli devreye girmez ve cihazın internete çıkması
             dışında hiçbir ağ ayarı gerekmez.

   app.js bu dosyayı değiştirmeden kullanır: status() ve control() her iki
   modda da "durum JSON'u" döndürür.
   ========================================================================== */

(function () {
  'use strict';

  const App = window.App;
  const DEFAULT_TIMEOUT = 6000;

  /* Durum itme (push) ile gelir; app.js yine de her periyotta status()
     çağırır, biz dondurulmuş son değeri döner. */
  let pushed = null;
  const statusSubs = new Set();

  function usingMqtt() {
    const s = App.settings();
    return s.transport === 'mqtt' || (!!s.mqttUrl && s.transport !== 'http');
  }

  function buildUrl(path) {
    return App.baseUrl() + path;
  }

  /* ---------------------------------------------------------- HTTP taşıma */

  async function httpRequest(path, options) {
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

  /* -------------------------------------------------------- genel arayüz */

  App.api = {
    url: buildUrl,

    status: function () {
      if (usingMqtt()) return App.mqtt.status();
      return httpRequest('/api/status');
    },

    control: function (device, action, value) {
      if (usingMqtt()) return App.mqtt.control(device, action, value);
      return httpRequest('/api/control', {
        method: 'POST',
        json: { device: device, action: action, value: value !== undefined ? Number(value) : 0 }
      });
    },

    saveSettings: function (payload) {
      if (usingMqtt()) return App.mqtt.saveSettings(payload);
      return httpRequest('/api/settings', {
        method: 'POST',
        json: payload
      });
    },

    /* Geçmiş grafiği: her iki taşıma da aynı JSON gövdesini döndürür.
       opts.n    : döndürülecek nokta (en fazla 140)
       opts.last : son kaç ham örneğin taranacağı (0 = tümü ≈ 24 saat) */
    history: function (opts) {
      const o = opts || {};
      const n = Number(o.n) || 140;
      const last = Number(o.last) || 0;
      if (usingMqtt()) return App.mqtt.history({ n: n, last: last });
      return httpRequest('/api/history?n=' + n + '&last=' + last, { timeout: 10000 });
    },

    getSettings: function () {
      if (usingMqtt()) return App.mqtt.getSettings();
      return httpRequest('/api/settings');
    },

    /* Gecikme ölçümü — ayarlar sayfasındaki "Bağlantıyı Test Et" düğmesi */
    ping: async function () {
      const t0 = performance.now();
      const s = await this.status();
      return { ms: Math.round(performance.now() - t0), status: s };
    },

    /* --- MQTT tarafından çağrılan iç kancalar ---------------------------- */

    /* Durum itmesi: abone olan herkesi anında bilgilendir. */
    _pushStatus: function (data) {
      pushed = data;
      statusSubs.forEach(function (fn) {
        try { fn(data); } catch (e) { console.warn('[api] itme abonesi hata verdi', e); }
      });
    },

    /* Yayıncı (broker) bağlantı durumu — panelde bağlantı rozetini günceller. */
    _setRelayOnline: function (online, msg) {
      App.relayOnline = !!online;
      App.relayMsg = msg || '';
      statusSubs.forEach(function (fn) {
        try { fn({ __relay: true, online: !!online, msg: msg }); } catch (e) { /* yoksay */ }
      });
    },

    /* Cihazın kendi bağlantı durumu (LWT, <T>/online konusu). Yayıncıya
       bağlı olmak cihazın da bağlı olduğu anlamına GELMEZ: yayıncı açık
       kalırken cihaz fişten çekilebilir. Panelin "canlı" diyebilmesi için
       bu alanın false olmaması gerekir. */
    _setDeviceOnline: function (online, msg) {
      App.deviceOnline = !!online;
      App.deviceMsg = msg || '';
      statusSubs.forEach(function (fn) {
        try { fn({ __device: true, online: !!online, msg: msg }); } catch (e) { /* yoksay */ }
      });
    },

    onStatus: function (fn) {
      statusSubs.add(fn);
      return function () { statusSubs.delete(fn); };
    },

    _pushed: function () { return pushed; },

    /* MQTT modundayken yayıncıya bağlanmayı başlat. */
    startMqtt: function () {
      if (usingMqtt() && App.mqtt) App.mqtt.connect();
    },

    transport: usingMqtt
  };
})();