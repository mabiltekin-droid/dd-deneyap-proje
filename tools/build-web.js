#!/usr/bin/env node
/* ==========================================================================
   build-web.js — Web dağıtımı (Vercel vb.) için pwa/ klasörünü public/'e aktarır
   --------------------------------------------------------------------------
   İşlemler:
     1. Sürüm tutarlılığı denetimi (package.json = config.js = sw.js)
     2. sw.js PRECACHE listesi doğrulaması
     3. pwa/ dosyalarını public/ klasörüne kopyalama
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PWA = path.join(ROOT, 'pwa');
const PUBLIC = path.join(ROOT, 'public');

console.log('Web yayını hazırlanıyor (pwa/ -> public/)');
console.log('--------------------------------------------');

function oku(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch (e) {
    return null;
  }
}

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
    if (it.isDirectory()) {
      if (it.name !== '.git' && it.name !== '.oxt' && it.name !== 'node_modules') {
        walk(full, out);
      }
    } else {
      if (!it.name.startsWith('.') && it.name !== 'Thumbs.db') {
        out.push(full);
      }
    }
  });
  return out;
}

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach(function (childItemName) {
      if (childItemName === '.git' || childItemName === '.oxt' || childItemName === 'node_modules') return;
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    const parentDir = path.dirname(dest);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
  }
}

/* 1. Sürüm tutarlılığı */
const surumler = {};

const pkg = oku('package.json');
if (pkg) {
  try {
    surumler.package = JSON.parse(pkg).version;
  } catch (e) {}
}

const configJs = oku('pwa/js/config.js');
const m1 = configJs && configJs.match(/App\.VERSION\s*=\s*'([^']+)'/);
if (m1) surumler.config = m1[1];

const swJs = oku('pwa/sw.js');
const m2 = swJs && swJs.match(/const\s+VERSION\s*=\s*'([^']+)'/);
if (m2) surumler.sw = m2[1];

if (surumler.package && surumler.config && surumler.sw &&
    surumler.package === surumler.config && surumler.config === surumler.sw) {
  console.log('  Sürüm: v' + surumler.sw + ' (sw.js = config.js = package.json)');
} else {
  console.error('  HATA: Sürüm uyumsuzluğu: ' + JSON.stringify(surumler));
  process.exit(1);
}

/* 2. PRECACHE denetimi */
let hataVar = false;
if (swJs) {
  const blok = swJs.match(/const\s+(?:PRECACHE|PRECACHE_ASSETS)\s*=\s*\[([\s\S]*?)\]/);
  if (!blok) {
    console.error('  HATA: sw.js içinde PRECACHE listesi bulunamadı');
    hataVar = true;
  } else {
    const listelenen = [];
    blok[1].replace(/'([^']+)'/g, function (_, p) { listelenen.push(p); return _; });

    const shellM = swJs.match(/const\s+SHELL\s*=\s*'([^']+)'/);
    if (shellM && /\bSHELL\b/.test(blok[1]) && listelenen.indexOf(shellM[1]) === -1) {
      listelenen.push(shellM[1]);
    }

    const yerel = walk(PWA)
      .map(function (f) { return './' + path.relative(PWA, f).replace(/\\/g, '/'); })
      .filter(function (p) { return p !== './sw.js'; });

    const eksik = yerel.filter(function (p) { return listelenen.indexOf(p) === -1; });
    const olmayan = listelenen.filter(function (p) {
      return p !== './' && !fs.existsSync(path.join(PWA, p.replace(/^\.\//, '')));
    });

    if (eksik.length) {
      eksik.forEach(function (e) {
        console.error('  HATA: PRECACHE\'te olmayan: ' + e);
      });
      hataVar = true;
    }
    if (olmayan.length) {
      olmayan.forEach(function (o) {
        console.error('  HATA: PRECACHE\'te var ama diskte yok: ' + o);
      });
      hataVar = true;
    }
  }
} else {
  console.error('  HATA: pwa/sw.js okunamadı');
  hataVar = true;
}

if (hataVar) {
  process.exit(1);
}

/* 3. Dosyaları public/ klasörüne kopyala */
try {
  if (fs.existsSync(PUBLIC)) {
    fs.rmSync(PUBLIC, { recursive: true, force: true });
  }
  fs.mkdirSync(PUBLIC, { recursive: true });
  copyRecursiveSync(PWA, PUBLIC);
  console.log('  ✓ Web yayını hazır: public/ oluşturuldu');
} catch (err) {
  console.error('  HATA: public/ klasörüne kopyalama başarısız: ' + err.message);
  process.exit(1);
}
