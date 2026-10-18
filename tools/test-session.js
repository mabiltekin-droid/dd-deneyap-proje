#!/usr/bin/env node
/* ==========================================================================
   test-session.js — oturum güvenliğinin SAF mantığını kaynaktan çekip sınar.

   İki işlev gerçek kaynak dosyalardan alınır (kopyası değil):
     • firebase.js → tokenAuthTime() : ID token'ın auth_time damgası (ms)
     • config.js   → App.passwordIssue() : şifre politikası

   Neden: auth_time yanlış okunursa panel her işlemde gereksiz yere "tekrar
   doğrula" ister (kullanılamaz hâle gelir); şifre politikası da kayıt/şifre
   değiştirme akışlarını doğrudan etkiler.

   Kullanım: npm run test:session
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

function b64url(o) {
  return Buffer.from(JSON.stringify(o)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* Kaynaktan bir fonksiyonu çeker ve çalıştırır; bulunamazsa test DÜŞER
   (sessizce geçmez), böylece kod yeniden düzenlense de fark edilir. */
function kaynaktan(dosya, baslangic, bitisDeseni) {
  const src = fs.readFileSync(path.join(ROOT, dosya), 'utf8');
  const i = src.indexOf(baslangic);
  if (i === -1) return null;
  const j = src.indexOf(bitisDeseni, i);
  if (j === -1) return null;
  return src.slice(i, j + bitisDeseni.length);
}

console.log('\nA) tokenAuthTime — ID token auth_time okuma');

const ttSrc = kaynaktan('pwa/js/firebase.js',
  'function tokenAuthTime(idToken) {', '\n  }');
if (!ttSrc) {
  ok(false, 'firebase.js içinde tokenAuthTime bulunamadı (yeniden adlandırıldı mı?)');
} else {
  const tokenAuthTime = new Function('atob', 'return (' + ttSrc + ')')(atob);

  const at = 1700000000;
  const jwt = b64url({ alg: 'none', typ: 'JWT' }) + '.' + b64url({ sub: 'u1', auth_time: at }) + '.';
  ok(tokenAuthTime(jwt) === at * 1000, 'imzasız token → auth_time ms olarak okundu');
  ok(tokenAuthTime(jwt) === 1700000000000, 'değer doğru (1700000000000)');

  /* base64url dolgusuz ve +/- karakterli tokenlar da çözülmeli */
  const jwt2 = b64url({ alg: 'none' }) + '.' + b64url({ auth_time: 42, x: '???>>>' }) + '.';
  ok(tokenAuthTime(jwt2) === 42000, 'base64url özel karakterleri doğru çözüldü');

  ok(tokenAuthTime('') === 0, 'boş token → 0');
  ok(tokenAuthTime('bozuk-token') === 0, 'bozuk token → 0 (çökmüyor)');
  ok(tokenAuthTime(b64url({ alg: 'none' }) + '.' + b64url({ sub: 'u1' }) + '.') === 0,
    'auth_time yoksa → 0 (uydurma taze giriş yok)');
}

console.log('\nB) App.passwordIssue — şifre politikası');

const pwSrc = kaynaktan('pwa/js/config.js',
  'App.passwordIssue = function (pw) {', '\n  };');
if (!pwSrc) {
  ok(false, 'config.js içinde App.passwordIssue bulunamadı');
} else {
  const issue = new Function('return (' +
    pwSrc.replace('App.passwordIssue = ', '').replace(/;[\s]*$/, '') + ')')();

  ok(issue('') === 'Şifre girin.', 'boş şifre reddedildi');
  ok(/8 karakter/.test(issue('Ab1cdef')), '7 karakter reddedildi');
  ok(/bir harf/.test(issue('12345678')), 'rakam-only reddedildi');
  ok(/bir rakam/.test(issue('uzunparola')), 'rakamsız reddedildi');
  ok(/tahmin edilebilir/.test(issue('password12')), 'tahmin edilebilir şifre reddedildi');
  ok(/tahmin edilebilir/.test(issue('Deneyap123')), 'proje adını içeren şifre reddedildi');
  ok(issue('Evim2026!') === '', 'güçlü şifre kabul edildi');
  ok(issue('Kartal42x') === '', 'harf+rakam+8 karakter kabul edildi');
  ok(issue('Şifreçok9') === '', 'Türkçe karakterli güçlü şifre kabul edildi');
}

console.log('\nSONUÇ: ' + gecti + ' geçti, ' + basarisiz + ' başarısız\n');
process.exit(basarisiz === 0 ? 0 : 1);
