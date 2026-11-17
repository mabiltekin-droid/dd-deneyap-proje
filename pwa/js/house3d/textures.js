/* ==========================================================================
   house3d/textures.js — Prosedürel CanvasTexture ve PBR materyal yardımcıları
   --------------------------------------------------------------------------
   Harici doku/model dosyası indirmeden traverten taş, sıva, meşe parke,
   kiremit çatı, halı, çim ve tablo dokularını bellek içinde üretir.
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});
  const House3D = (App.House3D = App.House3D || {});

  function hash2d(x, y, seed) {
    const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return n - Math.floor(n);
  }

  function makeCanvas(w, h, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    draw(ctx, w, h);
    return canvas;
  }

  function makeTexture(THREE, canvas, opts) {
    const o = opts || {};
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = o.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    tex.wrapT = o.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    if (o.repeatX || o.repeatY) {
      tex.repeat.set(o.repeatX || 1, o.repeatY || 1);
    }
    if (!o.linear && THREE.SRGBColorSpace) {
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  function createLibrary(THREE) {
    const disposables = [];
    const track = function (item) {
      if (item) disposables.push(item);
      return item;
    };

    const stoneColorCanvas = makeCanvas(256, 256, function (ctx, w, h) {
      ctx.fillStyle = '#c4b196';
      ctx.fillRect(0, 0, w, h);
      const rows = 4;
      const cols = 3;
      const rh = h / rows;
      const cw = w / cols;
      const shades = ['#d7c4aa', '#cbb69a', '#dfd0b8', '#bfa788', '#d2be9f'];
      for (let r = 0; r < rows; r++) {
        const offset = (r % 2) * (cw * 0.5);
        for (let c = -1; c <= cols; c++) {
          const x = c * cw + offset;
          const y = r * rh;
          const idx = Math.floor(hash2d(c + 3, r + 1, 2) * shades.length);
          ctx.fillStyle = shades[idx];
          ctx.fillRect(x + 2, y + 2, cw - 4, rh - 4);
          ctx.fillStyle = 'rgba(110, 88, 64, 0.14)';
          for (let s = 0; s < 14; s++) {
            const px = x + 4 + hash2d(s, r, c + 10) * (cw - 8);
            const py = y + 4 + hash2d(c, s, r + 15) * (rh - 8);
            ctx.fillRect(px, py, 2 + hash2d(px, py, 1) * 4, 2);
          }
          ctx.fillStyle = 'rgba(255, 248, 236, 0.18)';
          ctx.fillRect(x + 2, y + 2, cw - 4, 2);
        }
      }
    });

    const stoneBumpCanvas = makeCanvas(256, 256, function (ctx, w, h) {
      ctx.fillStyle = '#4a4a4a';
      ctx.fillRect(0, 0, w, h);
      const rows = 4;
      const cols = 3;
      const rh = h / rows;
      const cw = w / cols;
      for (let r = 0; r < rows; r++) {
        const offset = (r % 2) * (cw * 0.5);
        for (let c = -1; c <= cols; c++) {
          const v = 165 + Math.floor(hash2d(c + 1, r + 2, 9) * 55);
          ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
          ctx.fillRect(c * cw + offset + 3, r * rh + 3, cw - 6, rh - 6);
        }
      }
    });

    const stuccoCanvas = makeCanvas(256, 256, function (ctx, w, h) {
      ctx.fillStyle = '#f2e8d6';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 1800; i++) {
        const x = hash2d(i, 1, 5) * w;
        const y = hash2d(1, i, 8) * h;
        const light = hash2d(i, i, 3) > 0.5;
        ctx.fillStyle = light ? 'rgba(255, 252, 244, 0.25)' : 'rgba(198, 178, 148, 0.14)';
        ctx.fillRect(x, y, 2.2, 2.2);
      }
    });

    const oakCanvas = makeCanvas(256, 256, function (ctx, w, h) {
      ctx.fillStyle = '#c8935c';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2) {
        const wave = Math.sin(y * 0.08) * 14;
        const shade = Math.floor(wave + hash2d(y, 4, 11) * 16);
        ctx.fillStyle = shade > 8 ? 'rgba(155, 98, 48, 0.18)' : 'rgba(229, 184, 128, 0.14)';
        ctx.fillRect(0, y, w, 2);
      }
    });

    const parquetCanvas = makeCanvas(256, 256, function (ctx, w, h) {
      ctx.fillStyle = '#bd8954';
      ctx.fillRect(0, 0, w, h);
      const planksY = 6;
      const ph = h / planksY;
      const pw = w / 2;
      const tones = ['#cb9760', '#c08c54', '#d4a36d', '#b6814b'];
      for (let r = 0; r < planksY; r++) {
        const off = (r % 2) * (pw * 0.5);
        for (let c = -1; c <= 2; c++) {
          const x = c * pw + off;
          const y = r * ph;
          const idx = Math.floor(hash2d(c + 4, r + 2, 13) * tones.length);
          ctx.fillStyle = tones[idx];
          ctx.fillRect(x + 1, y + 1, pw - 2, ph - 2);
          ctx.fillStyle = 'rgba(115, 70, 32, 0.12)';
          for (let g = 4; g < ph - 4; g += 5) {
            ctx.fillRect(x + 2, y + g, pw - 4, 1);
          }
        }
      }
    });

    const tileCanvas = makeCanvas(256, 256, function (ctx, w, h) {
      ctx.fillStyle = '#b9552d';
      ctx.fillRect(0, 0, w, h);
      const cols = 8;
      const rows = 6;
      const cw = w / cols;
      const rh = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * cw;
          const y = r * rh;
          const tint = hash2d(c, r, 17) * 26;
          const grad = ctx.createLinearGradient(x, y, x + cw, y);
          grad.addColorStop(0, 'rgb(' + Math.round(162 + tint) + ',' + Math.round(68 + tint * 0.5) + ',' + Math.round(35 + tint * 0.3) + ')');
          grad.addColorStop(0.45, 'rgb(' + Math.round(212 + tint * 0.6) + ',' + Math.round(108 + tint * 0.5) + ',' + Math.round(64 + tint * 0.3) + ')');
          grad.addColorStop(1, 'rgb(' + Math.round(148 + tint) + ',' + Math.round(58 + tint * 0.5) + ',28)');
          ctx.fillStyle = grad;
          ctx.fillRect(x, y, cw, rh - 2);
          ctx.fillStyle = 'rgba(72, 24, 10, 0.28)';
          ctx.fillRect(x, y + rh - 3, cw, 3);
        }
      }
    });

    const rugCanvas = makeCanvas(256, 256, function (ctx, w, h) {
      ctx.fillStyle = '#ddd0ba';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 3) {
        for (let x = 0; x < w; x += 3) {
          ctx.fillStyle = ((x + y) % 6 === 0) ? 'rgba(255, 250, 240, 0.28)' : 'rgba(155, 134, 105, 0.14)';
          ctx.fillRect(x, y, 2, 2);
        }
      }
      ctx.strokeStyle = 'rgba(164, 141, 110, 0.38)';
      ctx.lineWidth = 8;
      ctx.strokeRect(10, 10, w - 20, h - 20);
    });

    const grassCanvas = makeCanvas(256, 256, function (ctx, w, h) {
      ctx.fillStyle = '#5c8037';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 2400; i++) {
        const x = hash2d(i, 3, 21) * w;
        const y = hash2d(7, i, 25) * h;
        const t = hash2d(i, i, 29);
        ctx.fillStyle = t > 0.64 ? 'rgba(123, 160, 74, 0.34)' : (t > 0.3 ? 'rgba(72, 106, 38, 0.28)' : 'rgba(154, 178, 86, 0.2)');
        ctx.fillRect(x, y, 2.2, 4.5);
      }
    });

    const artCanvas = makeCanvas(256, 192, function (ctx, w, h) {
      const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
      sky.addColorStop(0, '#ead8b8');
      sky.addColorStop(1, '#f6ebd2');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#8b9d62';
      ctx.beginPath();
      ctx.moveTo(0, h * 0.68);
      ctx.quadraticCurveTo(w * 0.35, h * 0.5, w * 0.72, h * 0.64);
      ctx.lineTo(w, h * 0.58);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.fill();
      ctx.fillStyle = '#657a3f';
      ctx.fillRect(0, h * 0.72, w, h * 0.28);
      ctx.fillStyle = '#efe3cc';
      ctx.fillRect(w * 0.54, h * 0.54, 34, 24);
      ctx.fillStyle = '#b95932';
      ctx.beginPath();
      ctx.moveTo(w * 0.52, h * 0.55);
      ctx.lineTo(w * 0.61, h * 0.45);
      ctx.lineTo(w * 0.70, h * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#4e632f';
      ctx.beginPath();
      ctx.arc(w * 0.32, h * 0.56, 18, 0, Math.PI * 2);
      ctx.arc(w * 0.39, h * 0.6, 14, 0, Math.PI * 2);
      ctx.fill();
    });

    const spriteCanvas = makeCanvas(64, 64, function (ctx, w, h) {
      const grad = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.45, 'rgba(255, 255, 255, 0.58)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    });

    const tex = {
      stoneMap: track(makeTexture(THREE, stoneColorCanvas, { repeatX: 3.2, repeatY: 1 })),
      stoneBump: track(makeTexture(THREE, stoneBumpCanvas, { linear: true, repeatX: 3.2, repeatY: 1 })),
      stoneWallMap: track(makeTexture(THREE, stoneColorCanvas, { repeatX: 2.2, repeatY: 0.9 })),
      stuccoMap: track(makeTexture(THREE, stuccoCanvas, { repeatX: 2, repeatY: 2 })),
      oakMap: track(makeTexture(THREE, oakCanvas, { repeatX: 1, repeatY: 1 })),
      parquetMap: track(makeTexture(THREE, parquetCanvas, { repeatX: 2.6, repeatY: 2.2 })),
      tileMap: track(makeTexture(THREE, tileCanvas, { repeatX: 2.4, repeatY: 2 })),
      rugMap: track(makeTexture(THREE, rugCanvas, { clamp: true })),
      grassMap: track(makeTexture(THREE, grassCanvas, { repeatX: 6, repeatY: 6 })),
      artMap: track(makeTexture(THREE, artCanvas, { clamp: true })),
      softSprite: track(makeTexture(THREE, spriteCanvas, { clamp: true }))
    };

    const mat = {
      stoneBase: track(new THREE.MeshStandardMaterial({
        map: tex.stoneMap,
        bumpMap: tex.stoneBump,
        bumpScale: 0.035,
        roughness: 0.88,
        metalness: 0.02
      })),
      stoneGarden: track(new THREE.MeshStandardMaterial({
        map: tex.stoneWallMap,
        roughness: 0.9,
        metalness: 0.02
      })),
      stoneTrim: track(new THREE.MeshStandardMaterial({
        color: 0xdccbb2,
        roughness: 0.84,
        metalness: 0.02
      })),
      stucco: track(new THREE.MeshStandardMaterial({
        map: tex.stuccoMap,
        roughness: 0.86,
        metalness: 0.01
      })),
      cutEdge: track(new THREE.MeshStandardMaterial({
        color: 0xeee4d2,
        roughness: 0.82
      })),
      oak: track(new THREE.MeshStandardMaterial({
        map: tex.oakMap,
        roughness: 0.56,
        metalness: 0.04
      })),
      parquet: track(new THREE.MeshStandardMaterial({
        map: tex.parquetMap,
        roughness: 0.54,
        metalness: 0.05
      })),
      darkWood: track(new THREE.MeshStandardMaterial({
        color: 0x5c3a21,
        roughness: 0.58,
        metalness: 0.05
      })),
      roofTile: track(new THREE.MeshStandardMaterial({
        map: tex.tileMap,
        roughness: 0.72,
        metalness: 0.04
      })),
      gutterMetal: track(new THREE.MeshStandardMaterial({
        color: 0x3b403c,
        roughness: 0.44,
        metalness: 0.45
      })),
      sofaFabric: track(new THREE.MeshStandardMaterial({
        color: 0xdccdb7,
        roughness: 0.88
      })),
      pillowLight: track(new THREE.MeshStandardMaterial({
        color: 0xf4ede0,
        roughness: 0.84
      })),
      pillowAccent: track(new THREE.MeshStandardMaterial({
        color: 0xb9aa93,
        roughness: 0.85
      })),
      rug: track(new THREE.MeshStandardMaterial({
        map: tex.rugMap,
        roughness: 0.94
      })),
      glass: track(new THREE.MeshPhysicalMaterial({
        color: 0xd9edf2,
        transparent: true,
        opacity: 0.34,
        roughness: 0.12,
        metalness: 0.06
      })),
      ceramicWhite: track(new THREE.MeshStandardMaterial({
        color: 0xf8f3eb,
        roughness: 0.32,
        metalness: 0.04
      })),
      cabinetCream: track(new THREE.MeshStandardMaterial({
        color: 0xe6dac5,
        roughness: 0.62
      })),
      counterStone: track(new THREE.MeshStandardMaterial({
        color: 0xefe7da,
        roughness: 0.42
      })),
      steel: track(new THREE.MeshStandardMaterial({
        color: 0xbec3c6,
        roughness: 0.34,
        metalness: 0.62
      })),
      darkMetal: track(new THREE.MeshStandardMaterial({
        color: 0x26292b,
        roughness: 0.38,
        metalness: 0.58
      })),
      bedLinen: track(new THREE.MeshStandardMaterial({
        color: 0xfaf7f2,
        roughness: 0.85
      })),
      bedThrow: track(new THREE.MeshStandardMaterial({
        color: 0xcabaa3,
        roughness: 0.88
      })),
      terracottaPot: track(new THREE.MeshStandardMaterial({
        color: 0xb86643,
        roughness: 0.78
      })),
      oliveBark: track(new THREE.MeshStandardMaterial({
        color: 0x675847,
        roughness: 0.92
      })),
      oliveLeaf: track(new THREE.MeshStandardMaterial({
        color: 0x6c804e,
        roughness: 0.78
      })),
      bushLeaf: track(new THREE.MeshStandardMaterial({
        color: 0x557537,
        roughness: 0.82
      })),
      blossom: track(new THREE.MeshStandardMaterial({
        color: 0xfaf4e8,
        roughness: 0.7
      })),
      grass: track(new THREE.MeshStandardMaterial({
        map: tex.grassMap,
        roughness: 0.94
      })),
      artCanvas: track(new THREE.MeshStandardMaterial({
        map: tex.artMap,
        roughness: 0.72
      })),
      pendantShade: track(new THREE.MeshStandardMaterial({
        color: 0xf7f2e8,
        emissive: 0xffd088,
        emissiveIntensity: 0.22,
        roughness: 0.38
      })),
      lampShade: track(new THREE.MeshStandardMaterial({
        color: 0xfaf3e3,
        emissive: 0xffb85c,
        emissiveIntensity: 0.55,
        roughness: 0.6
      })),
      kitchenStrip: track(new THREE.MeshStandardMaterial({
        color: 0xfff2d2,
        emissive: 0xffcb78,
        emissiveIntensity: 0.85,
        roughness: 0.3
      }))
    };

    function dispose() {
      disposables.forEach(function (item) {
        if (item && typeof item.dispose === 'function') item.dispose();
      });
      disposables.length = 0;
    }

    return { tex: tex, mat: mat, track: track, dispose: dispose };
  }

  House3D.Textures = { createLibrary: createLibrary };
})();
