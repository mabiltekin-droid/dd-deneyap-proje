#!/usr/bin/env node
/* ==========================================================================
   test-voice.js — pwa/js/voice.js yerel Türkçe NLU ve komut motoru testleri
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const VOICE_PATH = path.join(__dirname, '..', 'pwa', 'js', 'voice.js');
const SOURCE = fs.readFileSync(VOICE_PATH, 'utf8');

function createHarness(opts) {
  const o = opts || {};
  const calls = {
    control: [],
    status: 0,
    navigatePanel: [],
    showSettingsPanel: [],
    showSettingsOverview: 0,
    focusRoom: [],
    savePendingRoom: [],
    goUrl: [],
    mode: [],
    theme: [],
    savedSettings: [],
    house3dNight: [],
    toast: [],
    speak: [],
    historyBack: 0,
    scrollTop: 0
  };

  let curTheme = o.theme || 'light';
  let curPage = o.page || 'index';
  let canControl = o.canControl !== undefined ? o.canControl : true;

  const docClassList = {
    contains: function (cls) {
      if (curPage === 'settings' && cls === 'settings-studio-body') return true;
      if (curPage === 'events' && cls === 'events-body') return true;
      if (curPage === 'earthquake' && cls === 'quake-body') return true;
      return false;
    }
  };

  const sandbox = {
    console: console,
    setTimeout: function (fn) { return 1; },
    clearTimeout: function () {},
    window: null,
    document: {
      readyState: 'complete',
      body: { classList: docClassList },
      documentElement: {
        getAttribute: function (k) { return k === 'data-theme' ? curTheme : null; },
        setAttribute: function (k, v) { if (k === 'data-theme') curTheme = v; }
      },
      getElementById: function () { return null; },
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {}
    },
    App: null
  };

  const win = {
    location: {
      pathname: curPage === 'index' ? '/' : ('/' + curPage + '.html'),
      href: 'http://localhost/' + (curPage === 'index' ? '' : (curPage + '.html'))
    },
    history: {
      back: function () { calls.historyBack += 1; }
    },
    scrollTo: function (arg) {
      if (arg && arg.top === 0) calls.scrollTop += 1;
    },
    sessionStorage: {
      setItem: function (k, v) { calls.savePendingRoom.push({ key: k, val: v }); }
    },
    App: {
      canControlDevice: function () { return canControl; },
      lastTelemetry: function () { return null; },
      settings: function () { return { theme: curTheme, gasWarn: 250, gasDanger: 400 }; },
      saveSettings: function (patch) {
        calls.savedSettings.push(patch);
        if (patch && patch.theme) curTheme = patch.theme;
      },
      applyTheme: function (t) {
        calls.theme.push(t);
        curTheme = t;
      },
      toast: function (msg, meta) { calls.toast.push({ msg: msg, meta: meta }); },
      sound: { click: function () {} },
      voice: { speak: function (msg) { calls.speak.push(msg); }, stop: function () {} },
      Automation: {
        current: function () { return 'home'; },
        profile: function (m) { return { label: m === 'home' ? 'Evde' : m }; },
        ttsAllowed: function () { return false; },
        apply: function (mode) { calls.mode.push(mode); }
      },
      House3D: {
        setNightMode: function (night) { calls.house3dNight.push(!!night); }
      },
      api: {
        control: function (device, action, value) {
          calls.control.push({ device: device, action: action, value: value });
          return Promise.resolve({ ok: true });
        },
        status: function () {
          calls.status += 1;
          return Promise.resolve({ gasPpm: 120, window: 0, flame: false, vib: false, flood: false });
        }
      }
    }
  };

  sandbox.window = win;
  sandbox.App = win.App;
  vm.runInNewContext(SOURCE, sandbox, { filename: 'pwa/js/voice.js' });

  win.App.Speech._setNavigator({
    goUrl: function (url) { calls.goUrl.push(url); },
    navigatePanel: function (id) { calls.navigatePanel.push(id); return true; },
    showSettingsPanel: function (id) { calls.showSettingsPanel.push(id); return true; },
    showSettingsOverview: function () { calls.showSettingsOverview += 1; return true; },
    focusRoom: function (preset) { calls.focusRoom.push(preset); return true; },
    savePendingRoom: function (preset) { calls.savePendingRoom.push(preset); }
  });

  return {
    Speech: win.App.Speech,
    calls: calls,
    setCanControl: function (v) { canControl = v; }
  };
}

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓ ' + label);
  } catch (err) {
    failed += 1;
    console.log('  ✗ ' + label + ' — ' + err.message);
  }
}

console.log('\nA) Çıplak sekme, sayfa, kart, ayar ve 3D oda adları');
{
  const h = createHarness();
  const bareCases = [
    ['Panel', 'nav:hero'],
    ['Sensörler', 'nav:telemetry'],
    ['Kontrol', 'nav:command-center'],
    ['Geçmiş', 'nav:analytics'],
    ['Olaylar', 'nav:events'],
    ['Sistem', 'nav:diagnostics'],
    ['Deprem', 'nav:earthquake'],
    ['Ayarlar', 'nav:settings'],
    ['Hesap', 'nav:settings:accountCard'],
    ['Profilim', 'nav:settings:profileCard'],
    ['Davetler', 'nav:settings:inviteCard'],
    ['Cihazlarım', 'nav:settings:devicesSection'],
    ['Ev ve aile', 'nav:settings:homesSection'],
    ['Cihaz yazılımı', 'nav:settings:otaSection'],
    ['Ev ağı bağlantısı', 'nav:settings:connSection'],
    ['Sensör eşikleri', 'nav:settings:thresholdSection'],
    ['Çalışma modları', 'nav:settings:automationSection'],
    ['Telegram', 'nav:settings:telegramSection'],
    ['Bildirimler', 'nav:settings:notifySection'],
    ['Uygulama bildirimleri', 'nav:settings:nativeNotifySection'],
    ['Acil durum', 'nav:settings:emergencySection'],
    ['Görünüm', 'nav:settings:themeSection'],
    ['Yedekleme', 'nav:settings:backupSection'],
    ['Gizlilik', 'nav:privacy'],
    ['Hesap silme', 'nav:accountDelete'],
    ['Kullanım koşulları', 'nav:terms'],
    ['Gaz ve duman', 'nav:gasCard'],
    ['Alev sensörü', 'nav:flameCard'],
    ['Yağmur sensörü', 'nav:rainCard'],
    ['Sarsıntı sensörü', 'nav:vibCard'],
    ['Kara kutu', 'nav:blackboxWrap'],
    ['Salon', 'room:salon'],
    ['Mutfak', 'room:kitchen'],
    ['Yatak odası', 'room:bedroom'],
    ['Bahçe', 'room:garden'],
    ['Genel', 'room:overview']
  ];
  bareCases.forEach(function (pair) {
    check('"' + pair[0] + '" → ' + pair[1], function () {
      assert.strictEqual(h.Speech.parse(pair[0]).code, pair[1]);
    });
  });
}

console.log('\nB) Türkçe ekler, yönlendirme fiilleri ve doğal kalıplar');
{
  const h = createHarness();
  const phraseCases = [
    ['Sensörleri aç', 'nav:telemetry'],
    ['Sensörlere gir', 'nav:telemetry'],
    ['Sensörler sekmesine geç', 'nav:telemetry'],
    ['Sensörleri gösterir misin', 'nav:telemetry'],
    ['Canlı ölçümlere bak', 'nav:telemetry'],
    ['Panele git', 'nav:hero'],
    ['Paneli açıver', 'nav:hero'],
    ['Ana sayfaya dön', 'nav:hero'],
    ['Kontrol panelini aç', 'nav:hero'],
    ['Kontrole geç', 'nav:command-center'],
    ['Cihaz kontrolünü aç', 'nav:command-center'],
    ['Geçmişe bak', 'nav:analytics'],
    ['24 saatlik grafiği aç', 'nav:analytics'],
    ['Son 24 saati göster', 'nav:analytics'],
    ['Olayları listele', 'nav:events'],
    ['Olay günlüğüne gir', 'nav:events'],
    ['Alarm geçmişini aç', 'nav:events'],
    ['Sistemi aç', 'nav:diagnostics'],
    ['Sistem sağlığına bak', 'nav:diagnostics'],
    ['Depremi aç', 'nav:earthquake'],
    ['Son depremlere göz at', 'nav:earthquake'],
    ['Ayarlara gir', 'nav:settings'],
    ['Ayarları açsana', 'nav:settings'],
    ['Ayarlar panelini aç', 'nav:settings'],
    ['Hesabımı aç', 'nav:settings:accountCard'],
    ['Hesaba giriş yap', 'nav:settings:accountCard'],
    ['Profile git', 'nav:settings:profileCard'],
    ['Cihazlarıma bak', 'nav:settings:devicesSection'],
    ['Bağlantı ayarlarını aç', 'nav:settings:connSection'],
    ['Ev ağına gir', 'nav:settings:connSection'],
    ['Sensör eşiklerine gir', 'nav:settings:thresholdSection'],
    ['Alarm eşiklerini aç', 'nav:settings:thresholdSection'],
    ['Otomasyon ayarlarını göster', 'nav:settings:automationSection'],
    ['Acil kişileri göster', 'nav:settings:emergencySection'],
    ['Acil durum e-postalarını aç', 'nav:settings:emergencySection'],
    ['Tema ayarlarını aç', 'nav:settings:themeSection'],
    ['Mutfağa odaklan', 'room:kitchen'],
    ['Mutfağı aç', 'room:kitchen'],
    ['Salona yaklaş', 'room:salon'],
    ['Yatak odasına geç', 'room:bedroom'],
    ['Bahçeyi göster', 'room:garden'],
    ['Tüm eve bak', 'room:overview'],
    ['Olay oynatıcıyı aç', 'nav:blackboxWrap'],
    ['Siren ve ses kontrolünü aç', 'nav:soundControl'],
    ['Kullanım koşullarını göster', 'nav:terms'],
    ['Gizlilik ve hesap silme', 'nav:privacy']
  ];
  phraseCases.forEach(function (pair) {
    check('"' + pair[0] + '" → ' + pair[1], function () {
      assert.strictEqual(h.Speech.parse(pair[0]).code, pair[1]);
    });
  });
}

console.log('\nC) Türkçe karakter eksikliği, kesme işareti ve bulanık yazım toleransı');
{
  const h = createHarness();
  const fuzzyCases = [
    ['sensorleri ac', 'nav:telemetry'],
    ["Panel'i aç", 'nav:hero'],
    ["Ayarlar'a gir", 'nav:settings'],
    ['sensöleri aç', 'nav:telemetry'],
    ['depremı aç', 'nav:earthquake'],
    ['kontorl', 'nav:command-center'],
    ['mutfaga bak', 'room:kitchen'],
    ['hesabimi ac', 'nav:settings:accountCard'],
    ['gizliligi goster', 'nav:privacy']
  ];
  fuzzyCases.forEach(function (pair) {
    check('"' + pair[0] + '" → ' + pair[1], function () {
      assert.strictEqual(h.Speech.parse(pair[0]).code, pair[1]);
    });
  });
}

console.log('\nD) Çoklu Web Speech adayı sıralama (resolveBest & handle)');
{
  const h = createHarness();
  check('1. aday bozuk, 2. aday doğruysa 2. aday seçilir', function () {
    const res = h.Speech.handle([
      { transcript: 'sen söyler aç', confidence: 0.78 },
      { transcript: 'sensörleri aç', confidence: 0.64 }
    ]);
    assert.strictEqual(res, 'nav:telemetry');
    assert.deepStrictEqual(h.calls.navigatePanel, ['telemetry']);
  });
}

console.log('\nE) Mevcut donanım, mod, durum, tema, kalibrasyon ve gelişmiş komutlar');
{
  const h = createHarness();
  const cmdCases = [
    ['pencereyi kapat', 'window:shut'],
    ['pencereyi aç', 'window:open'],
    ['pencereyi arala', 'window:ajar'],
    ['pencereyi yarım aç', 'window:ajar'],
    ['pencereyi serbest bırak', 'window:stop'],
    ['pencereyi 45 derece aç', 'window:set:45'],
    ['pencereyi doksan derece aç', 'window:set:90'],
    ['pencereyi yüzde 50 aç', 'window:set:90'],
    ['panjuru aç', 'blind:open'],
    ['perdeyi kapat', 'blind:shut'],
    ['panjuru serbest bırak', 'blind:stop'],
    ['fanı çalıştır', 'fan:on'],
    ['havalandırmayı durdur', 'fan:off'],
    ['pompayı aç', 'pump:on'],
    ['su motorunu durdur', 'pump:off'],
    ['sireni çal', 'sound:siren'],
    ['alarmı sustur', 'sound:off'],
    ['test tonu', 'sound:test'],
    ['kısa bip', 'sound:beep'],
    ['sesi yüzde 60 yap', 'sound:set:60'],
    ['otomasyonu kapat', 'auto:off'],
    ['otomatik korumayı aç', 'auto:on'],
    ['gece moduna geç', 'mode:night'],
    ['tatil modu', 'mode:away'],
    ['evde modu', 'mode:home'],
    ['izleme modu', 'mode:off'],
    ['kapalı mod', 'mode:off'],
    ['durum nedir', 'status'],
    ['alarmı simüle et', 'simulate'],
    ['gazı kalibre et', 'calibrate'],
    ['sarsıntıyı temizle', 'vib:clear'],
    ['sarsıntı testi', 'vib:test'],
    ['alev durumunu temizle', 'flame:clear'],
    ['alev testi', 'flame:test'],
    ['su baskını testi', 'flood:test'],
    ['karanlık tema', 'theme:dark'],
    ['aydınlık tema', 'theme:light'],
    ['3d gece', 'house3d:night'],
    ['geri dön', 'action:back']
  ];
  cmdCases.forEach(function (pair) {
    check('"' + pair[0] + '" → ' + pair[1], function () {
      assert.strictEqual(h.Speech.handle(pair[0]), pair[1]);
    });
  });
}

console.log('\nF) Yanlış pozitif önleme, sayfa-içi yönlendirme ve yetki ayrımı');
{
  const h = createHarness({ canControl: false });
  check('"gaz penceresini aç" → window:open (yanlış ajar yok)', function () {
    assert.strictEqual(h.Speech.parse('gaz penceresini aç').code, 'window:open');
  });
  check('"pencereyi durdur" → window:stop', function () {
    assert.strictEqual(h.Speech.parse('pencereyi durdur').code, 'window:stop');
  });
  check('"bugün hava çok güzel" → unknown', function () {
    assert.strictEqual(h.Speech.handle('bugün hava çok güzel'), 'unknown');
  });
  check('"istanbul yarın yağmurlu olabilir" → unknown', function () {
    assert.strictEqual(h.Speech.handle('istanbul yarın yağmurlu olabilir'), 'unknown');
  });
  check('Cihaz bağlı değilken navigasyon çalışır, donanım komutu reddedilir', function () {
    const navRes = h.Speech.handle('Sensörleri aç');
    assert.strictEqual(navRes, 'nav:telemetry');
    assert.deepStrictEqual(h.calls.navigatePanel, ['telemetry']);

    const devRes = h.Speech.handle('pencereyi aç');
    assert.strictEqual(devRes, 'window:open');
    assert.strictEqual(h.calls.control.length, 0);
    assert(h.calls.toast.some(function (t) { return /bağlayın|giriş yap/i.test(t.msg); }));
  });
}

console.log('\nG) Sayfalar arası geçiş ve ayarlar alt-panel yönlendirmesi');
{
  const hSettings = createHarness({ page: 'settings' });
  check('settings sayfasında "Telegram" → StudioNav.show("telegramSection")', function () {
    const r = hSettings.Speech.handle('Telegramı aç');
    assert.strictEqual(r, 'nav:settings:telegramSection');
    assert.deepStrictEqual(hSettings.calls.showSettingsPanel, ['telegramSection']);
  });
  check('settings sayfasında "Mutfağa bak" → oda kaydedip ana panele döner', function () {
    const r = hSettings.Speech.handle('Mutfağa bak');
    assert.strictEqual(r, 'room:kitchen');
    assert.deepStrictEqual(hSettings.calls.savePendingRoom, ['kitchen']);
    assert.deepStrictEqual(hSettings.calls.goUrl, ['./#hero']);
  });
}

console.log('\nSONUÇ: ' + passed + ' geçti, ' + failed + ' başarısız\n');
process.exit(failed === 0 ? 0 : 1);
