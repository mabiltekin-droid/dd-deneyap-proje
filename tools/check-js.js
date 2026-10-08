#!/usr/bin/env node
/* ==========================================================================
   check-js.js — depoyu commit öncesi denetler. Bağımlılık yok.
   --------------------------------------------------------------------------
   Denetlenenler:
     1. Sözdizimi — pwa/ ve tools/ altındaki her .js dosyası
     2. Sürüm tutarlılığı — package.json = config.js (App.VERSION) = sw.js (VERSION)
        (+ firmware/config.h içindeki FW_VERSION, varsa)
     3. sw.js PRECACHE listesi — pwa/ içindeki her yerel dosya listede mi,
        listedeki her dosya gerçekten var mı
     4. HTML referansları — index.html/settings.html'in gösterdiği yerel dosyalar var mı
     5. A tutarlılığı — settings.js'in okuduğu her alan settings.html'de var mı;
        MQTT anahtarları config.js / settings.js / settings.html üçünde de tanımlı mı
     6. firmware/config.h — yoksa hatırlatma

   Kullanım: npm run check
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PWA = path.join(ROOT, 'pwa');

let hata = 0, uyari = 0;
const basarisiz = function (msg) { hata += 1; console.log('  ✗ ' + msg); };
const dikkat = function (msg) { uyari += 1; console.log('  ! ' + msg); };
const basarili = function (msg) { console.log('  ✓ ' + msg); };

function walk(dir, out) {
  out = out || [];
  let items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  items.forEach(function (it) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) walk(full, out);
    else out.push(full);
  });
  return out;
}

function oku(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------- 1. JavaScript sözdizimi */

console.log('\n[1/6] JavaScript sözdizimi');
const jsFiles = walk(PWA).filter(function (f) { return f.endsWith('.js'); })
  .concat(walk(path.join(ROOT, 'tools')).filter(function (f) { return f.endsWith('.js'); }));

let jsHata = 0;
jsFiles.forEach(function (f) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  try {
    /* new vm.Script yalnızca derler, çalıştırmaz */
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f });
  } catch (err) {
    jsHata += 1;
    basarisiz(rel + ' — ' + err.message);
  }
});
if (jsHata === 0) basarili(jsFiles.length + ' dosya sorunsuz');

/* --------------------------------------------- 2. sürüm üç yerden eşleşmeli */

console.log('\n[2/6] Sürüm tutarlılığı');
let surumler = {};

const pkg = oku('package.json');
if (!pkg) {
  basarisiz('package.json yok');
} else {
  try {
    surumler.package = JSON.parse(pkg).version;
  } catch (e) {
    basarisiz('package.json çözümlenemedi: ' + e.message);
  }
}

const configJs = oku('pwa/js/config.js');
const m1 = configJs && configJs.match(/App\.VERSION\s*=\s*'([^']+)'/);
if (m1) surumler.config = m1[1];
else basarisiz("pwa/js/config.js içinde App.VERSION bulunamadı");

const swJs = oku('pwa/sw.js');
const m2 = swJs && swJs.match(/const\s+VERSION\s*=\s*'([^']+)'/);
if (m2) surumler.sw = m2[1];
else basarisiz("pwa/sw.js içinde VERSION bulunamadı");

