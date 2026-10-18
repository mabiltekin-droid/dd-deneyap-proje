#!/usr/bin/env node
/* ==========================================================================
   gen-vapid.js — Web Push için VAPID anahtar çifti üretir (tek seferlik).
   --------------------------------------------------------------------------
   VAPID = "Voluntary Application Server Identification". Tarayıcı aboneliği
   genel anahtarla imzalanır; bildirimi yalnızca özel anahtarı bilen gönderici
   (Vercel fonksiyonu api/push.js) gönderebilir.

   Üretilenler:
     .vapid.json            → { publicKey, privateKey }  (SÜRÜM KONTROLÜNE GİRMEZ)
     pwa/js/config.js       → App.VAPID_PUBLIC_KEY (elle kopyalanır; aşağıda yazar)

   Vercel ortam değişkenlerine şunlar girilir (özel anahtar ASLA depoya girmez):
     VAPID_PUBLIC_KEY   = .vapid.json içindeki publicKey
     VAPID_PRIVATE_KEY  = .vapid.json içindeki privateKey
     VAPID_SUBJECT      = mailto:sizin-adresiniz (ör. mailto:ali@ornek.com)
     PUSH_TRIGGER_SECRET= uzun rastgele anahtar (firmware PUSH_SECRET ile aynı)
     FIREBASE_SERVICE_ACCOUNT = servis hesabı JSON'u (tek satır)

   Kullanım:  node tools/gen-vapid.js [--force]
   ========================================================================== */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.vapid.json');
const force = process.argv.indexOf('--force') !== -1;

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

if (fs.existsSync(OUT) && !force) {
  console.log('\n  .vapid.json zaten var — üzerine yazmak için: node tools/gen-vapid.js --force');
  console.log('  (Anahtarları değiştirirseniz MEVCUT abonelikler geçersiz olur;');
  console.log('   panelde arka plan bildirimini kapatıp yeniden açmanız gerekir.)\n');
  process.exit(0);
}

/* ECDH P-256: genel anahtar 65 bayt (0x04 || X || Y), özel anahtar 32 bayt. */
const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();

const publicKey = b64url(ecdh.getPublicKey());     // tarayıcıya gider (gizli değil)
const privateKey = b64url(ecdh.getPrivateKey());   // YALNIZCA göndericide durur
const triggerSecret = b64url(crypto.randomBytes(32));

fs.writeFileSync(OUT, JSON.stringify({
  publicKey: publicKey,
  privateKey: privateKey,
  triggerSecret: triggerSecret,
  note: 'Bu dosya .gitignore icindedir; Vercel ortam degiskenlerine kopyalayin.',
  created: new Date().toISOString()
}, null, 2) + '\n');

console.log('');
console.log('  VAPID anahtar çifti üretildi → ' + path.relative(ROOT, OUT));
console.log('  (dosya .gitignore içinde; depoya girmez)');
console.log('');
console.log('  1) pwa/js/config.js içine genel anahtarı yaz:');
console.log('');
console.log("       App.VAPID_PUBLIC_KEY = '" + publicKey + "';");
console.log('');
console.log('  2) Vercel > Proje > Settings > Environment Variables:');
console.log('       VAPID_PUBLIC_KEY    = ' + publicKey);
console.log('       VAPID_PRIVATE_KEY   = ' + privateKey);
console.log('       VAPID_SUBJECT       = mailto:sizin-adresiniz');
console.log('       PUSH_TRIGGER_SECRET = ' + triggerSecret);
console.log('       FIREBASE_SERVICE_ACCOUNT = (servis hesabı JSON, tek satır)');
console.log('');
console.log('  3) firmware-mqtt/DeneyapEvKoruma/config.h:');
console.log('       #define PUSH_URL    "https://<proje>.vercel.app/api/push"');
console.log('       #define PUSH_SECRET "' + triggerSecret + '"');
console.log('');
