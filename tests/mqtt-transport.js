// MQTT tasima katmani testi — sahte yayinci (broker) ile uctan uca dener.
// Amac: mqtt.js + api.js birbirine gercekten uyuyor mu, komut/yanit eslesmesi
// calisiyor mu, hata durumlari dogru yurutuluyor mu.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const base = path.join(__dirname, '..', 'pwa');
let pass = 0, fail = 0;

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  gecti: ' + name); }
  else { fail++; console.log('  KALDI: ' + name + (extra ? ' -> ' + extra : '')); }
}

/* --- sahte yayinci -------------------------------------------------------
   Cihazin davranisini taklit eder: durum yayini, komut alip ayni id'li
   durumu geri yollama. Gercek ag trafigi yok. */
function makeBroker(opts) {
  const o = opts || {};
  return {
    subs: {},
    published: [],
    handlers: {},
    on(evt, fn) { (this.handlers[evt] = this.handlers[evt] || []).push(fn); },
    fire(evt, ...a) { (this.handlers[evt] || []).forEach(fn => fn(...a)); },
    subscribe(topic) { this.subs[topic] = true; },
    publish(topic, payload) {
      this.published.push({ topic, payload: JSON.parse(payload) });
      if (o.onPublish) o.onPublish(this, topic, JSON.parse(payload));
    },
    connect() { setTimeout(() => this.fire('connect'), 0); },
    end() { this.fire('close'); }
  };
}

/* Firmware'in urettigi durum JSON'unun karsiligi */
function deviceStatus(over) {
  return Object.assign({
    ok: true, fw: '3.0.1', t: 12345, ip: '192.168.4.1', clients: 1, rssi: -55,
    heap: 240000, uptime: 65000, ready: true, warm: 0,
    gasRaw: 210, gasFiltered: 208, gasPpm: 95, gasBase: 200,
    rainRaw: 300, rainFiltered: 298, rainPct: 29, rain: false, flood: false,
    state: 'normal', gasWarn: 250, gasDanger: 400, gasHyst: 60,
    rainWetPct: 50, rainFloodPct: 85, rainInvert: false,
    fan: false, pump: false, buzzer: false, auto: true,
    pumpLocked: false, pumpLeft: 0, window: 180, blind: 0, moving: false,
    mqtt: true, cmdId: 0, cmdErr: '', fs: false, fsUsed: 0, fsTotal: 0
  }, over || {});
}