const configH = oku('firmware/config.h');
if (configH) {
  const m3 = configH.match(/#define\s+FW_VERSION\s+"([^"]+)"/);
  if (m3) surumler.firmware = m3[1];
}

const degerler = Object.keys(surumler).map(function (k) { return surumler[k]; });
const benzersiz = degerler.filter(function (v, i) { return degerler.indexOf(v) === i; });

if (Object.keys(surumler).length < 3) {
  basarisiz('sürümler okunamadı: ' + JSON.stringify(surumler));
} else if (benzersiz.length === 1) {
  basarili('hepsi v' + benzersiz[0] + ' — ' +
    Object.keys(surumler).join(' = '));
} else {
  basarisiz('sürümler ayrışık: ' + JSON.stringify(surumler) +
    ' — /surum komutuyla birlikte güncelle');
}

/* -------------------------------------------------- 3. sw.js PRECACHE listesi */

console.log('\n[3/6] sw.js PRECACHE listesi');
if (swJs) {
  const blok = swJs.match(/const\s+PRECACHE\s*=\s*\[([\s\S]*?)\]/);
  if (!blok) {
    basarisiz('sw.js içinde PRECACHE listesi bulunamadı');
  } else {
    const listelenen = [];
    blok[1].replace(/'([^']+)'/g, function (_, p) { listelenen.push(p); return _; });

    /* Liste bir değişkenle (ör. SHELL) giriyorsa onu da çöz */
    const shellM = swJs.match(/const\s+SHELL\s*=\s*'([^']+)'/);
    if (shellM && /\bSHELL\b/.test(blok[1]) && listelenen.indexOf(shellM[1]) === -1) {
      listelenen.push(shellM[1]);
    }

    /* sw.js'in kendisi cache'e girmez, listeye de girmez */
    const yerel = walk(PWA)
      .map(function (f) { return './' + path.relative(PWA, f).replace(/\\/g, '/'); })
      .filter(function (p) { return p !== './sw.js'; });

    const eksik = yerel.filter(function (p) { return listelenen.indexOf(p) === -1; });
    const olmayan = listelenen.filter(function (p) {
      return p !== './' && !fs.existsSync(path.join(PWA, p.replace(/^\.\//, '')));
    });

    if (eksik.length) {
      basarisiz('PRECACHE listesinde yok (cihazda ilk yüklemede bulunamaz):\n      ' +
        eksik.join('\n      '));
    }
    if (olmayan.length) {
      basarisiz('PRECACHE listesinde var ama diskte yok:\n      ' + olmayan.join('\n      '));
    }
    if (!eksik.length && !olmayan.length) {
      basarili(listelenen.length + ' giriş, pwa/ ile tam uyumlu');
    }
  }
}

/* ------------------------------------------------- 4. HTML yerel referansları */

console.log('\n[4/6] HTML dosya referansları');
['pwa/index.html', 'pwa/settings.html'].forEach(function (rel) {
  const src = oku(rel);
  if (!src) { basarisiz(rel + ' yok'); return; }
  const refs = [];
  const re = /(?:src|href)="(\.\/[^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) refs.push(m[1]);

  const bozuk = refs.filter(function (r) {
    /* "?x=1" ve "#bolum" kısımları dosya yolunun parçası değildir. */
    const hashIdx = r.indexOf('#');
    const hash = hashIdx !== -1 ? r.slice(hashIdx + 1) : '';
    const dosya = r.split('#')[0].split('?')[0].replace(/^\.\//, '');
    if (!dosya) return false;
    if (!fs.existsSync(path.join(PWA, dosya))) return true;

    /* #bolum verildiyse hedef HTML'de o id gerçekten tanımlı mı? */
    if (!hash || !/\.html?$/i.test(dosya)) return false;
    const hedef = fs.readFileSync(path.join(PWA, dosya), 'utf8');
    return hedef.indexOf('id="' + hash + '"') === -1 &&
           hedef.indexOf("id='" + hash + "'") === -1;
  });

  if (bozuk.length) basarisiz(rel + ' — diskte olmayan referans: ' + bozuk.join(', '));
  else basarili(rel + ' — ' + refs.length + ' referans geçerli');
});

/* --------------------------------------------- 5. form alanlarının tutarlılığı */

console.log('\n[5/6] A alanları ile HTML uyumu');
const sjs = oku('pwa/js/settings.js');
const sh = oku('pwa/settings.html');

if (!sjs || !sh) {
  basarisiz('settings.js veya settings.html okunamadı');
} else {
  const idVar = function (id) {
    return sh.indexOf('id="' + id + '"') !== -1 || sh.indexOf("id='" + id + "'") !== -1;
  };

  /* settings.js'in okuduğu her $('id') settings.html'de bir id olarak durmalı.
     Eksikse o alan sessizce undefined kalır ve ayar kaydedilmez. */
  const okunan = [];
  sjs.replace(/\$\('([A-Za-z0-9_]+)'\)/g, function (_, id) { okunan.push(id); return _; });
  const benzersiz = okunan.filter(function (v, i) { return okunan.indexOf(v) === i; });
  const eksikAlan = benzersiz.filter(function (id) { return !idVar(id); });

  if (eksikAlan.length) {
    basarisiz('settings.js okuyor ama settings.html içinde yok:\n      ' + eksikAlan.join('\n      '));
  } else {
    basarili(benzersiz.length + ' alan referansı geçerli');
  }

  /* MQTT anahtarları üç dosyada da bulunmalı; biri eksikse ayar panelden kaydedilmez */
  const anahtarlar = ['transport', 'mqttUrl', 'mqttTopic', 'mqttUser', 'mqttPass'];
  const noCfg = anahtarlar.filter(function (k) { return !configJs || configJs.indexOf(k + ':') === -1; });
  const noJs = anahtarlar.filter(function (k) { return sjs.indexOf(k + ':') === -1; });
  const noHtml = anahtarlar.filter(function (k) { return !idVar(k); });

  if (noCfg.length || noJs.length || noHtml.length) {
    basarisiz('MQTT alanı eksik — config.js: [' + (noCfg.join(', ') || 'ok') +
      '] settings.js: [' + (noJs.join(', ') || 'ok') +
      '] settings.html: [' + (noHtml.join(', ') || 'ok') + ']');
  } else {
    basarili(anahtarlar.length + ' MQTT alanı üç dosyada da tanımlı');
  }
}

/* ------------------------------------------------------ 6. firmware config.h */

console.log('\n[6/6] firmware ayarları');
if (configH) {
  basarili('firmware/config.h mevcut (sürüm: v' + (surumler.firmware || '?') + ')');
} else {
  dikkat('firmware/config.h yok — ilk kurulumda yapılacak:\n' +
    '      copy firmware\\config.example.h firmware\\config.h');
}

/* ------------------------------------------------------------------ özet */

console.log('');
if (hata === 0 && uyari === 0) {
  console.log('  Her şey tutarlı. Commit\'e hazır.');
  process.exit(0);
}
console.log('  ' + hata + ' hata, ' + uyari + ' uyarı.');
process.exit(hata === 0 ? 0 : 1);