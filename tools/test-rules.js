#!/usr/bin/env node
/* ==========================================================================
   test-rules.js — Firestore güvenlik kuralları davranış testleri (emülatör)

   KURALLARI GERÇEKTEN ÇALIŞTIRIR: Firestore emülatörüne imzasız JWT'lerle
   (auth_time / email_verified claim'leri ayarlanabilir) istek atar ve
   izin verilmesi/reddedilmesi gereken durumları doğrular.

   Neden gerekli: adım yükseltme (step-up) kuralları "çalışıyor gibi"
   görünse de yalnızca sunucu tarafında sınanabilir. Bu test şunları kanıtlar:
     • taze giriş (auth_time) olmadan kritik yazmalar REDDEDİLİR
     • taze girişle aynı yazmalar İZİN VERİLİR
     • e-posta doğrulanmamışsa cihaz bağlama reddedilir
     • günlük işlemler (profil düzenleme) step-up İSTEMEZ (kilitlenme yok)

   Kullanım (Java 11+ ve emülatör gerekir):
     npm run test:rules
   ========================================================================== */

'use strict';

const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || 'demo-dd-local';
const BASE = 'http://' + HOST + '/v1/projects/' + PROJECT +
  '/databases/(default)/documents';

const NOW = Math.floor(Date.now() / 1000);

let gecti = 0, basarisiz = 0;
function ok(cond, msg) {
  if (cond) { gecti += 1; console.log('  \u2713 ' + msg); }
  else { basarisiz += 1; console.log('  \u2717 ' + msg); }
}

