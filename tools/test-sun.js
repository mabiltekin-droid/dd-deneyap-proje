#!/usr/bin/env node
/* ==========================================================================
   test-sun.js — gün doğumu / gün batımı hesabını sınar (config.js → App.sunTimes)

   Neden: zamanlanmış otomasyon bu saate göre mod değiştirir. Yanlış hesap
   "gece modu gündüz başlıyor" gibi sessiz hatalara yol açar.

   Testler SAAT DİLİMİNDEN BAĞIMSIZ: mutlak saati değil GÜN UZUNLUĞUNU
   (batış - doğuş) ve tutarlılığı denetler. Böylece her makinede geçer.

   Kullanım: npm run test:sun
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let gecti = 0, basarisiz = 0;
function ok(cond, msg) {
  if (cond) { gecti += 1; console.log('  \u2713 ' + msg); }
  else { basarisiz += 1; console.log('  \u2717 ' + msg); }
}

/* Fonksiyonu GERÇEK kaynaktan çek (kopyası değil). */
function sunTimes() {
  const src = fs.readFileSync(path.join(ROOT, 'pwa/js/config.js'), 'utf8');
  const i = src.indexOf('App.sunTimes = function (date, lat, lon) {');
  if (i === -1) return null;
  const j = src.indexOf('\n  };', i);
  if (j === -1) return null;
  const body = src.slice(i, j + 4).replace('App.sunTimes = ', '').replace(/;[\s]*$/, '');
  return new Function('return (' + body + ')')();
}

const IKI = { lat: 41.0082, lon: 28.9784 };   // İstanbul
const SIDNEY = { lat: -33.8688, lon: 151.2093 };
const EKVATOR = { lat: 0, lon: 0 };

function gunUzunlugu(t) {
  if (!t || t.sunriseMin == null || t.sunsetMin == null) return null;
  let d = t.sunsetMin - t.sunriseMin;
  if (d < 0) d += 1440;       // gece yarısını aşan yerel saat okuması
  return d;
}

console.log('\nA) İstanbul — gündönümü gün uzunlukları');

const f = sunTimes();
if (!f) {
  ok(false, 'config.js içinde App.sunTimes bulunamadı');
} else {
  const yaz = f(new Date(2026, 5, 21), IKI.lat, IKI.lon);      // 21 Haziran
  const kis = f(new Date(2026, 11, 21), IKI.lat, IKI.lon);     // 21 Aralık

  const yazDk = gunUzunlugu(yaz), kisDk = gunUzunlugu(kis);
  ok(yazDk !== null, 'yaz gündönümü hesaplandı (' + yazDk + ' dk)');
  ok(yazDk >= 900 && yazDk <= 935, 'yaz gün uzunluğu ~15 sa 08 dk (900-935)');
  ok(kisDk !== null, 'kış gündönümü hesaplandı (' + kisDk + ' dk)');
  ok(kisDk >= 535 && kisDk <= 570, 'kış gün uzunluğu ~9 sa 13 dk (535-570)');
  ok(yazDk > kisDk + 240, 'yaz günü kıştan en az 4 saat uzun');

  console.log('\nB) Tutarlılık (saat diliminden bağımsız)');
  ok(yaz.sunriseMin >= 0 && yaz.sunriseMin < 1440, 'doğuş 0-1439 dk aralığında');
  ok(yaz.sunsetMin >= 0 && yaz.sunsetMin < 1440, 'batış 0-1439 dk aralığında');
  ok(yaz.sunriseMin < yaz.sunsetMin, 'yaz: doğuş batıştan önce');
  ok(kis.sunriseMin < kis.sunsetMin, 'kış: doğuş batıştan önce');
  ok(yaz.sunrise instanceof Date && !isNaN(yaz.sunrise.getTime()), 'doğuş geçerli Date');

  console.log('\nC) Güney yarımküre & ekvator');
  const sidneyKis = gunUzunlugu(f(new Date(2026, 5, 21), SIDNEY.lat, SIDNEY.lon));
  ok(sidneyKis >= 570 && sidneyKis <= 620, 'Sidney haziran (kış) ~9 sa 55 dk (570-620)');
  const ekv = gunUzunlugu(f(new Date(2026, 2, 20), EKVATOR.lat, EKVATOR.lon));
  ok(ekv >= 705 && ekv <= 735, 'ekvator ekinoksta ~12 sa (705-735)');

  console.log('\nD) Kenar durumlar');
  ok(f(new Date(2026, 5, 21), null, null) === null, 'konum yoksa null (kural yazılı saate düşer)');
  const kutup = f(new Date(2026, 11, 21), 89, 0);
  ok(kutup && kutup.sunriseMin === null, 'kutup gecesinde doğuş null');
  ok(kutup && kutup.sunsetMin === null, 'kutup gecesinde batış null');
  ok(f(new Date(2026, 5, 21), 41, 28) !== null, 'sayısal olmayan tarih de çalışır (new Date)');
  ok(f(Date.now(), IKI.lat, IKI.lon) !== null, 'şimdiki zamanla hesaplanabilir');
}

console.log('\nSONUÇ: ' + gecti + ' geçti, ' + basarisiz + ' başarısız\n');
process.exit(basarisiz === 0 ? 0 : 1);
