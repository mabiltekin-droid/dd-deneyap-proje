/* ==========================================================================
   mqtt.js — ESP32'ye WebSocket üzerinden MQTT ile ulaşma.

   NEDEN BU YOL VAR:
     Panel https://ddproje.vercel.app üzerinden açılır. Tarayıcı, bir https
     sayfasından http://192.168.x.x adresine istek atılmasını "mixed content"
     diye ENGELLER. Bu yüzden cihaza doğrudan http ile ulaşılamaz.

   ÇÖZÜM: Cihaz bir MQTT yayıncısına (broker) kendisi bağlanır ve durumunu
   oraya yayar; bu panel de aynı yayıncıya WebSocket ile bağlanır:

       ESP32 ──wss──> yayıncı <──wss── panel (bu site)

   Böylece iki taraf da https konuşur, mixed content devreye girmez. Cihaz
   dışarıya bağlandığı için yönlendiricide port yönlendirme de gerekmez —
   CGNAT arkasındaki ev ağlarında da çalışır.

   Konu şeması (<T> = topic, örn. "deneyap/kart1"):
     <T>/status    cihaz → panel   durum JSON'u (retained)
     <T>/cmd       panel → cihaz   {"id":7,"device":"fan","action":"on"}
     <T>/settings  panel → cihaz   {"gasWarn":250,...}
     <T>/online    cihaz → panel   "online" / LWT ile "offline"
     <T>/histreq   panel → cihaz   {"id":9,"n":140,"last":1440}  geçmiş ister
     <T>/hist      cihaz → panel   {"id":9,"recs":[[t,ppm,rain,st,fl],...]}
   ========================================================================== */