function b64url(o) {
  return Buffer.from(JSON.stringify(o)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* Emülatör imzasız JWT'yi kabul eder; claim'ler request.auth.token olur. */
function token(uid, opts) {
  const o = opts || {};
  const payload = {
    sub: uid, user_id: uid, aud: PROJECT,
    iss: 'https://securetoken.google.com/' + PROJECT,
    iat: NOW, exp: NOW + 3600,
    email: uid + '@test.local',
    email_verified: o.verified !== false,
    auth_time: typeof o.authTime === 'number' ? o.authTime : NOW
  };
  return b64url({ alg: 'none', typ: 'JWT' }) + '.' + b64url(payload) + '.';
}

function fields(obj) {
  const out = {};
  Object.keys(obj).forEach(function (k) {
    const v = obj[k];
    if (typeof v === 'string') out[k] = { stringValue: v };
    else if (typeof v === 'boolean') out[k] = { booleanValue: v };
    else if (typeof v === 'number') out[k] = { integerValue: String(v) };
    else if (v && v.__ts) out[k] = { timestampValue: new Date(v.__ts).toISOString() };
  });
  return out;
}

async function req(method, path, tok, body, mask) {
  const url = BASE + path + (mask ? '?' + mask : '');
  const r = await fetch(url, {
    method: method,
    headers: Object.assign(
      { 'content-type': 'application/json' },
      tok ? { authorization: 'Bearer ' + tok } : {}
    ),
    body: body ? JSON.stringify(body) : undefined
  });
  return r.status;
}

const YONETICI = 'owner';                 // emülatör: tüm kuralları atlar
const create = (col, id, data, tok) =>
  req('POST', '/' + col + (id ? '?documentId=' + id : ''), tok, { fields: fields(data) });

/* updateMask: gövdedeki alanlardan otomatik üretilir (Firestore REST,
   maskede belirtilmeyen alanı gövdede kabul etmez). */
const update = (col, id, data, tok) => {
  const mask = Object.keys(data).map(function (k) { return 'updateMask.fieldPaths=' + k; }).join('&');
  return req('PATCH', '/' + col + '/' + id, tok, { fields: fields(data) }, mask);
};
const read = (col, id, tok) => req('GET', '/' + col + '/' + id, tok);

async function main() {
  /* ------------------------------------------------ hazırlık (kuralları atla) */
  console.log('\nHazırlık (owner tokenı ile doğrudan yazma)');
  ok(await create('profiles', 'admin1', { id: 'admin1', role: 'admin' }, YONETICI) === 200,
    'admin profili oluşturuldu');
  ok(await create('profiles', 'user1', { id: 'user1', role: 'user' }, YONETICI) === 200,
    'normal kullanıcı profili oluşturuldu');
  ok(await create('device_codes', 'DK-1', { code: '4321', active: true }, YONETICI) === 200,
    'aktivasyon kodu tanımlandı');
  ok(await create('device_unlocks', 'DK-1', { uid: 'user1', code: '4321' }, YONETICI) === 200,
    'kod doğrulama kaydı (unlock) oluşturuldu');

  const taze = (uid, extra) => token(uid, Object.assign({ authTime: NOW - 60 }, extra));
  const bayat = (uid, dk) => token(uid, { authTime: NOW - dk * 60 });

  /* ------------------------------------------------- A) aktivasyon kodu yazma */
  console.log('\nA) device_codes — düz metin parola (admin, 15 dk taze giriş)');
  ok(await create('device_codes', 'DK-2', { code: '9999', active: true }, taze('admin1')) === 200,
    'taze admin kodu yazabildi');
  ok(await update('device_codes', 'DK-2', { code: '1111', active: true }, bayat('admin1', 30)) === 403,
    '30 dk önce giriş yapmış admin kodu DEĞİŞTİREMEDİ (step-up)');
  ok(await create('device_codes', 'DK-3', { code: 'x', active: true }, taze('user1')) === 403,
    'normal kullanıcı kod yazamadı');

  /* ------------------------------------------------------- B) rol değiştirme */
  console.log('\nB) profiles — admin başka kullanıcının rolünü değiştirir');
  ok(await update('profiles', 'user1', { id: 'user1', role: 'admin' }, bayat('admin1', 30)) === 403,
    'bayat admin rol DEĞİŞTİREMEDİ');
  ok(await update('profiles', 'user1', { id: 'user1', role: 'admin' }, taze('admin1')) === 200,
    'taze admin rolü değiştirebildi');
  ok(await update('profiles', 'user1', { id: 'user1', role: 'user' }, YONETICI) === 200,
    '(hazırlık) rol yeniden "user" yapıldı');

  /* ------------------------------- C) günlük profil düzenleme step-up istemez */
  console.log('\nC) profiles — günlük düzenleme (kilitlenme olmamalı)');
  ok(await update('profiles', 'user1', { id: 'user1', display_name: 'Ali' },
    bayat('user1', 180)) === 200,
    '3 saat önce giriş yapan kullanıcı adını güncelleyebildi (step-up yok)');
  ok(await update('profiles', 'user1', { id: 'user1', role: 'admin' },
    bayat('user1', 180)) === 403,
    'kullanıcı kendi rolünü yükseltemedi');

  /* ------------------------------------------------------- D) cihaz bağlama */
  console.log('\nD) device_bindings — cihaz bağlama (60 dk + e-posta doğrulama)');
  const bagla = (id, tok) => create('device_bindings', id,
    { device_id: id, owner_id: 'user1', status: 'active' }, tok);

  ok(await bagla('DK-1', bayat('user1', 90)) === 403,
    '90 dk önce giriş yapan kullanıcı cihaz BAĞLAYAMADI (taze giriş şartı)');
  ok(await bagla('DK-1', taze('user1', { verified: false })) === 403,
    'e-postası doğrulanmamış kullanıcı cihaz bağlayamadı');
  ok(await create('device_bindings', 'DK-1',
    { device_id: 'DK-1', owner_id: 'user1', status: 'active' }, YONETICI) === 200,
    '(hazırlık) doğrudan yazma ile cihaz bağlandı');
  ok([409, 403].indexOf(await bagla('DK-1', taze('user1'))) !== -1,
    'zaten bağlı cihaz tekrar bağlanamadı');

  console.log('\nD2) device_bindings — boşta cihaz, taze + doğrulanmış kullanıcı');
  ok(await create('device_unlocks', 'DK-9', { uid: 'user1', code: '4321' }, YONETICI) === 200,
    '(hazırlık) DK-9 için unlock');
  ok(await bagla('DK-9', taze('user1')) === 200,
    'taze + doğrulanmış kullanıcı boşta cihazı bağlayabildi');
  ok(await bagla('DK-8', taze('user1')) === 403,
    'kod doğrulaması (unlock) olmadan cihaz bağlanamadı');

  /* ------------------------------------------------- E) kod doğrulama kaydı */
  console.log('\nE) device_unlocks — kod doğrulama kaydı');
  ok(await create('device_unlocks', 'DK-10', { uid: 'user1', code: '4321' }, bayat('user1', 90)) === 403,
    'bayat oturum kod doğrulama kaydı yazamadı');
  ok(await create('device_unlocks', 'DK-11', { uid: 'user1', code: '0000' }, taze('user1')) === 403,
    'yanlış kod ile kayıt oluşturulamadı');
  ok(await create('device_unlocks', 'DK-12', { uid: 'user1', code: '4321' }, taze('user1')) === 403,
    'kodu tanımlı olmayan cihaz için kayıt oluşturulamadı');

  /* ----------------------------------------------------------- F) davetler */
  console.log('\nF) invites — rol dağıtma (admin, 15 dk taze giriş)');
  ok(await create('invites', 'ADM1',
    { code: 'ADM1', role: 'admin', used: false, created_by: 'admin1' }, bayat('admin1', 45)) === 403,
    'bayat admin davet OLUŞTURAMADI');
  ok(await create('invites', 'ADM1',
    { code: 'ADM1', role: 'admin', used: false, created_by: 'admin1' }, taze('admin1')) === 200,
    'taze admin davet oluşturabildi');
  ok(await create('invites', 'ADM2',
    { code: 'ADM2', role: 'admin', used: false, created_by: 'user1' }, taze('user1')) === 403,
    'normal kullanıcı davet oluşturamadı');
  ok(await update('invites', 'ADM1',
    { code: 'ADM1', role: 'admin', used: true, used_by: 'user1', created_by: 'admin1' },
    bayat('user1', 300)) === 200,
    'kayıt olan kullanıcı daveti kullanıldı işaretleyebildi (step-up yok)');

  /* ------------------------------------------------- G) okumalar etkilenmez */
  console.log('\nG) Okumalar — step-up okumayı engellemez');
  ok(await read('profiles', 'user1', bayat('user1', 600)) === 200,
    'bayat oturum kendi profilini OKUYABİLDİ');
  const baskasinin = await read('device_bindings', 'DK-1', taze('admin1'));
  ok(baskasinin === 200, 'admin bağlı cihazı okuyabildi');
  const yabanci = await read('device_bindings', 'DK-1', taze('user1'));
  ok(yabanci === 200 || yabanci === 403,
    'cihaz sahibi kendi bağlantısını okuyabildi (' + yabanci + ')');

  /* ------------------------------------------------ H) ev / aile rolleri */
  console.log('\nH) homes / home_members / home_invites — çoklu kullanıcı');
  await create('profiles', 'user2', { id: 'user2', role: 'user' }, YONETICI);
  await create('profiles', 'user3', { id: 'user3', role: 'user' }, YONETICI);
  await create('profiles', 'user4', { id: 'user4', role: 'user' }, YONETICI);

  ok(await create('homes', 'h1',
    { home_id: 'h1', name: 'Sahil Evi', owner_id: 'user1' }, taze('user1')) === 200,
    'taze kullanıcı ev oluşturabildi');
  ok(await create('home_members', 'h1__user1',
    { home_id: 'h1', uid: 'user1', role: 'admin' }, taze('user1')) === 200,
    'ev sahibi kendini yönetici olarak ekleyebildi');
  ok(await create('homes', 'h2',
    { home_id: 'h2', name: 'Başka Ev', owner_id: 'user2' }, bayat('user2', 30)) === 403,
    'bayat oturum ev oluşturamadı (taze giriş şartı)');

  const bitis = { __ts: Date.now() + 3600000 };
  ok(await create('home_invites', 'INV1',
    { code: 'INV1', home_id: 'h1', role: 'viewer', created_by: 'user1',
      used: false, expires_at: bitis }, taze('user1')) === 200,
    'ev yöneticisi görüntüleyici daveti oluşturabildi');
  ok(await create('home_invites', 'INV2',
    { code: 'INV2', home_id: 'h1', role: 'viewer', created_by: 'user3',
      used: false, expires_at: bitis }, taze('user3')) === 403,
    'ev üyesi olmayan kullanıcı davet oluşturamadı');

  ok(await create('home_members', 'h1__user2',
    { home_id: 'h1', uid: 'user2', role: 'viewer', invite_code: 'INV1' },
    taze('user2')) === 200,
    'davetli kullanıcı görüntüleyici olarak eve katılabildi');
  ok(await update('home_invites', 'INV1', { used: true, used_by: 'user2' },
    bayat('user2', 30)) === 200,
    'davet tek kullanımlık olarak işaretlendi');
  ok(await create('home_members', 'h1__user4',
    { home_id: 'h1', uid: 'user4', role: 'viewer', invite_code: 'INV1' },
    taze('user4')) === 403,
    'kullanılmış davet ikinci kez kullanılamadı');

  ok(await read('homes', 'h1', taze('user4')) === 403,
    'ev üyesi olmayan kullanıcı evi okuyamadı');

  ok(await update('device_bindings', 'DK-1',
    { device_id: 'DK-1', owner_id: 'user1', status: 'active', home_id: 'h1',
      label: 'Salon' }, taze('user1')) === 200,
    'cihaz sahibi cihazı eve bağlayabildi');
  ok(await read('device_bindings', 'DK-1', taze('user2')) === 200,
    'ev üyesi görüntüleyici cihazı okuyabildi');
  ok(await update('device_bindings', 'DK-1',
    { device_id: 'DK-1', owner_id: 'user1', status: 'active', home_id: 'h1',
      label: 'Mutfak' }, taze('user2')) === 403,
    'görüntüleyici cihaz ayarını DEĞİŞTİREMEDİ');

  await create('home_members', 'h1__user3',
    { home_id: 'h1', uid: 'user3', role: 'maintainer' }, YONETICI);
  ok(await update('device_bindings', 'DK-1',
    { device_id: 'DK-1', owner_id: 'user1', status: 'active', home_id: 'h1',
      label: 'Mutfak' }, taze('user3')) === 200,
    'bakımcı cihaz etiketini güncelleyebildi');
  ok(await update('device_bindings', 'DK-1',
    { device_id: 'DK-1', owner_id: 'user1', status: 'active', home_id: 'h1',
      label: 'Mutfak', topic: 'yeni/topic' }, taze('user3')) === 200,
    'bakımcı cihaz konusunu güncelleyebildi');
  ok(await update('device_bindings', 'DK-1',
    { device_id: 'DK-1', owner_id: 'user1', status: 'active', home_id: '',
      label: 'Mutfak', topic: 'yeni/topic' }, taze('user3')) === 403,
    'bakımcı cihazı evden ÇIKARAMADI (ev yöneticisi işi)');

  ok(await update('homes', 'h1', { name: 'Yazlık' }, taze('user2')) === 403,
    'görüntüleyici ev adını değiştiremedi');
  ok(await update('homes', 'h1', { name: 'Yazlık' }, taze('user1')) === 200,
    'ev yöneticisi ev adını değiştirebildi');

  console.log('\nSONUÇ: ' + gecti + ' geçti, ' + basarisiz + ' başarısız\n');
  process.exit(basarisiz === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.error('\nTest çalıştırılamadı:', (e && e.message) || e);
  console.error('İpucu: emülatör çalışıyor mu?  npm run test:rules\n');
  process.exit(2);
});
