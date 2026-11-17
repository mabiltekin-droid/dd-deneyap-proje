/* ==========================================================================
   house3d/architecture.js — Referans kesit eve sadık 3D prosedürel mimari
   --------------------------------------------------------------------------
   Dış kabuk (taş kaide, 3 basamaklı merdiven, sol pencere + panjur, kiremit
   çatı + oluk, zeytin ağacı, çim & çalılar), alt kat (salon + mutfak/yemek)
   ve üst kat (hol + yatak odası) prosedürel olarak inşa edilir.
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});
  const House3D = (App.House3D = App.House3D || {});

  function shadow(mesh, cast, receive) {
    mesh.castShadow = cast !== false;
    mesh.receiveShadow = receive !== false;
    return mesh;
  }

  function makeBox(THREE, w, h, d, mat, pos, cast, receive) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    return shadow(m, cast, receive);
  }

  function buildPottedPlant(THREE, mat, scale, hasBlossoms) {
    const g = new THREE.Group();
    const s = scale || 1;

    const potGeo = new THREE.CylinderGeometry(0.24 * s, 0.17 * s, 0.36 * s, 14);
    const pot = shadow(new THREE.Mesh(potGeo, mat.terracottaPot), true, true);
    pot.position.y = 0.18 * s;
    g.add(pot);

    const rimGeo = new THREE.CylinderGeometry(0.26 * s, 0.25 * s, 0.06 * s, 14);
    const rim = shadow(new THREE.Mesh(rimGeo, mat.terracottaPot), true, true);
    rim.position.y = 0.36 * s;
    g.add(rim);

    const soil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22 * s, 0.22 * s, 0.03 * s, 12),
      mat.oliveBark
    );
    soil.position.y = 0.34 * s;
    g.add(soil);

    const stem = shadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.025 * s, 0.035 * s, 0.42 * s, 7),
      mat.oliveBark
    ), true, true);
    stem.position.y = 0.54 * s;
    g.add(stem);

    const leafPositions = [
      [0, 0.78, 0, 0.24],
      [-0.14, 0.7, 0.11, 0.18],
      [0.15, 0.72, -0.09, 0.18],
      [-0.08, 0.64, -0.14, 0.17],
      [0.12, 0.65, 0.13, 0.17],
      [0, 0.9, 0.03, 0.16]
    ];
    const leafGeo = new THREE.DodecahedronGeometry(1, 0);
    leafPositions.forEach(function (p) {
      const leaf = shadow(new THREE.Mesh(leafGeo, mat.bushLeaf), true, true);
      leaf.position.set(p[0] * s, p[1] * s, p[2] * s);
      leaf.scale.set(p[3] * s, p[3] * s * 0.85, p[3] * s);
      leaf.rotation.set(p[0], p[2], p[1]);
      g.add(leaf);
    });

    if (hasBlossoms) {
      const dotGeo = new THREE.SphereGeometry(0.03 * s, 6, 5);
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        const f = new THREE.Mesh(dotGeo, mat.blossom);
        f.position.set(Math.cos(ang) * 0.21 * s, (0.64 + (i % 2) * 0.12) * s, Math.sin(ang) * 0.21 * s);
        g.add(f);
      }
    }

    return g;
  }

  function buildGardenShrub(THREE, mat, radius, blossoms) {
    const g = new THREE.Group();
    const r = radius || 0.48;
    const lobeGeo = new THREE.DodecahedronGeometry(1, 0);
    const lobes = [
      [0, 0.52, 0, 1.0],
      [-0.55, 0.36, 0.25, 0.68],
      [0.52, 0.38, -0.22, 0.7],
      [0.15, 0.34, 0.55, 0.65],
      [-0.22, 0.4, -0.5, 0.65]
    ];
    lobes.forEach(function (l) {
      const m = shadow(new THREE.Mesh(lobeGeo, mat.bushLeaf), true, true);
      m.position.set(l[0] * r, l[1] * r, l[2] * r);
      m.scale.setScalar(l[3] * r * 0.68);
      m.rotation.set(l[2], l[0], l[1]);
      g.add(m);
    });
    if (blossoms) {
      const flGeo = new THREE.SphereGeometry(r * 0.085, 6, 5);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const fl = new THREE.Mesh(flGeo, mat.blossom);
        fl.position.set(
          Math.cos(a) * r * (0.45 + (i % 3) * 0.14),
          r * (0.36 + (i % 4) * 0.11),
          Math.sin(a) * r * (0.45 + ((i + 1) % 3) * 0.13)
        );
        g.add(fl);
      }
    }
    return g;
  }

  function buildOliveTree(THREE, mat) {
    const g = new THREE.Group();

    const trunk = shadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.29, 2.35, 9),
      mat.oliveBark
    ), true, true);
    trunk.position.set(0, 1.15, 0);
    trunk.rotation.z = 0.06;
    g.add(trunk);

    const rootFlare = shadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.44, 0.42, 9),
      mat.oliveBark
    ), true, true);
    rootFlare.position.y = 0.21;
    g.add(rootFlare);

    const limbs = [
      { pos: [-0.28, 2.5, 0.1], rot: [0.18, 0, 0.56], len: 1.25 },
      { pos: [0.3, 2.55, -0.08], rot: [-0.15, 0, -0.52], len: 1.3 },
      { pos: [0.05, 2.65, 0.25], rot: [0.46, 0, 0.08], len: 1.15 },
      { pos: [-0.08, 2.75, -0.22], rot: [-0.42, 0, 0.15], len: 1.1 }
    ];
    limbs.forEach(function (b) {
      const m = shadow(new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.11, b.len, 7),
        mat.oliveBark
      ), true, true);
      m.position.set(b.pos[0], b.pos[1], b.pos[2]);
      m.rotation.set(b.rot[0], b.rot[1], b.rot[2]);
      g.add(m);
    });

    const foliage = new THREE.Group();
    const clumpGeo = new THREE.DodecahedronGeometry(1, 0);
    const crown = [
      [0, 3.85, 0, 1.15, 0.78, 1.05],
      [-0.85, 3.35, 0.25, 0.92, 0.68, 0.85],
      [0.82, 3.45, -0.15, 0.94, 0.7, 0.88],
      [-0.25, 3.5, 0.72, 0.88, 0.64, 0.78],
      [0.25, 3.58, -0.68, 0.86, 0.66, 0.8],
      [-0.45, 4.1, -0.15, 0.78, 0.56, 0.72],
      [0.45, 4.02, 0.25, 0.74, 0.54, 0.72]
    ];
    crown.forEach(function (c) {
      const m = shadow(new THREE.Mesh(clumpGeo, mat.oliveLeaf), true, true);
      m.position.set(c[0], c[1], c[2]);
      m.scale.set(c[3], c[4], c[5]);
      m.rotation.set(c[2] * 0.4, c[0] * 0.3, c[1] * 0.2);
      foliage.add(m);
    });
    g.add(foliage);

    return { group: g, foliage: foliage };
  }

  function buildWindowAndShutter(THREE, mat) {
    /* Sol duvardaki X = -4.08 açıklığına oturan ahşap 2 kanatlı pencere + panjur */
    const group = new THREE.Group();

    const winW = 1.82;
    const winH = 2.48;
    const winD = 0.26;

    // Stone outer sill
    const sill = makeBox(THREE, 0.38, 0.1, winW + 0.24, mat.stoneTrim, [-0.04, -winH / 2 - 0.04, 0], true, true);
    group.add(sill);

    // Dark walnut outer frame members
    const frameThick = 0.08;
    group.add(makeBox(THREE, winD + 0.04, frameThick, winW, mat.darkWood, [0, winH / 2 - frameThick / 2, 0]));
    group.add(makeBox(THREE, winD + 0.04, frameThick, winW, mat.darkWood, [0, -winH / 2 + frameThick / 2, 0]));
    group.add(makeBox(THREE, winD + 0.04, winH, frameThick, mat.darkWood, [0, 0, -winW / 2 + frameThick / 2]));
    group.add(makeBox(THREE, winD + 0.04, winH, frameThick, mat.darkWood, [0, 0, winW / 2 - frameThick / 2]));
    // Central vertical post
    group.add(makeBox(THREE, winD * 0.75, winH - frameThick * 2, 0.06, mat.darkWood, [0, 0, 0]));

    function buildSash(isFront) {
      const pivot = new THREE.Group();
      const sashW = (winW - frameThick * 2 - 0.06) / 2;
      const sashH = winH - frameThick * 2;
      const hingeZ = isFront ? (winW / 2 - frameThick) : (-winW / 2 + frameThick);
      const dir = isFront ? -1 : 1;

      pivot.position.set(-0.04, 0, hingeZ);
      const leaf = new THREE.Group();
      leaf.position.z = dir * (sashW / 2);

      // Sash wood border + 2 horizontal mullions (3 panes high like reference!)
      leaf.add(makeBox(THREE, 0.055, 0.05, sashW, mat.darkWood, [0, sashH / 2 - 0.025, 0]));
      leaf.add(makeBox(THREE, 0.055, 0.05, sashW, mat.darkWood, [0, -sashH / 2 + 0.025, 0]));
      leaf.add(makeBox(THREE, 0.055, sashH, 0.05, mat.darkWood, [0, 0, -sashW / 2 + 0.025]));
      leaf.add(makeBox(THREE, 0.055, sashH, 0.05, mat.darkWood, [0, 0, sashW / 2 - 0.025]));
      leaf.add(makeBox(THREE, 0.04, 0.04, sashW - 0.08, mat.darkWood, [0, sashH * 0.16, 0]));
      leaf.add(makeBox(THREE, 0.04, 0.04, sashW - 0.08, mat.darkWood, [0, -sashH * 0.16, 0]));

      const glassMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.015, sashH - 0.09, sashW - 0.09),
        mat.glass
      );
      glassMesh.castShadow = false;
      glassMesh.receiveShadow = false;
      leaf.add(glassMesh);

      pivot.add(leaf);
      return pivot;
    }

    const leftSash = buildSash(false);
    const rightSash = buildSash(true);
    group.add(leftSash);
    group.add(rightSash);

    // Smart shutter / panjur housing at top outer side (scales downward smoothly when blind closes -> 0 deg)
    const boxHousing = makeBox(THREE, 0.12, 0.12, winW + 0.06, mat.gutterMetal, [-winD / 2 - 0.05, winH / 2 + 0.03, 0]);
    group.add(boxHousing);

    const blindPivot = new THREE.Group();
    blindPivot.position.set(-winD / 2 - 0.06, winH / 2 - 0.02, 0);
    const slatCount = 12;
    const slatH = (winH - 0.06) / slatCount;
    const shutterMat = new THREE.MeshStandardMaterial({
      color: 0xb9aa94,
      roughness: 0.65,
      metalness: 0.12
    });
    for (let i = 0; i < slatCount; i++) {
      const slat = makeBox(THREE, 0.03, slatH * 0.86, winW - 0.06, shutterMat, [0, -(i + 0.5) * slatH, 0]);
      blindPivot.add(slat);
    }
    group.add(blindPivot);

    return {
      group: group,
      leftSash: leftSash,
      rightSash: rightSash,
      blindPivot: blindPivot,
      shutterMat: shutterMat
    };
  }

  function buildRoof(THREE, mat) {
    /* Asimetrik kiremit çatı (sol eğim uzun + çatı oluğu, sağ eğim daha dik/kısa) */
    const g = new THREE.Group();
    const peakX = 1.05;
    const peakY = 6.95;
    const leftX = -4.65;
    const leftY = 5.18;
    const rightX = 4.55;
    const rightY = 5.75;
    const depth = 6.64; // -3.32 .. +3.32

    function makeSlope(x1, y1, x2, y2) {
      const slopeGroup = new THREE.Group();
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      slopeGroup.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
      slopeGroup.rotation.z = angle;

      // Timber plank underside visible from inside rooms
      slopeGroup.add(makeBox(THREE, len, 0.1, depth, mat.oak, [0, -0.05, 0]));
      // Cream stucco fascia edge + main roof deck
      slopeGroup.add(makeBox(THREE, len + 0.08, 0.14, depth, mat.roofTile, [0, 0.06, 0]));

      // 3D terracotta barrel tile ribs using a single InstancedMesh for max FPS
      const ribGeo = new THREE.CylinderGeometry(0.11, 0.125, depth - 0.08, 7, 1, false, 0, Math.PI);
      ribGeo.rotateX(Math.PI / 2);
      const count = Math.max(8, Math.floor(len / 0.25));
      const inst = new THREE.InstancedMesh(ribGeo, mat.roofTile, count);
      inst.castShadow = true;
      inst.receiveShadow = true;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        const u = ((i + 0.5) / count - 0.5) * (len - 0.18);
        dummy.position.set(u, 0.12, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      slopeGroup.add(inst);
      return slopeGroup;
    }

    g.add(makeSlope(leftX, leftY, peakX, peakY));
    g.add(makeSlope(peakX, peakY, rightX, rightY));

    // Ridge cap tiles along the peak
    const ridgeCap = shadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, depth + 0.08, 10, 1, false, -Math.PI * 0.5, Math.PI),
      mat.roofTile
    ), true, true);
    ridgeCap.rotation.x = Math.PI / 2;
    ridgeCap.position.set(peakX, peakY + 0.08, 0);
    g.add(ridgeCap);

    // Front gable timber fascia trim
    const leftLen = Math.hypot(peakX - leftX, peakY - leftY);
    const leftBeam = makeBox(THREE, leftLen + 0.08, 0.12, 0.12, mat.darkWood, [(leftX + peakX) / 2, (leftY + peakY) / 2 - 0.06, depth / 2 - 0.02]);
    leftBeam.rotation.z = Math.atan2(peakY - leftY, peakX - leftX);
    g.add(leftBeam);

    const rightLen = Math.hypot(rightX - peakX, rightY - peakY);
    const rightBeam = makeBox(THREE, rightLen + 0.08, 0.12, 0.12, mat.darkWood, [(peakX + rightX) / 2, (peakY + rightY) / 2 - 0.06, depth / 2 - 0.02]);
    rightBeam.rotation.z = Math.atan2(rightY - peakY, rightX - peakX);
    g.add(rightBeam);

    // Half-round dark metal rain gutter along left eave + corner downspout
    const gutterGeo = new THREE.CylinderGeometry(0.1, 0.1, depth + 0.1, 10, 1, false, Math.PI * 0.5, Math.PI);
    gutterGeo.rotateX(Math.PI / 2);
    const gutter = shadow(new THREE.Mesh(gutterGeo, mat.gutterMetal), true, true);
    gutter.position.set(leftX - 0.05, leftY - 0.08, 0);
    g.add(gutter);

    const downspout = shadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 4.55, 8),
      mat.gutterMetal
    ), true, true);
    downspout.position.set(leftX + 0.35, 2.9, -2.88);
    g.add(downspout);

    return g;
  }

  function buildInteriorDoor(THREE, mat, x, y, z, flipRotY) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    if (flipRotY) g.rotation.y = flipRotY;

    // Outer frame
    g.add(makeBox(THREE, 0.92, 2.1, 0.1, mat.oak, [0, 1.05, 0]));
    // Recessed door leaf
    g.add(makeBox(THREE, 0.78, 2.0, 0.07, mat.oak, [0, 1.0, 0.02]));
    // Subtle dark panel trim + brass handle
    g.add(makeBox(THREE, 0.6, 0.72, 0.09, mat.darkWood, [0, 1.45, 0.02]));
    g.add(makeBox(THREE, 0.1, 0.03, 0.06, mat.darkMetal, [0.28, 0.98, 0.08]));
    return g;
  }

  function buildSofaAndCoffeeTable(THREE, mat) {
    const g = new THREE.Group();

    // Rug on salon floor
    const rug = makeBox(THREE, 2.85, 0.025, 2.15, mat.rug, [-1.9, 0.012, 0.35], false, true);
    g.add(rug);

    // Modern 2-seater beige sofa at (-2.05, 0, -0.58)
    const sofa = new THREE.Group();
    sofa.position.set(-2.05, 0, -0.58);
    const legGeo = new THREE.CylinderGeometry(0.032, 0.022, 0.16, 7);
    [[-0.86, -0.34], [0.86, -0.34], [-0.86, 0.34], [0.86, 0.34]].forEach(function (p) {
      const leg = shadow(new THREE.Mesh(legGeo, mat.oak), true, true);
      leg.position.set(p[0], 0.08, p[1]);
      sofa.add(leg);
    });
    sofa.add(makeBox(THREE, 1.9, 0.16, 0.84, mat.sofaFabric, [0, 0.24, 0]));
    sofa.add(makeBox(THREE, 0.86, 0.18, 0.76, mat.sofaFabric, [-0.44, 0.4, 0.03]));
    sofa.add(makeBox(THREE, 0.86, 0.18, 0.76, mat.sofaFabric, [0.44, 0.4, 0.03]));
    sofa.add(makeBox(THREE, 0.18, 0.56, 0.84, mat.sofaFabric, [-0.94, 0.44, 0]));
    sofa.add(makeBox(THREE, 0.18, 0.56, 0.84, mat.sofaFabric, [0.94, 0.44, 0]));
    sofa.add(makeBox(THREE, 1.9, 0.62, 0.2, mat.sofaFabric, [0, 0.54, -0.33]));

    // Three pillows
    const p1 = makeBox(THREE, 0.34, 0.3, 0.14, mat.pillowLight, [-0.62, 0.62, -0.16]);
    p1.rotation.set(-0.22, 0.25, 0.12);
    sofa.add(p1);
    const p2 = makeBox(THREE, 0.32, 0.28, 0.13, mat.pillowAccent, [0.14, 0.6, -0.18]);
    p2.rotation.set(-0.2, -0.12, -0.06);
    sofa.add(p2);
    const p3 = makeBox(THREE, 0.34, 0.3, 0.14, mat.pillowLight, [0.64, 0.62, -0.16]);
    p3.rotation.set(-0.22, -0.25, -0.12);
    sofa.add(p3);
    g.add(sofa);

    // Oak coffee table in front of sofa
    const table = new THREE.Group();
    table.position.set(-1.7, 0, 0.78);
    table.add(makeBox(THREE, 1.15, 0.06, 0.66, mat.oak, [0, 0.4, 0]));
    const tLegGeo = new THREE.CylinderGeometry(0.028, 0.018, 0.38, 7);
    [[-0.48, -0.25], [0.48, -0.25], [-0.48, 0.25], [0.48, 0.25]].forEach(function (p) {
      const l = shadow(new THREE.Mesh(tLegGeo, mat.oak), true, true);
      l.position.set(p[0], 0.19, p[1]);
      table.add(l);
    });
    // Small white flower vase on coffee table
    const vase = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.055, 0.16, 10), mat.ceramicWhite), true, true);
    vase.position.set(-0.08, 0.51, 0);
    table.add(vase);
    const bloom = shadow(new THREE.Mesh(new THREE.DodecahedronGeometry(0.11, 0), mat.blossom), true, false);
    bloom.position.set(-0.08, 0.64, 0);
    table.add(bloom);
    g.add(table);

    // Framed landscape painting on rear salon wall
    const frame = new THREE.Group();
    frame.position.set(-2.45, 1.65, -2.76);
    frame.add(makeBox(THREE, 1.12, 0.84, 0.06, mat.oak, [0, 0, 0]));
    frame.add(makeBox(THREE, 0.96, 0.68, 0.02, mat.artCanvas, [0, 0, 0.035], false, true));
    g.add(frame);

    return g;
  }

  function buildKitchenAndDining(THREE, mat) {
    const g = new THREE.Group();

    // Oak dining table + 3 chairs + centerpiece
    const dining = new THREE.Group();
    dining.position.set(2.15, 0, 0.92);
    dining.add(makeBox(THREE, 1.45, 0.07, 0.92, mat.oak, [0, 0.74, 0]));
    const dLegGeo = new THREE.CylinderGeometry(0.035, 0.025, 0.72, 7);
    [[-0.62, -0.36], [0.62, -0.36], [-0.62, 0.36], [0.62, 0.36]].forEach(function (p) {
      const l = shadow(new THREE.Mesh(dLegGeo, mat.oak), true, true);
      l.position.set(p[0], 0.36, p[1]);
      dining.add(l);
    });
    // Table centerpiece vase
    const tv = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.18, 9), mat.glass), true, false);
    tv.position.set(0, 0.86, 0);
    dining.add(tv);
    const tl = shadow(new THREE.Mesh(new THREE.DodecahedronGeometry(0.13, 0), mat.bushLeaf), true, false);
    tl.position.set(0, 0.99, 0);
    dining.add(tl);

    function addChair(x, z, rotY) {
      const c = new THREE.Group();
      c.position.set(x, 0, z);
      c.rotation.y = rotY;
      c.add(makeBox(THREE, 0.44, 0.05, 0.42, mat.oak, [0, 0.44, 0]));
      c.add(makeBox(THREE, 0.4, 0.04, 0.38, mat.pillowLight, [0, 0.48, 0.01]));
      c.add(makeBox(THREE, 0.44, 0.42, 0.05, mat.oak, [0, 0.67, -0.19]));
      const cLeg = new THREE.CylinderGeometry(0.022, 0.016, 0.43, 6);
      [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]].forEach(function (p) {
        const leg = shadow(new THREE.Mesh(cLeg, mat.oak), true, true);
        leg.position.set(p[0], 0.215, p[1]);
        c.add(leg);
      });
      dining.add(c);
    }
    addChair(-0.72, 0.06, Math.PI * 0.5);
    addChair(0.72, 0.06, -Math.PI * 0.5);
    addChair(0.05, -0.52, 0);
    g.add(dining);

    // White dome pendant lamp hanging above dining table
    const pendant = new THREE.Group();
    pendant.position.set(2.15, 2.38, 0.92);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.68, 6), mat.darkMetal);
    cord.position.y = -0.34;
    pendant.add(cord);
    const domeGeo = new THREE.SphereGeometry(0.32, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56);
    const domeMat = mat.pendantShade.clone();
    domeMat.side = THREE.DoubleSide;
    const dome = shadow(new THREE.Mesh(domeGeo, domeMat), true, true);
    dome.position.y = -0.68;
    pendant.add(dome);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff7e2,
      emissive: 0xffc86b,
      emissiveIntensity: 1.4,
      roughness: 0.2
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), bulbMat);
    bulb.position.y = -0.78;
    pendant.add(bulb);
    const pendantLight = new THREE.PointLight(0xffcb82, 2.4, 6.8, 1.6);
    pendantLight.position.set(0, -0.88, 0);
    pendant.add(pendantLight);
    g.add(pendant);

    // Rear kitchen cabinet counter run (z = -2.35)
    g.add(makeBox(THREE, 0.62, 2.32, 0.72, mat.oak, [0.78, 1.16, -2.42])); // wood pantry panel left
    // Lower cabinets
    g.add(makeBox(THREE, 2.08, 0.86, 0.66, mat.oak, [2.14, 0.43, -2.42]));
    // Cream stone countertop
    g.add(makeBox(THREE, 2.12, 0.07, 0.7, mat.counterStone, [2.14, 0.895, -2.42]));
    // Sink basin + faucet (left side of counter)
    g.add(makeBox(THREE, 0.46, 0.03, 0.36, mat.steel, [1.55, 0.94, -2.42]));
    g.add(makeBox(THREE, 0.04, 0.22, 0.04, mat.steel, [1.55, 1.04, -2.58]));
    g.add(makeBox(THREE, 0.04, 0.03, 0.14, mat.steel, [1.55, 1.14, -2.51]));
    // Built-in oven + ceramic 4-burner cooktop (middle-right of counter)
    g.add(makeBox(THREE, 0.62, 0.6, 0.06, mat.darkMetal, [2.52, 0.46, -2.07]));
    g.add(makeBox(THREE, 0.56, 0.04, 0.08, mat.steel, [2.52, 0.7, -2.05]));
    g.add(makeBox(THREE, 0.64, 0.025, 0.48, mat.darkMetal, [2.52, 0.94, -2.42]));

    // Upper cream cabinets
    g.add(makeBox(THREE, 0.95, 0.68, 0.42, mat.cabinetCream, [1.58, 2.0, -2.54]));
    g.add(makeBox(THREE, 0.46, 0.68, 0.42, mat.cabinetCream, [3.02, 2.0, -2.54]));

    // Under-cabinet warm LED strip
    const kitchenStripMat = mat.kitchenStrip.clone();
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.028, 0.05), kitchenStripMat);
    strip.position.set(1.85, 1.64, -2.52);
    g.add(strip);
    const kitchenFillLight = new THREE.PointLight(0xffcb80, 1.1, 4.2, 1.8);
    kitchenFillLight.position.set(2.15, 1.52, -2.25);
    g.add(kitchenFillLight);

    // Oak chimney range hood with visible spinning extractor fan underneath!
    g.add(makeBox(THREE, 0.62, 0.56, 0.44, mat.oak, [2.52, 2.06, -2.48]));
    const fanHub = new THREE.Group();
    fanHub.position.set(2.52, 1.78, -2.46);
    const fanBlades = new THREE.Group();
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x3b4240, roughness: 0.4, metalness: 0.5 });
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.015, 0.055), bladeMat);
      b.rotation.y = (i * Math.PI) / 2;
      b.rotation.x = 0.28;
      fanBlades.add(b);
    }
    const fanLedMat = new THREE.MeshStandardMaterial({ color: 0xd1fae5, emissive: 0x10b981, emissiveIntensity: 0.25 });
    const fanLed = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 10), fanLedMat);
    fanLed.position.set(0.23, 0.02, 0.2);
    fanHub.add(fanBlades);
    fanHub.add(fanLed);
    g.add(fanHub);

    // Tall brushed grey double-door refrigerator at (+3.62, 0, -2.32)
    const fridge = new THREE.Group();
    fridge.position.set(3.62, 0, -2.32);
    fridge.add(makeBox(THREE, 0.82, 2.02, 0.72, mat.steel, [0, 1.01, 0]));
    fridge.add(makeBox(THREE, 0.78, 0.025, 0.74, mat.darkMetal, [0, 0.74, 0.01]));
    fridge.add(makeBox(THREE, 0.02, 1.24, 0.74, mat.darkMetal, [0, 1.38, 0.01]));
    fridge.add(makeBox(THREE, 0.03, 0.45, 0.03, mat.darkMetal, [-0.07, 1.38, 0.38]));
    fridge.add(makeBox(THREE, 0.03, 0.45, 0.03, mat.darkMetal, [0.07, 1.38, 0.38]));
    fridge.add(makeBox(THREE, 0.38, 0.03, 0.03, mat.darkMetal, [0, 0.62, 0.38]));
    g.add(fridge);

    return {
      group: g,
      pendantLight: pendantLight,
      domeMat: domeMat,
      bulbMat: bulbMat,
      kitchenFillLight: kitchenFillLight,
      kitchenStripMat: kitchenStripMat,
      fanBlades: fanBlades,
      fanLedMat: fanLedMat
    };
  }

  function buildMasterBedroom(THREE, mat) {
    const g = new THREE.Group();

    // Bedroom area rug
    g.add(makeBox(THREE, 2.55, 0.02, 2.0, mat.rug, [2.25, 0.01, -1.0], false, true));

    // Double wooden bed centered at (2.25, 0, -1.68)
    const bed = new THREE.Group();
    bed.position.set(2.25, 0, -1.68);
    bed.add(makeBox(THREE, 1.66, 0.92, 0.09, mat.oak, [0, 0.46, -0.96])); // headboard
    bed.add(makeBox(THREE, 1.66, 0.34, 0.07, mat.oak, [0, 0.22, 0.96])); // footboard
    bed.add(makeBox(THREE, 1.64, 0.2, 1.9, mat.oak, [0, 0.18, 0])); // frame
    bed.add(makeBox(THREE, 1.54, 0.24, 1.8, mat.bedLinen, [0, 0.36, 0])); // mattress + duvet
    bed.add(makeBox(THREE, 1.58, 0.07, 0.65, mat.bedThrow, [0, 0.49, 0.46])); // folded throw
    bed.add(makeBox(THREE, 0.56, 0.12, 0.34, mat.pillowLight, [-0.38, 0.52, -0.7])); // left pillow
    bed.add(makeBox(THREE, 0.56, 0.12, 0.34, mat.pillowLight, [0.38, 0.52, -0.7])); // right pillow
    g.add(bed);

    function addNightstandAndLamp(x) {
      const n = new THREE.Group();
      n.position.set(x, 0, -2.3);
      n.add(makeBox(THREE, 0.52, 0.48, 0.46, mat.oak, [0, 0.24, 0]));
      n.add(makeBox(THREE, 0.42, 0.03, 0.03, mat.darkMetal, [0, 0.34, 0.24]));

      const base = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.08, 0.14, 10), mat.oak), true, true);
      base.position.y = 0.55;
      n.add(base);

      const lampShadeMat = mat.lampShade.clone();
      lampShadeMat.side = THREE.DoubleSide;
      const shade = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.22, 12, 1, true), lampShadeMat), true, false);
      shade.position.y = 0.72;
      n.add(shade);

      const light = new THREE.PointLight(0xffba6a, 1.5, 4.2, 1.6);
      light.position.set(0, 0.72, 0.05);
      n.add(light);

      g.add(n);
      return { light: light, shadeMat: lampShadeMat };
    }

    const leftLamp = addNightstandAndLamp(1.06);
    const rightLamp = addNightstandAndLamp(3.44);

    return {
      group: g,
      leftLamp: leftLamp,
      rightLamp: rightLamp
    };
  }

  function buildArchitecture(THREE, lib) {
    const mat = lib.mat;
    const root = new THREE.Group();

    /* ---- 1. Çevre / Bahçe Grubu (Depremde ev sallanırken zemin sabit kalır) --- */
    const envGroup = new THREE.Group();
    root.add(envGroup);

    // Sunlit green grass island
    const lawn = new THREE.Mesh(new THREE.CircleGeometry(15.5, 48), mat.grass);
    lawn.rotation.x = -Math.PI / 2;
    lawn.receiveShadow = true;
    envGroup.add(lawn);

    // Dry-stone garden boundary walls behind left and right edges
    envGroup.add(makeBox(THREE, 5.4, 1.08, 0.42, mat.stoneGarden, [-6.8, 0.54, -2.55]));
    envGroup.add(makeBox(THREE, 4.8, 1.08, 0.42, mat.stoneGarden, [6.5, 0.54, -2.45]));

    // Three stone entrance stairs at front-left + 5 stepping pavers
    envGroup.add(makeBox(THREE, 1.55, 0.62, 0.34, mat.stoneBase, [-3.42, 0.31, 3.22]));
    envGroup.add(makeBox(THREE, 1.55, 0.42, 0.34, mat.stoneBase, [-3.42, 0.21, 3.54]));
    envGroup.add(makeBox(THREE, 1.55, 0.22, 0.34, mat.stoneBase, [-3.42, 0.11, 3.86]));

    for (let i = 0; i < 5; i++) {
      const px = -3.45 - i * 0.42;
      const pz = 4.35 + i * 0.52;
      const paver = makeBox(THREE, 0.44, 0.05, 0.44, mat.stoneTrim, [px, 0.025, pz], true, true);
      paver.rotation.y = (i % 2 === 0) ? 0.04 : -0.05;
      envGroup.add(paver);
    }

    // Potted entrance shrub beside steps
    const frontPot = buildPottedPlant(THREE, mat, 1.15, false);
    frontPot.position.set(-2.35, 0.0, 3.45);
    envGroup.add(frontPot);

    // Gnarled olive tree on left grass
    const olive = buildOliveTree(THREE, mat);
    olive.group.position.set(-6.05, 0, 1.35);
    envGroup.add(olive.group);

    // Flowering green shrubs around foundation
    const shrubCoords = [
      [-5.1, 2.65, 0.56, true],
      [0.55, 3.42, 0.48, true],
      [3.55, 3.38, 0.52, true],
      [4.95, 1.75, 0.54, false],
      [-5.65, -1.65, 0.58, false]
    ];
    const shrubs = [];
    shrubCoords.forEach(function (sc) {
      const sh = buildGardenShrub(THREE, mat, sc[2], sc[3]);
      sh.position.set(sc[0], 0, sc[1]);
      envGroup.add(sh);
      shrubs.push(sh);
    });

    /* ---- 2. Ev Grubu (houseGroup — depremde sismik olarak sallanır) -------- */
    const houseGroup = new THREE.Group();
    root.add(houseGroup);

    // Raised stone plinth + beveled stone ledge
    houseGroup.add(makeBox(THREE, 8.5, 0.62, 6.1, mat.stoneBase, [0, 0.31, 0]));
    houseGroup.add(makeBox(THREE, 8.64, 0.08, 6.24, mat.stoneTrim, [0, 0.64, 0]));

    // Ground floor parquet & upper floor structural slab
    houseGroup.add(makeBox(THREE, 8.2, 0.06, 5.85, mat.parquet, [0, 0.69, -0.02], false, true));
    houseGroup.add(makeBox(THREE, 8.38, 0.2, 5.98, mat.cutEdge, [0, 3.16, 0]));
    houseGroup.add(makeBox(THREE, 8.15, 0.04, 5.8, mat.parquet, [0, 3.27, -0.02], false, true));

    // Left cream stucco exterior wall built WITH real window aperture (x = -4.08)
    houseGroup.add(makeBox(THREE, 0.26, 0.98, 6.0, mat.stucco, [-4.08, 1.17, 0])); // below window
    houseGroup.add(makeBox(THREE, 0.26, 1.18, 6.0, mat.stucco, [-4.08, 4.72, 0])); // above window
    houseGroup.add(makeBox(THREE, 0.26, 2.48, 2.26, mat.stucco, [-4.08, 2.9, -1.87])); // behind window
    houseGroup.add(makeBox(THREE, 0.26, 2.48, 1.96, mat.stucco, [-4.08, 2.9, 2.02])); // in front of window

    // Functional 2-sash casement window + roller shutter (y: 1.66..4.14, z: -0.74..+1.04)
    const winObj = buildWindowAndShutter(THREE, mat);
    winObj.group.position.set(-4.08, 2.9, 0.15);
    houseGroup.add(winObj.group);

    // Back wall (with rectangular body + triangular gable top)
    houseGroup.add(makeBox(THREE, 8.36, 4.55, 0.24, mat.stucco, [0, 2.95, -2.92]));
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-4.2, 5.2);
    gableShape.lineTo(1.05, 6.95);
    gableShape.lineTo(4.2, 5.75);
    gableShape.lineTo(4.2, 5.15);
    gableShape.lineTo(-4.2, 5.15);
    gableShape.closePath();
    const gableMesh = shadow(new THREE.Mesh(
      new THREE.ExtrudeGeometry(gableShape, { depth: 0.24, bevelEnabled: false }),
      mat.stucco
    ), true, true);
    gableMesh.position.z = -3.04;
    houseGroup.add(gableMesh);

    // Cutaway structural columns & interior room partitions
    houseGroup.add(makeBox(THREE, 0.22, 2.52, 0.22, mat.cutEdge, [4.08, 1.94, 2.88])); // right front pillar (ground)
    houseGroup.add(makeBox(THREE, 0.22, 2.55, 0.22, mat.cutEdge, [4.08, 4.52, 2.88])); // right front pillar (upper)
    houseGroup.add(makeBox(THREE, 0.24, 2.6, 5.95, mat.stucco, [4.08, 1.98, -0.02])); // right rear/side wall (ground)
    // Open half-depth partition wall between Salon & Kitchen
    houseGroup.add(makeBox(THREE, 0.18, 2.38, 2.75, mat.stucco, [0.42, 1.88, -1.55]));
    // Upper floor right cutaway bedroom wall stub + divider between Hall & Master Bedroom
    houseGroup.add(makeBox(THREE, 0.24, 2.55, 3.4, mat.stucco, [4.08, 4.52, -1.3]));
    houseGroup.add(makeBox(THREE, 0.18, 2.35, 2.55, mat.stucco, [0.32, 4.44, -1.6]));

    // Roof + gutter + downspout
    const roof = buildRoof(THREE, mat);
    houseGroup.add(roof);

    // Ground Floor — Left: Salon
    const salon = buildSofaAndCoffeeTable(THREE, mat);
    salon.position.y = 0.72;
    houseGroup.add(salon);
    // Salon garden-view rear window & oak door
    houseGroup.add(makeBox(THREE, 0.88, 1.9, 0.08, mat.darkWood, [-0.96, 1.7, -2.79]));
    houseGroup.add(makeBox(THREE, 0.72, 1.72, 0.04, mat.glass, [-0.96, 1.7, -2.76], false, false));
    houseGroup.add(buildInteriorDoor(THREE, mat, -0.05, 0.72, -2.78, 0));

    // Ground Floor — Right: Mutfak & Yemek
    const kitchen = buildKitchenAndDining(THREE, mat);
    kitchen.group.position.y = 0.72;
    houseGroup.add(kitchen.group);

    // Upper Floor — Left: Sol Hol (salon bitkisi + 2 ahşap oda kapısı)
    const hallPlant = buildPottedPlant(THREE, mat, 1.25, false);
    hallPlant.position.set(-3.2, 3.29, 0.15);
    houseGroup.add(hallPlant);
    houseGroup.add(buildInteriorDoor(THREE, mat, -1.9, 3.29, -2.78, 0));
    houseGroup.add(buildInteriorDoor(THREE, mat, -0.45, 3.29, -2.78, 0));

    // Upper Floor — Right: Yatak Odası
    const bedroom = buildMasterBedroom(THREE, mat);
    bedroom.group.position.y = 3.29;
    houseGroup.add(bedroom.group);

    // Smart home hardware indicators tied to real telemetry
    // 1) Wall siren beacon on front-left corner under roof fascia
    const sirenGroup = new THREE.Group();
    sirenGroup.position.set(-3.88, 4.92, 2.95);
    sirenGroup.add(makeBox(THREE, 0.22, 0.22, 0.1, mat.darkMetal, [0, 0, 0]));
    const sirenBeaconMat = new THREE.MeshStandardMaterial({
      color: 0xb91c1c,
      emissive: 0xff2222,
      emissiveIntensity: 0.08,
      roughness: 0.25
    });
    const sirenDome = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), sirenBeaconMat);
    sirenDome.position.z = 0.05;
    sirenGroup.add(sirenDome);
    const sirenLight = new THREE.PointLight(0xff2a20, 0, 7.5, 1.6);
    sirenLight.position.set(0, 0, 0.22);
    sirenGroup.add(sirenLight);
    houseGroup.add(sirenGroup);

    // 2) Exterior drainage pump unit at front-right base
    const pumpGroup = new THREE.Group();
    pumpGroup.position.set(4.42, 0.28, 1.55);
    pumpGroup.add(makeBox(THREE, 0.42, 0.34, 0.36, mat.darkMetal, [0, 0, 0]));
    const pumpLedMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.15,
      roughness: 0.25
    });
    const pumpLed = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 10), pumpLedMat);
    pumpLed.position.set(0, 0.2, 0);
    pumpGroup.add(pumpLed);
    const pumpLight = new THREE.PointLight(0x38bdf8, 0, 4.5, 1.6);
    pumpLight.position.set(0.2, 0.35, 0.2);
    pumpGroup.add(pumpLight);
    houseGroup.add(pumpGroup);

    return {
      root: root,
      envGroup: envGroup,
      houseGroup: houseGroup,
      handles: {
        windowLeftSash: winObj.leftSash,
        windowRightSash: winObj.rightSash,
        windowBlindPivot: winObj.blindPivot,
        pendantLight: kitchen.pendantLight,
        pendantDomeMat: kitchen.domeMat,
        pendantBulbMat: kitchen.bulbMat,
        kitchenFillLight: kitchen.kitchenFillLight,
        kitchenStripMat: kitchen.kitchenStripMat,
        fanBlades: kitchen.fanBlades,
        fanLedMat: kitchen.fanLedMat,
        bedLeftLight: bedroom.leftLamp.light,
        bedLeftShadeMat: bedroom.leftLamp.shadeMat,
        bedRightLight: bedroom.rightLamp.light,
        bedRightShadeMat: bedroom.rightLamp.shadeMat,
        sirenBeaconMat: sirenBeaconMat,
        sirenLight: sirenLight,
        pumpLedMat: pumpLedMat,
        pumpLight: pumpLight,
        oliveFoliage: olive.foliage,
        shrubs: shrubs
      }
    };
  }

  House3D.buildArchitecture = buildArchitecture;
})();
