#!/usr/bin/env node
/* ==========================================================================
   test-devices.js — çoklu cihaz (pwa/js/devices.js) davranış testleri
   --------------------------------------------------------------------------
   Tarayıcı olmadan, sahte bir App + Auth ile modülü yükler ve şunları sınar:
     • yeni cihaz öğrenme (konu + otomatik aktif seçim)
     • tekrarlı öğrenmede gereksiz yazma olmaması
     • konu çözümleme sırası (yerel harita → bağlama kaydı → mevcut konu)
     • cihaz değiştirme (aktif + MQTT konusu + taşıma yeniden başlatma)
     • liste (kendi cihazları, aktif işareti, bağlanmamış kimlikler)
   Kullanım: npm run test:devices
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'pwa', 'js', 'devices.js');

let gecti = 0, basarisiz = 0;
function ok(cond, msg) {
  if (cond) { gecti += 1; console.log('  ✓ ' + msg); }
  else { basarisiz += 1; console.log('  ✗ ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + '  (' + JSON.stringify(a) + ')'); }

function kur(initial, authRows) {
  const store = Object.assign({}, initial);
  const app = {};
  app.settings = function () { return Object.assign({}, store); };
  app.saveSettings = function (patch) {
    Object.assign(store, patch || {});
    return app.settings();
  };
  app._store = store;

  let restarted = 0;
  app.mqtt = { restart: function () { restarted += 1; } };

  app.Auth = {
    snapshot: function () {
      return authRows && authRows.uid ? { user: { id: authRows.uid } } : null;
    },
    listBindings: async function () { return (authRows && authRows.rows) || []; },
    bindingOf: function (id) {
      const rows = (authRows && authRows.rows) || [];
      for (let i = 0; i < rows.length; i++) if (rows[i].device_id === id) return rows[i];
      return null;
    }
  };

  const sandbox = { console: console, window: { App: app }, atob: function () { return ''; } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox);
  return { app: app, D: sandbox.window.App.Devices, restartedSay: function () { return restarted; } };
}

(async function () {
  console.log('\nA) Öğrenme ve aktif seçim');

  const a = kur({ mqttTopic: 'deneyap/kart1', activeDeviceId: '', deviceTopics: {} }, { uid: 'u1', rows: [] });
  eq(a.D.currentId(), '', 'başlangıçta aktif cihaz yok');
  ok(a.D.learn('DK-1744', 'deneyap/kart1') === true, 'yeni cihaz öğrenildi (değişiklik var)');
  eq(a.D.currentId(), 'DK-1744', 'ilk görülen cihaz otomatik aktif oldu');
  eq(a.D.topicFor('DK-1744'), 'deneyap/kart1', 'öğrenilen konu çözümlendi');
  ok(a.D.learn('DK-1744', 'deneyap/kart1') === false, 'aynı bilgiyi tekrar öğrenmek yazma yapmaz');

  console.log('\nB) Konu çözümleme sırası');

  const b = kur({
    mqttTopic: 'deneyap/varsayilan', activeDeviceId: '', deviceTopics: { 'DK-2': 'deneyap/k2' }
  }, {
    uid: 'u1',
    rows: [
      { device_id: 'DK-2', owner_id: 'u1', status: 'active', topic: 'sunucu/k2' },
      { device_id: 'DK-3', owner_id: 'u1', status: 'active', topic: 'sunucu/k3' }
    ]
  });
  eq(b.D.topicFor('DK-2'), 'deneyap/k2', 'yerel harita sunucudakini geçersiz kılar (öncelik 1)');
  eq(b.D.topicFor('DK-3'), 'sunucu/k3', 'yerelde yoksa bağlama kaydı kullanılır (öncelik 2)');
  eq(b.D.topicFor('DK-9'), 'deneyap/varsayilan', 'hiçbiri yoksa mevcut konuya düşer (öncelik 3)');

  console.log('\nC) Cihaz değiştirme');

  const c = kur({
    mqttTopic: 'deneyap/kart1', activeDeviceId: '', deviceTopics: {}
  }, { uid: 'u1', rows: [{ device_id: 'DK-1', owner_id: 'u1', status: 'active' }] });
  c.D.learn('DK-1', 'deneyap/kart1');
  c.D.setTopic('DK-2', 'deneyap/k2');
  const topic = c.D.activate('DK-2');
  eq(topic, 'deneyap/k2', 'activate döndürdüğü konu doğru');
  eq(c.D.currentId(), 'DK-2', 'aktif cihaz değişti');
  eq(c.app.settings().mqttTopic, 'deneyap/k2', 'taşıma konusu yeni cihaza yönlendi');
  eq(c.restartedSay(), 1, 'taşıma (mqtt.restart) bir kez yeniden başlatıldı');

  console.log('\nD) Liste');

  const d = kur({ mqttTopic: 'deneyap/kart1', activeDeviceId: 'DK-1', deviceTopics: { 'DK-1': 'deneyap/kart1', 'DK-9': 'deneyap/k9' } }, {
    uid: 'u1',
    rows: [
      { device_id: 'DK-1', owner_id: 'u1', label: 'Ev', status: 'active', topic: 'deneyap/kart1' },
      { device_id: 'DK-2', owner_id: 'u1', label: 'Garaj', status: 'release_pending' },
      { device_id: 'DK-7', owner_id: 'BAŞKASI', label: 'Başkasının', status: 'active' }
    ]
  });
  const rows = await d.D.list();
  const ids = rows.map(function (r) { return r.id; });
  eq(ids.length, 3, 'listede 3 kayıt (2 bağlı + 1 yalnız yerel)');
  ok(ids.indexOf('DK-7') === -1, 'başkasının cihazı listelenmez');
  ok(ids.indexOf('DK-9') !== -1, 'yerelde bilinen bağlanmamış kimlik listelenir');
  const dk1 = rows.filter(function (r) { return r.id === 'DK-1'; })[0];
  const dk2 = rows.filter(function (r) { return r.id === 'DK-2'; })[0];
  ok(dk1.active === true, 'aktif cihaz işaretlendi');
  eq(dk2.status, 'release_pending', 'serbest bırakma talebi durumu korunur');
  eq(dk2.topic, 'deneyap/kart1', 'konusu olmayan kayıt mevcut konuya düşer');

  console.log('\nE) Aktif seçimi bırakma ve temizleme');

  const e = kur({ mqttTopic: 'deneyap/kart1', activeDeviceId: 'DK-1', deviceTopics: { 'DK-1': 'deneyap/kart1' } }, { uid: 'u1', rows: [] });
  e.D.clearActive();
  eq(e.D.currentId(), '', 'aktif seçim bırakıldı');
  e.D.setTopic('DK-1', '');
  eq(e.D.topics()['DK-1'], undefined, 'boş konu haritadan silinir');

  console.log('\nSONUÇ: ' + gecti + ' geçti, ' + basarisiz + ' başarısız\n');
  process.exit(basarisiz === 0 ? 0 : 1);
})();