(function () {
  'use strict';

  const App = window.App;

  const RECONNECT_MIN = 1000;
  const RECONNECT_MAX = 15000;
  const CMD_TIMEOUT   = 6000;   /* komutun cevap beklediği en fazla süre */
  /* Ayarlar için ayrı eşik: cihaz durumu 3 sn'de bir yayımlar, üstelik
     ayar yazımı NVS'ye kayıt da içerir. 6 sn = yalnızca 2 dönem bırakır;
     yayıncıda tek bir kayıp pakette panel "iletilmedi" der ve kullanıcı
     aslında kaydedilmiş bir ayarı tekrar tekrar dener. 9 sn = 3 dönem. */
  const SAVE_TIMEOUT  = 9000;

  let client = null;
  let connected = false;
  let nextCmdId = 1;
  let lastStatus = null;       /* son gelen durum (paket kaybında tekrar kullanılır) */
  let lastStatusAt = 0;
  let retryMs = RECONNECT_MIN;
  let reconnectTimer = null;   /* bekleyen tek yeniden bağlanma denemesi */
  /* İstemci elde varken connect() çağırmak onu düşürür; hemen ardından
     yapılan yayın "Yayıncıya bağlı değil" diye hata verir. Bu yüzden
     "kuruluyor mu / kurulu mu" durumunu ayrıca izliyoruz. */
  let connecting = false;
  const waiters = new Map();   /* cmdId -> {resolve, reject, timer} */
  const histWaiters = new Map(); /* geçmiş isteği id -> {resolve, reject, timer} */

  /* mqtt.js CDN'den gelir. Panel çevrimdışıyken (kapalı AP'de) dosya
     yüklenemez; bu durumda sessizce HTTP moduna düşülür. */
  function lib() { return window.mqtt; }

  function topicBase() {
    const s = App.settings();
    return String(s.mqttTopic || 'deneyap/kart1').replace(/\/+$/, '');
  }

  /* Bir komutun cevabını bekle. Cihaz, durum JSON'unda aynı "id"yi geri
     yollar; o id gelene kadar promise askıda kalır. */
  function awaitCmd(id) {
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        waiters.delete(id);
        const e = new Error('Komut zamanında onaylanmadı (cihaz çevrimdışı olabilir)');
        e.timeout = true;
        reject(e);
      }, CMD_TIMEOUT);
      waiters.set(id, { resolve: resolve, reject: reject, timer: timer });
    });
  }

  function awaitHistory(id) {
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        histWaiters.delete(id);
        const e = new Error('Geçmiş verisi cihazdan gelmedi (cihaz çevrimdışı olabilir)');
        e.timeout = true;
        reject(e);
      }, CMD_TIMEOUT * 2);
      histWaiters.set(id, { resolve: resolve, reject: reject, timer: timer });
    });
  }

  function settleWaiters(status) {
    const id = Number(status.cmdId);
    if (!id || !waiters.has(id)) return;
    const w = waiters.get(id);
    waiters.delete(id);
    clearTimeout(w.timer);
    if (status.cmdErr) {
      const e = new Error(status.cmdErr);
      e.device = true;   /* cihaz yanıtladı ve reddetti — bağlantı sorunu değil */
      w.reject(e);
    } else w.resolve(status);
  }

  function onMessage(topic, payload) {
    const t = String(topic);
    const base = topicBase();

    if (t === base + '/online') {
      /* Cihazın LWT durumu. Yayıncıya (broker) bağlı olmak, cihazın da
         bağlı olduğu anlamına gelmez — ikisi ayrı ele alınır. */
      const online = String(payload) !== 'offline';
      App.api._setDeviceOnline(online, online ? 'Cihaz yayıncıya bağlı' : 'Cihaz Çevrimdışı');
      return;
    }
    if (t === base + '/hist') {
      let h;
      try { h = JSON.parse(payload.toString()); }
      catch (e) { console.warn('[mqtt] geçmiş JSON değil, yok sayıldı.'); return; }
      const hid = Number(h.id);
      const w = histWaiters.get(hid);
      if (w) { histWaiters.delete(hid); clearTimeout(w.timer); w.resolve(h); }
      return;
    }
    if (t !== base + '/status') return;

    let data;
    try { data = JSON.parse(payload.toString()); }
    catch (e) { console.warn('[mqtt] durum JSON değil, yok sayıldı.', e); return; }

    lastStatus = data;
    lastStatusAt = Date.now();
    settleWaiters(data);
    App.api._pushStatus(data);
  }

  function connect() {
    const M = lib();
    if (!M) { console.warn('[mqtt] mqtt.js yüklenemedi'); return; }
    /* Kimlik koruması: elde zaten bağlanan ya da bağlı bir istemci varken
       yeniden kurmak, canlı bağlantıyı düşürür ve hemen ardından yapılan
       yayınların "Yayıncıya bağlı değil" diye geri dönmesine yol açar
       (ayarlar sayfasında test/deneme düğmelerinde görüldü).
       restart() önce dropClient() yaptığı için gerçek yeniden kurulum
       yine çalışır; scheduleReconnect() de ancak kapandıktan sonra
       çağrıldığı için engellenmez. */
    if (client && (connected || connecting)) return;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    dropClient();

    const s = App.settings();
    const url = String(s.mqttUrl || '').trim();
    if (!url) {
      App.api._setRelayOnline(false, 'yayıncı adresi boş');
      return;
    }

    connected = false;
    const opts = {
      clientId: 'pwa-' + Math.random().toString(16).slice(2, 10),
      clean: true,
      reconnectPeriod: 0,          /* yeniden bağlanmayı KENDİMİZ yönetiyoruz */
      connectTimeout: 8000
    };
    if (s.mqttUser) {
      opts.username = s.mqttUser;
      opts.password = s.mqttPass || '';
    }

    /* mqtt.connect() fabrika fonksiyonudur: adresi okur, ws/wss taşımasını
       seçer ve istemciyi doğru kurar. MqttClient iç sınıftır; doğrudan
       çağırmak "this.streamBuilder is not a function" hatası verir. */
    let c;
    try { c = M.connect(url, opts); }
    catch (e) {
      console.warn('[mqtt] istemci oluşturulamadı', e);
      App.api._setRelayOnline(false, 'yayıncı adresi geçersiz');
      scheduleReconnect();
      return;
    }
    client = c;
    connecting = true;

    /* Olay dinleyicileri "c" üzerinden bağlanır: biz yeni bir istemciye
       geçtiğimizde eskisinin olayları yeni zinciri tetiklemesin. */
    c.on('connect', function () {
      if (client !== c) return;
      connected = true;
      connecting = false;
      retryMs = RECONNECT_MIN;
      const base = topicBase();
      c.subscribe(base + '/status', { qos: 0 });
      c.subscribe(base + '/online', { qos: 0 });
      c.subscribe(base + '/hist',   { qos: 0 });
      App.api._setRelayOnline(true, 'yayıncıya bağlandı');
      console.log('[mqtt] bağlandı:', url, 'konu:', base);
    });

    c.on('message', onMessage);

    c.on('error', function (err) {
      console.warn('[mqtt] hata:', err && err.message);
    });

    c.on('close', function () {
      if (client !== c) return;      /* biz çoktan yenisine geçtik */
      connected = false;
      connecting = false;
      App.api._setRelayOnline(false, 'yayıncı bağlantısı koptu');
      scheduleReconnect();
    });

    c.on('offline', function () { if (client === c) { connected = false; connecting = false; } });
    /* connect() zaten bağlantıyı kurar; ayrıca connect() çağırma.
       Gerçek mqtt.js'te ikinci çağrı "already connected" hatası verir. */
  }

  /* Mevcut istemciyi bırak. Önce referansı sıfırlıyoruz: kapatma işlemi
     'close' olayını tetikler; o olay hâlâ "bizim" istemci sanılırsa zincire
     geri döner ve istemciler katlanarak çoğalır (sahada 140+ bağlantı ve
     sayfaların çökmesi görüldü). Tek bir bekleyen deneme yeterlidir. */
  function dropClient() {
    const old = client;
    client = null;
    connecting = false;
    if (old) { try { old.end(true); } catch (e) { /* yoksay */ } }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;               /* zaten bir deneme bekliyor */
    const wait = retryMs;
    retryMs = Math.min(RECONNECT_MAX, Math.round(retryMs * 1.8));
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, wait);
  }

  function publish(topic, payload) {
    if (!client || !connected) {
      const e = new Error('Yayıncıya bağlı değil (cihaz bulunamadı)');
      e.network = true;
      throw e;
    }
    client.publish(topic, payload, { qos: 0, retain: false });
  }

  function isStale() {
    /* 3 yayın periyodundan uzun süre durum gelmediyse cihaz düşmüş demektir */
    return lastStatus && (Date.now() - lastStatusAt) > 12000;
  }

  App.mqtt = {
    /* Ayarlar değişince yeniden bağlan */
    restart: function () { dropClient(); connect(); },

    isEnabled: function () {
      const s = App.settings();
      return !!s.transport || s.transport === 'mqtt' || (!!s.mqttUrl && s.transport !== 'http');
    },

    connected: function () { return connected; },

    /* Durum okuma: itme tabanlı. Son durumu dondurup aynen döner. */
    status: function () {
      if (lastStatus && !isStale()) return Promise.resolve(lastStatus);
      if (lastStatus) {
        const e = new Error('Cihazdan uzun süredir veri gelmiyor');
        e.network = true;
        return Promise.reject(e);
      }
      /* Henüz veri yok: kısa süre bekle, gelirse çöz */
      return new Promise(function (resolve, reject) {
        const started = Date.now();
        const iv = setInterval(function () {
          if (lastStatus) { clearInterval(iv); resolve(lastStatus); return; }
          if (Date.now() - started > CMD_TIMEOUT) {
            clearInterval(iv);
            const e = new Error('Cihazdan veri gelmiyor. Yayıncı adresini ve konuyu kontrol edin.');
            e.network = true;
            reject(e);
          }
        }, 200);
      });
    },

    control: function (device, action, value) {
      const id = nextCmdId++;
      publish(topicBase() + '/cmd', JSON.stringify({
        id: id, device: device, action: action, value: Number(value || 0)
      }));
      return awaitCmd(id);
    },

    /* Geçmiş grafiği verisi.
       opts.n    : döndürülecek nokta (en fazla 140)
       opts.last : son kaç ham örneğin taranacağı (0 = hepsi, yani 24 saat) */
    history: function (opts) {
      const o = opts || {};
      const id = nextCmdId++;
      publish(topicBase() + '/histreq', JSON.stringify({
        id: id,
        n: Number(o.n) || 140,
        last: Number(o.last) || 0
      }));
      return awaitHistory(id);
    },

    saveSettings: function (payload) {
      publish(topicBase() + '/settings', JSON.stringify(payload));
      /* Ayar değişimi bir komut numarası taşımıyor; cihazın durumu
         yeni değerleri yansıttığında iş tamamlanmış sayılır. Cihaz
         doğrulama reddederse bunu `cmdErr` alanı üzerinden geri yollar:
         aksi halde panel "kaydedildi" derken kart ayarı uygulamamış olur. */
      const before = lastStatus ? Number(lastStatus.t) : -1;
      const beforeErr = lastStatus ? String(lastStatus.cmdErr || '') : '';
      const started = Date.now();
      return new Promise(function (resolve, reject) {
        const iv = setInterval(function () {
          if (lastStatus && Number(lastStatus.t) > before) {
            clearInterval(iv);
            const nowErr = String(lastStatus.cmdErr || '');
            if (nowErr && nowErr !== beforeErr) {
              const e = new Error(nowErr);
              e.rejected = true;
              reject(e);
              return;
            }
            resolve({ ok: true, via: 'mqtt' });
            return;
          }
          if (Date.now() - started > SAVE_TIMEOUT) {
            clearInterval(iv);
            const e = new Error('Ayar cihaza iletilemedi');
            e.timeout = true;
            reject(e);
          }
        }, 200);
      });
    },

    /* Durum JSON'u zaten eşikleri ve ters/oto bayraklarını içerdiği için
       ayrı bir GET'e gerek yok. Telegram alanları da duruma eklendi. */
    getSettings: function () {
      if (!lastStatus) return this.status();
      return Promise.resolve({
        ok: true,
        gasWarn: lastStatus.gasWarn,
        gasDanger: lastStatus.gasDanger,
        gasHyst: lastStatus.gasHyst,
        rainWetPct: lastStatus.rainWetPct,
        rainFloodPct: lastStatus.rainFloodPct,
        rainInvert: lastStatus.rainInvert,
        autoControl: lastStatus.auto,
        tgEnabled: lastStatus.tgOn === true || lastStatus.tgOn === 'true',
        tgTokenSet: lastStatus.tgTok === true || lastStatus.tgTok === 'true',
        tgChatSet: lastStatus.tgChat === true || lastStatus.tgChat === 'true',
        /* chat id'nin kendisi durumda taşınmaz (gizli değil ama gereksiz);
           panel yalnızca "kayıtlı / keşfedilecek" bilgisini gösterir. */
        tgChatId: ''
      });
    },

    ping: async function () {
      const t0 = performance.now();
      const s = await this.status();
      return { ms: Math.round(performance.now() - t0), status: s };
    },

    connect: connect
  };
})();