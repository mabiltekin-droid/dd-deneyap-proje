#!/usr/bin/env node
/* ==========================================================================
   run-rules-test.js — Firestore kuralları testini emülatörde çalıştırır.

   Java 11+ gerekir (Firestore emülatörü). Bu sarmalayıcı uygun bir Java
   bulur (JAVA_HOME → PATH → yaygın kurulum yerleri; ör. Android Studio'nun
   JBR'si) ve emülatörü başlatıp tools/test-rules.js'i koşturur.

   Kullanım: npm run test:rules
   ========================================================================== */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJE = 'demo-dd-local';

function javaSurum(bin) {
  try {
    const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
    const s = String((r.stderr || '') + (r.stdout || ''));
    const m = s.match(/version "(\d+)/);
    return m ? Number(m[1]) : 0;
  } catch (e) { return 0; }
}

function adaylar() {
  const list = [];
  if (process.env.JAVA_HOME) list.push(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'));
  list.push('java');

  const kokler = [
    'C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\java.exe',
    'C:\\Program Files\\Java\\jdk-21\\bin\\java.exe',
    'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe'
  ];
  kokler.forEach(function (p) { list.push(p); });

  /* Eclipse Adoptium / Microsoft / Zulu / kullanıcı .jdks gibi
     sürüm numaralı kurulumlar */
  [process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.jdks') : null,
   'C:\\Program Files\\Eclipse Adoptium',
   'C:\\Program Files\\Microsoft',
   'C:\\Program Files\\Zulu',
   'C:\\Program Files\\Java'].forEach(function (kok) {
    if (!kok) return;
    try {
      fs.readdirSync(kok).forEach(function (d) {
        list.push(path.join(kok, d, 'bin', 'java.exe'));
      });
    } catch (e) { /* dizin yok */ }
  });
  return list;
}

/* firebase-tools 15+, Java 21+ ister; bu yüzden EN YÜKSEK sürümü seçeriz
   (Java 8/17 ilk sırada bulunsa bile atlanır). */
function uygunJavaBul() {
  const list = adaylar();
  let enIyi = null;
  list.forEach(function (bin) {
    const v = javaSurum(bin);
    if (!enIyi || v > enIyi.surum) enIyi = { bin: bin, surum: v };
  });
  if (enIyi && enIyi.surum >= 21) return enIyi;
  if (enIyi && enIyi.surum >= 11) return enIyi;
  return null;
}

const java = uygunJavaBul();
if (!java) {
  console.error('\n[!] Java 11+ bulunamadı — Firestore emülatörü bunu gerektirir.');
  console.error('    Kurulu Java 8 ise, örneğin Android Studio\'nun Java\'sı kullanılabilir:');
  console.error('    $env:JAVA_HOME="C:\\Program Files\\Android\\Android Studio\\jbr"');
  console.error('    npm run test:rules\n');
  process.exit(2);
}

console.log('[i] Java ' + java.surum + ' kullanılıyor: ' + java.bin);

const javaBin = path.dirname(java.bin);
const env = Object.assign({}, process.env, {
  JAVA_HOME: path.dirname(javaBin),
  PATH: javaBin + path.delimiter + process.env.PATH
});

/* Emülatör başlarken firestore.rules dosyasını DERLER; sözdizimi/tip hatası
   varsa başlamaz ve test hiç çalışmaz (yani bu adım kural derleme denetimidir). */
const cmd = 'npx --no-install firebase emulators:exec --only firestore --project ' +
  PROJE + ' "node tools/test-rules.js"';

console.log('[i] ' + cmd + '\n');
const r = spawnSync(cmd, { stdio: 'inherit', env: env, shell: true });
process.exit(typeof r.status === 'number' ? r.status : 1);
