#!/usr/bin/env node
/* ==========================================================================
   tools/publish-ota.js — firmware ikilisini Firebase'e yayınlar
   --------------------------------------------------------------------------
   Kullanım:
     npm run fw:bin
     set FIREBASE_SERVICE_ACCOUNT=C:\yol\serviceAccount.json
     npm run ota:publish -- --file build/ota/deneyap-ev-koruma-3.5.0.bin \
       --version 3.5.0 --channel stable --notes "Bulut OTA"

   Gerekli:
     • Firebase servis hesabı (FIREBASE_SERVICE_ACCOUNT veya --key)
     • Firebase Storage'da yazma izni
     • Firestore'da firmware_releases/{channel} yazma izni

   Ne yapar?
     1. .bin dosyasının SHA-256 özetini ve boyutunu hesaplar.
     2. Dosyayı `firmware/<kanal>/<ad>-<sürüm>.bin` yoluna yükler.
     3. `firmware_releases/<kanal>` belgesini günceller.
     4. API bir sonraki denetimde cihazlara imzalı indirme adresi verir.

   Bu betik Vercel'e veya repoya ikili dosya koymaz. Yalnızca Storage'a yazar.
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  return fallback;
}
function flag(name) {
  return process.argv.indexOf('--' + name) >= 0;
}
function fail(msg) {
  console.error('\n[!] ' + msg + '\n');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const fileArg = arg('file', '');
if (!fileArg) fail('--file gerekli. Önce `npm run fw:bin` çalıştırın.');
const filePath = path.isAbsolute(fileArg) ? fileArg : path.join(root, fileArg);
if (!fs.existsSync(filePath)) fail('Dosya bulunamadı: ' + filePath);

const version = arg('version', '').trim();
if (!/^\d+\.\d+\.\d+([.-][0-9A-Za-z]+)?$/.test(version)) {
  fail('--version geçerli bir sürüm olmalı (ör. 3.5.0).');
}
const channel = (arg('channel', 'stable') || 'stable').trim().toLowerCase();
if (!/^[a-z0-9_-]{1,32}$/.test(channel)) fail('--channel yalnızca a-z, 0-9, _ ve - içerebilir.');

const notes = String(arg('notes', '') || '').slice(0, 500);
const minVersion = String(arg('min-version', '') || '').trim();
const mandatory = flag('mandatory');
const dry = flag('dry');

const buf = fs.readFileSync(filePath);
if (buf.length < 10000) fail('Dosya çok küçük; doğru firmware .bin dosyası mı?');
if (buf.length > 8 * 1024 * 1024) fail('Dosya 8 MB sınırından büyük; yanlış dosya olabilir.');

const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
const size = buf.length;
const fileName = 'deneyap-ev-koruma-' + version + '.bin';
const storagePath = 'firmware/' + channel + '/' + fileName;

function loadCredential() {
  const keyArg = arg('key', '');
  const envRaw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  let raw = '';
  let source = '';

  if (keyArg) {
    if (!fs.existsSync(keyArg)) fail('Servis hesabı dosyası yok: ' + keyArg);
    raw = fs.readFileSync(keyArg, 'utf8');
    source = '--key';
  } else if (envRaw) {
    if (envRaw.trim().startsWith('{')) {
      raw = envRaw;
      source = 'FIREBASE_SERVICE_ACCOUNT (JSON)';
    } else if (fs.existsSync(envRaw)) {
      raw = fs.readFileSync(envRaw, 'utf8');
      source = 'FIREBASE_SERVICE_ACCOUNT (dosya)';
    } else {
      raw = envRaw;
      source = 'FIREBASE_SERVICE_ACCOUNT';
    }
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!fs.existsSync(p)) fail('GOOGLE_APPLICATION_CREDENTIALS dosyası yok: ' + p);
    raw = fs.readFileSync(p, 'utf8');
    source = 'GOOGLE_APPLICATION_CREDENTIALS';
  }

  if (!raw) {
    fail('Servis hesabı bulunamadı. FIREBASE_SERVICE_ACCOUNT değişkenini JSON veya dosya yolu olarak verin, ya da --key kullanın.');
  }
  let creds;
  try { creds = JSON.parse(raw); }
  catch (e) { fail('Servis hesabı JSON okunamadı: ' + e.message); }
  if (creds.private_key) creds.private_key = String(creds.private_key).replace(/\\n/g, '\n');
  if (!creds.project_id) fail('Servis hesabında project_id yok.');
  return { creds, source };
}

async function main() {
  const { creds, source } = loadCredential();
  const projectId = creds.project_id;
  const explicitBucket = String(arg('bucket', '') || process.env.FIREBASE_STORAGE_BUCKET || '').trim();
  const candidates = Array.from(new Set([
    explicitBucket,
    projectId + '.firebasestorage.app',
    projectId + '.appspot.com'
  ].filter(Boolean)));

  console.log('\n[i] Proje      : ' + projectId);
  console.log('[i] Kanal      : ' + channel);
  console.log('[i] Sürüm      : ' + version);
  console.log('[i] Dosya      : ' + path.relative(root, filePath));
  console.log('[i] Boyut      : ' + size + ' bayt');
  console.log('[i] SHA-256    : ' + sha256);
  console.log('[i] Storage    : ' + storagePath);
  console.log('[i] Kimlik     : ' + source);

  if (dry) {
    console.log('\n[i] --dry: yükleme ve Firestore yazımı atlandı.\n');
    return;
  }

  admin.initializeApp({
    credential: admin.credential.cert(creds),
    projectId: projectId
  });

  let uploaded = null;
  for (const bucketName of candidates) {
    try {
      const bucket = admin.storage().bucket(bucketName);
      const file = bucket.file(storagePath);
      await file.save(buf, {
        resumable: false,
        contentType: 'application/octet-stream',
        metadata: {
          cacheControl: 'public, max-age=3600',
          metadata: {
            version: version,
            channel: channel,
            sha256: sha256
          }
        }
      });
      uploaded = bucketName;
      break;
    } catch (e) {
      console.log('[i] Kova denenemedi (' + bucketName + '): ' + (e && e.message));
    }
  }
  if (!uploaded) fail('Firmware hiçbir Storage kovasına yüklenemedi. --bucket ile doğru kovayı verin.');

  const now = new Date();
  await admin.firestore().collection('firmware_releases').doc(channel).set({
    channel: channel,
    version: version,
    storage_path: storagePath,
    bucket: uploaded,
    sha256: sha256,
    size: size,
    notes: notes,
    mandatory: mandatory,
    min_version: minVersion,
    filename: fileName,
    published_at: now.toISOString(),
    published_at_ms: now.getTime(),
    published_by: 'tools/publish-ota.js'
  }, { merge: true });

  console.log('\n[OK] Firmware yayınlandı.');
  console.log('     Kova   : ' + uploaded);
  console.log('     Belge  : firmware_releases/' + channel);
  console.log('     Sürüm  : ' + version);
  console.log('\n     Cihazlar bir sonraki OTA denetiminde güncellemeyi görecek.\n');
}

main().catch(function (e) {
  fail(e && e.stack ? e.stack : String(e));
});