/* Konu: mqtt.js + api.js dosyalarini sahte tarayici ortaminda yukler */
function makeEnv(brokerOpts) {
  const broker = makeBroker(brokerOpts);
  const store = {};
  const App = {
    DEFAULTS: {},
    settings() {
      return {
        transport: 'mqtt',
        mqttUrl: 'wss://broker.test:8084/mqtt',
        mqttUser: '', mqttPass: '',
        mqttTopic: 'deneyap/kart1',
        token: '', pollMs: 2000
      };
    },
    saveSettings(p) { Object.assign(store, p); return this.settings(); },
    baseUrl() { return 'http://192.168.4.1'; }
  };
  const sandbox = {
    window: { App },
    App,
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Error, Number, String, Object, Array, Boolean,
    performance: { now: () => Date.now() },
    performance_now: 0,
    AbortController: function () { this.abort = () => {}; this.signal = {}; },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    location: { origin: 'https://ddproje.vercel.app' },
    fetch: () => Promise.reject(new Error('MQTT modunda fetch kullanilmamali')),
    /* mqtt.js CDN'den gelir; sahte yayinciyi temsil eder.
       YALNIZCA connect() fabrikasi sunulur — gercek kutuphanenin dis
       yuzeyi bu kadardir. MqttClient gibi ic siniflar bilerek
       sunulmaz: panel onlari kullanmaya calisirsa test hemen kacar,
       yoksa tarayicida "this.streamBuilder is not a function"
       gibi bir hata ancak kullaniciya dogruken ortaya cikar. */
    mqtt: {
      connect: function (url, opts) {
        /* Istemci ayri bir nesne; broker nesnesinin kendisi degil.
           (c = broker yapmak, c.x = broker.x atamalarinda sonsuz
            dongu kuruyordu.) */
        const c = {};
        c.opts = opts; c.url = url;
        c.subscribe = function (t) { broker.subs[t] = true; };
        c.publish = function (t, p) { broker.publish(t, p); };
        c.end = function () { broker.fire('close'); };
        /* Olaylar broker uzerinde tutulur; birden fazla istemci olabilir */
        c.on = function (evt, fn) { broker.on(evt, fn); };
        setTimeout(() => broker.fire('connect'), 0);
        return c;
      }
    },
    __broker: broker
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  // 'window.mqtt' -> global mqtt (CDN script'i window'a yazar)
  sandbox.window.mqtt = sandbox.mqtt;

  const cfg = fs.readFileSync(path.join(base, 'js/config.js'), 'utf8');
  const api = fs.readFileSync(path.join(base, 'js/api.js'), 'utf8');
  const mq = fs.readFileSync(path.join(base, 'js/mqtt.js'), 'utf8');
  vm.runInContext(cfg, sandbox, { filename: 'config.js' });
  vm.runInContext(api, sandbox, { filename: 'api.js' });
  vm.runInContext(mq, sandbox, { filename: 'mqtt.js' });

  return { App, broker, sandbox };
}

const tick = (ms) => new Promise(r => setTimeout(r, ms || 60));

(async function main() {
  /* --- 1) baglanma ve abone olma ------------------------------------- */
  console.log('\n1) Yayinciya baglanma ve abone olma');
  {
    const { App, broker } = makeEnv();
    App.mqtt.connect();
    await tick(120);
    check('cihaz tarafinda <T>/status dinleniyor', !!broker.subs['deneyap/kart1/status']);
    check('cihaz tarafinda <T>/online dinleniyor', !!broker.subs['deneyap/kart1/online']);
    check('connected true', App.mqtt.connected() === true);
  }

  /* --- 2) durum itmesi ------------------------------------------------ */
  console.log('\n2) Durum itmesi paneli aninda gunceller');
  {
    const { App, broker } = makeEnv();
    App.mqtt.connect();
    await tick(120);
    const seen = [];
    App.api.onStatus(s => { if (!s.__relay) seen.push(s); });
    broker.fire('message', 'deneyap/kart1/status',
      Buffer.from(JSON.stringify(deviceStatus({ gasPpm: 380, state: 'danger' }))));
    await tick(40);
    check('durum itmesi panele ulasti', seen.length === 1);
    check('tehlike degeri dogru', seen[0] && seen[0].state === 'danger');
    check('api._pushed guncel', App.api._pushed().gasPpm === 380);
  }

  /* --- 3) kumut -> cihaz -> onay dongusu ------------------------------ */
  console.log('\n3) Kumut gonderme ve onay alma (id eslesmesi)');
  {
    let deviceCmd = null;
    const { App, broker } = makeEnv({
      onPublish(b, topic, payload) {
        if (topic !== 'deneyap/kart1/cmd') return;
        deviceCmd = payload;
        // Cihaz komutu uygular ve ayni id ile durumu geri yollar
        setTimeout(() => {
          b.fire('message', 'deneyap/kart1/status', Buffer.from(JSON.stringify(
            deviceStatus({ cmdId: payload.id, fan: payload.action === 'on' }))));
        }, 20);
      }
    });
    App.mqtt.connect();
    await tick(120);
    broker.fire('message', 'deneyap/kart1/status',
      Buffer.from(JSON.stringify(deviceStatus({ t: 1 }))));
    await tick(30);

    const res = await App.api.control('fan', 'on', 0);
    check('komut <T>/cmd konusuna gitti', !!deviceCmd);
    check('komutta id var', deviceCmd && deviceCmd.id >= 1);
    check('komut govdesi dogru', deviceCmd && deviceCmd.device === 'fan' &&
                                 deviceCmd.action === 'on' && deviceCmd.value === 0);
    check('onay ayni id ile dondu', res.cmdId === deviceCmd.id);
    check('onayda fan acik', res.fan === true);
  }

  /* --- 4) cihaz hata donerse kumut reddedilmeli ----------------------- */
  console.log('\n4) Cihaz hatasi kumutu basarisiz gosterir');
  {
    let deviceCmd = null;
    const { App, broker } = makeEnv({
      onPublish(b, topic, payload) {
        if (topic !== 'deneyap/kart1/cmd') return;
        deviceCmd = payload;
        setTimeout(() => {
          b.fire('message', 'deneyap/kart1/status', Buffer.from(JSON.stringify(
            deviceStatus({ cmdId: payload.id, cmdErr: 'gecersiz cihaz' }))));
        }, 20);
      }
    });
    App.mqtt.connect();
    await tick(120);
    let msg = '';
    try { await App.api.control('hede yok', 'on', 0); }
    catch (e) { msg = e.message; }
    check('hata firlatildi', !!msg, msg);
    check('cihaz hata mesaji aktarildi', msg === 'gecersiz cihaz', msg);
    check('id gonderildi', deviceCmd && deviceCmd.device === 'hede yok');
  }

  /* --- 5) cihaz yanit vermezse zaman asimi --------------------------- */
  console.log('\n5) Cihaz yanit vermezse zaman asimi');
  {
    const { App } = makeEnv();   /* hicbir yayin yapmiyor -> cevap yok */
    App.mqtt.connect();
    await tick(120);
    const t0 = Date.now();
    let timedOut = false;
    try {
      await App.api.control('fan', 'off', 0);
    } catch (e) { timedOut = e.timeout === true; }
    const dt = Date.now() - t0;
    check('zaman asimi hatasi', timedOut);
    check('hata makul surede geldi (5-7 sn)', dt > 5000 && dt < 7000, dt + ' ms');
  }

  /* --- 6) eski durum paketi yutulmaz --------------------------------- */
  console.log('\n6) Tekrarlanan/eski durum paketleri');
  {
    const { App, broker } = makeEnv();
    App.mqtt.connect();
    await tick(120);
    /* Once bir durum gonder: status() ilk pakette kadar bekler */
    broker.fire('message', 'deneyap/kart1/status',
      Buffer.from(JSON.stringify(deviceStatus({ t: 100 }))));
    await tick(30);
    check('ilk durum alindi', (await App.api.status()).t === 100);
    broker.fire('message', 'deneyap/kart1/status',
      Buffer.from(JSON.stringify(deviceStatus({ t: 500 }))));
    await tick(30);
    check('guncel durum alindi', (await App.api.status()).t === 500);
    broker.fire('message', 'deneyap/kart1/status',
      Buffer.from(JSON.stringify(deviceStatus({ t: 500, gasPpm: 111 }))));
    await tick(30);
    check('ayni t tekrari yutuldu', App.api._pushed().gasPpm === 111);
  }

  /* --- 7) online/ofline (LWT) rozeti --------------------------------- */
  console.log('\n7) Cihaz cevrimdisi bildirimi');
  {
    const { App, broker } = makeEnv();
    App.mqtt.connect();
    await tick(120);
    broker.fire('message', 'deneyap/kart1/online', Buffer.from('offline'));
    await tick(30);
    check('relay cevrimdisi olarak isaretlendi', App.relayOnline === false);
    broker.fire('message', 'deneyap/kart1/online', Buffer.from('online'));
    await tick(30);
    check('relay cevrimici olarak isaretlendi', App.relayOnline === true);
  }

  /* --- 8) yayinci kapanirsa yeniden baglanma ------------------------- */
  console.log('\n8) Yayinci baglantisi kopunca yeniden deneme');
  {
    const { App, broker } = makeEnv();
    App.mqtt.connect();
    await tick(120);
    check('once bagli', App.mqtt.connected() === true);
    broker.fire('close');
    await tick(60);
    check('kopunca cevrimdisi', App.mqtt.connected() === false);
    await tick(1600);
    check('yeniden baglanma denemesi yapildi', App.mqtt.connected() === true);
  }

  /* --- 9) ayar kaydi: guncel durum beklenir -------------------------- */
  console.log('\n9) Ayar gonderimi guncel durumu bekler');
  {
    let settings = null;
    const { App, broker } = makeEnv({
      onPublish(b, topic, payload) {
        if (topic !== 'deneyap/kart1/settings') return;
        settings = payload;
        setTimeout(() => {
          b.fire('message', 'deneyap/kart1/status', Buffer.from(JSON.stringify(
            deviceStatus({ t: 999, gasWarn: payload.gasWarn }))));
        }, 20);
      }
    });
    App.mqtt.connect();
    await tick(120);
    broker.fire('message', 'deneyap/kart1/status',
      Buffer.from(JSON.stringify(deviceStatus({ t: 100 }))));
    await tick(30);
    const r = await App.api.saveSettings({ gasWarn: 300, gasDanger: 450 });
    check('ayar <T>/settings konusuna gitti', !!settings);
    check('ayar degeri dogru', settings && settings.gasWarn === 300);
    check('ayar sonrasi durum guncellendi', (await App.api.status()).gasWarn === 300);
    check('basari donduruldu', r && r.ok === true);
  }

  /* --- 10) getSettings durumdan turetilir ---------------------------- */
  console.log('\n10) getSettings durum JSON undan turer');
  {
    const { App, broker } = makeEnv();
    App.mqtt.connect();
    await tick(120);
    broker.fire('message', 'deneyap/kart1/status', Buffer.from(JSON.stringify(
      deviceStatus({ gasWarn: 275, gasDanger: 425, rainInvert: true, auto: false }))));
    await tick(40);
    const s = await App.api.getSettings();
    check('gasWarn dogru', s.gasWarn === 275);
    check('gasDanger dogru', s.gasDanger === 425);
    check('rainInvert donusumlu', s.rainInvert === true);
    check('autoControl alan adi donusumlu', s.autoControl === false);
  }

  console.log('\n' + '='.repeat(50));
  console.log('SONUC: ' + pass + ' gecti, ' + fail + ' kaldi');
  process.exit(fail ? 1 : 0);
})();