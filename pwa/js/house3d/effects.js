/* ==========================================================================
   house3d/effects.js — Canlı sensör, aktüatör, mod ve afet efektleri motoru
   --------------------------------------------------------------------------
   Programdaki gerçek telemetri alanlarına (gasPpm/state, flame, rain, flood,
   vib, fan, pump, buzzer, window, blind, mode, online) bağlı dinamik 3D
   partikül sistemleri, dalgalı sel suyu, sismik halka ve iç mekan ışıkları.
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});
  const House3D = (App.House3D = App.House3D || {});

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function createParticleSystem(THREE, maxCount, opts) {
    const positions = new Float32Array(maxCount * 3);
    const velocities = new Float32Array(maxCount * 3);
    const ages = new Float32Array(maxCount);
    const lives = new Float32Array(maxCount);

    for (let i = 0; i < maxCount; i++) {
      ages[i] = Math.random() * 2;
      lives[i] = 1 + Math.random();
      positions[i * 3 + 1] = -999;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      size: opts.size || 0.35,
      map: opts.map || null,
      color: opts.color || 0xffffff,
      transparent: true,
      opacity: opts.opacity !== undefined ? opts.opacity : 0.75,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      sizeAttenuation: true
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.visible = false;

    return {
      points: points,
      geo: geo,
      mat: mat,
      positions: positions,
      velocities: velocities,
      ages: ages,
      lives: lives,
      maxCount: maxCount
    };
  }

  function createEffects(THREE, scene, arch, lib, lights) {
    const handles = arch.handles;
    const houseGroup = arch.houseGroup;
    const envGroup = arch.envGroup;
    const disposables = [];
    const track = function (x) { if (x) disposables.push(x); return x; };

    /* ---- 1. Dinamik 3D Sel / Su Baskını Katmanı -------------------------- */
    const waterGeo = track(new THREE.PlaneGeometry(15.2, 12.2, 32, 26));
    waterGeo.rotateX(-Math.PI / 2);
    const waterBaseY = new Float32Array(waterGeo.attributes.position.count);
    for (let i = 0; i < waterBaseY.length; i++) {
      waterBaseY[i] = waterGeo.attributes.position.getY(i);
    }
    const waterMat = track(new THREE.MeshPhysicalMaterial({
      color: 0x2a88c8,
      emissive: 0x0b3a66,
      emissiveIntensity: 0.25,
      transparent: true,
      opacity: 0.62,
      roughness: 0.14,
      metalness: 0.12
    }));
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.set(0, -0.25, 0.2);
    waterMesh.visible = false;
    waterMesh.receiveShadow = true;
    envGroup.add(waterMesh);

    const floodLight = new THREE.PointLight(0x38bdf8, 0, 14, 1.4);
    floodLight.position.set(0.5, 2.2, 3.8);
    scene.add(floodLight);

    /* ---- 2. Sismik Dalga Halkaları (Deprem / Sarsıntı) ------------------- */
    const rings = [];
    const ringGroup = new THREE.Group();
    ringGroup.position.set(0, 0.06, 0);
    for (let r = 0; r < 3; r++) {
      const rGeo = track(new THREE.RingGeometry(4.6, 4.92, 48));
      rGeo.rotateX(-Math.PI / 2);
      const rMat = track(new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false
      }));
      const rMesh = new THREE.Mesh(rGeo, rMat);
      rMesh.userData.phase = r / 3;
      rMesh.visible = false;
      ringGroup.add(rMesh);
      rings.push(rMesh);
    }
    envGroup.add(ringGroup);

    const eqLight = new THREE.PointLight(0xff2a1f, 0, 16, 1.4);
    eqLight.position.set(-1.5, 4.2, 3.6);
    scene.add(eqLight);

    /* ---- 3. Yangın Alevi + Yükselen Duman Partikülleri -------------------- */
    const fireSys = createParticleSystem(THREE, 85, {
      size: 0.56,
      map: lib.tex.softSprite,
      color: 0xff6e1a,
      opacity: 0.88,
      additive: true
    });
    track(fireSys.geo); track(fireSys.mat);
    houseGroup.add(fireSys.points);

    const smokeSys = createParticleSystem(THREE, 70, {
      size: 0.78,
      map: lib.tex.softSprite,
      color: 0x5c646b,
      opacity: 0.45,
      additive: false
    });
    track(smokeSys.geo); track(smokeSys.mat);
    houseGroup.add(smokeSys.points);

    const fireLight = new THREE.PointLight(0xff5511, 0, 7.2, 1.5);
    fireLight.position.set(2.52, 2.15, -2.2);
    houseGroup.add(fireLight);

    /* ---- 4. Zehirli Gaz Bulutu Partikülleri ------------------------------ */
    const gasSys = createParticleSystem(THREE, 85, {
      size: 0.85,
      map: lib.tex.softSprite,
      color: 0xb7e038,
      opacity: 0.42,
      additive: false
    });
    track(gasSys.geo); track(gasSys.mat);
    houseGroup.add(gasSys.points);

    const gasLight = new THREE.PointLight(0xa3e635, 0, 6.2, 1.6);
    gasLight.position.set(2.45, 2.1, -2.0);
    houseGroup.add(gasLight);

    /* ---- 5. Dış Yağmur Partikülleri ------------------------------------- */
    const rainSys = createParticleSystem(THREE, 140, {
      size: 0.18,
      map: lib.tex.softSprite,
      color: 0x93c5fd,
      opacity: 0.55,
      additive: false
    });
    track(rainSys.geo); track(rainSys.mat);
    envGroup.add(rainSys.points);

    /* ---- 6. Su Tahliye Pompası Akışı ------------------------------------- */
    const pumpSys = createParticleSystem(THREE, 36, {
      size: 0.22,
      map: lib.tex.softSprite,
      color: 0x60a5fa,
      opacity: 0.75,
      additive: false
    });
    track(pumpSys.geo); track(pumpSys.mat);
    houseGroup.add(pumpSys.points);

    /* ---- İç durum & animasyon değişkenleri -------------------------------- */
    const state = {
      gasState: 'normal',
      gasPpm: 110,
      flame: false,
      vib: false,
      flood: false,
      rain: false,
      fan: false,
      pump: false,
      buzzer: false,
      windowDeg: 28,
      blindDeg: 180,
      mode: 'home',
      online: true,
      nightOverride: null // null = mod/temadan takip, true/false = kullanıcı seçimi
    };

    let currentWaterLevel = -0.35;
    let currentWindowDeg = 28;
    let currentBlindDeg = 180;
    let clockTime = 0;

    function isNightMode() {
      if (state.nightOverride !== null) return state.nightOverride;
      if (state.mode === 'night') return true;
      const theme = document.documentElement.getAttribute('data-theme');
      return theme === 'dark' || theme === 'amoled';
    }

    function setState(telemetry, meta) {
      const d = telemetry || {};
      const m = meta || {};
      state.gasState = m.state || d.state || 'normal';
      state.gasPpm = Number(d.gasPpm) || 0;
      state.flame = !!(d.flame === true || d.flame === 'true');
      state.vib = !!(d.vib === true || d.vib === 'true');
      state.flood = !!(d.flood === true || d.flood === 'true');
      state.rain = !!(d.rain === true || d.rain === 'true');
      state.fan = !!(d.fan === true || d.fan === 'true');
      state.pump = !!(d.pump === true || d.pump === 'true');
      state.buzzer = !!(d.buzzer === true || d.buzzer === 'true');
      if (typeof d.window === 'number' && !isNaN(d.window)) {
        state.windowDeg = clamp(d.window, 0, 180);
      }
      if (typeof d.blind === 'number' && !isNaN(d.blind)) {
        state.blindDeg = clamp(d.blind, 0, 180);
      }
      if (m.online !== undefined) state.online = !!m.online;
    }

    function setMode(mode) {
      state.mode = mode || 'home';
    }

    function setNightOverride(val) {
      state.nightOverride = val;
    }

    function respawnFire(i) {
      fireSys.positions[i * 3] = 2.52 + (Math.random() - 0.5) * 0.42;
      fireSys.positions[i * 3 + 1] = 1.68 + Math.random() * 0.08;
      fireSys.positions[i * 3 + 2] = -2.35 + (Math.random() - 0.5) * 0.34;
      fireSys.velocities[i * 3] = (Math.random() - 0.5) * 0.25;
      fireSys.velocities[i * 3 + 1] = 0.85 + Math.random() * 0.9;
      fireSys.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.25;
      fireSys.ages[i] = 0;
      fireSys.lives[i] = 0.45 + Math.random() * 0.45;
    }

    function respawnSmoke(i) {
      smokeSys.positions[i * 3] = 2.52 + (Math.random() - 0.5) * 0.48;
      smokeSys.positions[i * 3 + 1] = 2.05 + Math.random() * 0.15;
      smokeSys.positions[i * 3 + 2] = -2.25 + (Math.random() - 0.5) * 0.35;
      smokeSys.velocities[i * 3] = (Math.random() - 0.5) * 0.35;
      smokeSys.velocities[i * 3 + 1] = 0.65 + Math.random() * 0.55;
      smokeSys.velocities[i * 3 + 2] = 0.28 + Math.random() * 0.35;
      smokeSys.ages[i] = 0;
      smokeSys.lives[i] = 1.2 + Math.random() * 0.9;
    }

    function respawnGas(i) {
      gasSys.positions[i * 3] = 2.4 + (Math.random() - 0.5) * 1.1;
      gasSys.positions[i * 3 + 1] = 1.5 + Math.random() * 0.55;
      gasSys.positions[i * 3 + 2] = -2.0 + (Math.random() - 0.5) * 1.1;
      const boost = state.fan ? 1.85 : 1.0;
      gasSys.velocities[i * 3] = (Math.random() - 0.52) * 0.5 * boost;
      gasSys.velocities[i * 3 + 1] = (0.3 + Math.random() * 0.45) * boost;
      gasSys.velocities[i * 3 + 2] = (0.32 + Math.random() * 0.45) * boost;
      gasSys.ages[i] = 0;
      gasSys.lives[i] = 1.35 + Math.random() * 1.05;
    }

    function respawnRain(i) {
      rainSys.positions[i * 3] = -7.2 + Math.random() * 14.4;
      rainSys.positions[i * 3 + 1] = 7.8 + Math.random() * 2.5;
      rainSys.positions[i * 3 + 2] = -3.8 + Math.random() * 9.5;
      rainSys.velocities[i * 3] = 0.7;
      rainSys.velocities[i * 3 + 1] = -9.5 - Math.random() * 2.5;
      rainSys.velocities[i * 3 + 2] = 0.45;
      rainSys.ages[i] = 0;
      rainSys.lives[i] = 0.95 + Math.random() * 0.35;
    }

    function respawnPump(i) {
      pumpSys.positions[i * 3] = 4.66;
      pumpSys.positions[i * 3 + 1] = 0.35;
      pumpSys.positions[i * 3 + 2] = 1.55;
      pumpSys.velocities[i * 3] = 1.15 + Math.random() * 0.55;
      pumpSys.velocities[i * 3 + 1] = 0.6 + Math.random() * 0.35;
      pumpSys.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
      pumpSys.ages[i] = 0;
      pumpSys.lives[i] = 0.5 + Math.random() * 0.25;
    }

    function stepParticles(sys, active, dt, respawnFn, gravity) {
      sys.points.visible = active;
      if (!active) return;
      for (let i = 0; i < sys.maxCount; i++) {
        sys.ages[i] += dt;
        if (sys.ages[i] >= sys.lives[i] || sys.positions[i * 3 + 1] < -1.0) {
          respawnFn(i);
        } else {
          if (gravity) sys.velocities[i * 3 + 1] += gravity * dt;
          sys.positions[i * 3] += sys.velocities[i * 3] * dt;
          sys.positions[i * 3 + 1] += sys.velocities[i * 3 + 1] * dt;
          sys.positions[i * 3 + 2] += sys.velocities[i * 3 + 2] * dt;
        }
      }
      sys.geo.attributes.position.needsUpdate = true;
    }

    const _camShakeOffset = new THREE.Vector3();

    function clearCameraShake(camera) {
      if (_camShakeOffset.lengthSq() > 0 && camera) {
        camera.position.sub(_camShakeOffset);
        _camShakeOffset.set(0, 0, 0);
      }
    }

    function update(dt, camera, reducedMotion) {
      const clampedDt = Math.min(0.05, Math.max(0.001, dt));
      clockTime += clampedDt;
      const smooth = 1 - Math.exp(-8 * clampedDt);
      const night = isNightMode();
      const pulseFast = 0.5 + 0.5 * Math.sin(clockTime * 11.5);
      const pulseMed = 0.5 + 0.5 * Math.sin(clockTime * 6.5);

      /* ---- A. Gökyüzü, Güneş/Ay & İç Mekan Aydınlatma (Gündüz/Gece/Mod/Alarm) */
      const targetSunInt = night ? 0.65 : (state.rain || state.flood ? 1.15 : 2.05);
      const targetHemiInt = night ? 0.42 : (state.rain || state.flood ? 0.72 : 1.05);
      lights.sun.intensity = lerp(lights.sun.intensity, targetSunInt, smooth);
      lights.hemi.intensity = lerp(lights.hemi.intensity, targetHemiInt, smooth);

      const sunColor = night ? 0x8db4e8 : 0xfff1d8;
      lights.sun.color.lerp(new THREE.Color(sunColor), smooth);

      const awayMode = state.mode === 'away';
      const alarmRed = state.flame || state.vib || state.gasState === 'danger';
      const alarmFlood = state.flood;

      // Normal warm home lighting
      const warmMult = awayMode ? 0.25 : (night ? 1.25 : 0.92);
      const pendantTarget = alarmRed
        ? (0.5 + pulseFast * 2.2)
        : (alarmFlood ? 1.4 : (night && state.mode === 'night' ? 0.9 : 2.35 * warmMult));
      const bedTarget = alarmRed
        ? (0.4 + pulseFast * 1.4)
        : (awayMode ? 0.2 : (night ? 2.15 : 1.35));

      handles.pendantLight.intensity = lerp(handles.pendantLight.intensity, pendantTarget, smooth);
      handles.bedLeftLight.intensity = lerp(handles.bedLeftLight.intensity, bedTarget, smooth);
      handles.bedRightLight.intensity = lerp(handles.bedRightLight.intensity, bedTarget, smooth);
      handles.kitchenFillLight.intensity = lerp(handles.kitchenFillLight.intensity, awayMode ? 0.2 : 1.05, smooth);

      if (alarmRed) {
        const c = new THREE.Color().setRGB(1.0, 0.22 + pulseFast * 0.18, 0.16);
        handles.pendantLight.color.lerp(c, 0.25);
        handles.bedLeftLight.color.lerp(c, 0.25);
        handles.bedRightLight.color.lerp(c, 0.25);
        handles.pendantBulbMat.emissive.setHex(0xff3020);
        handles.kitchenStripMat.emissive.setHex(0xff4422);
      } else if (alarmFlood) {
        const cb = new THREE.Color(0x4ea8ff);
        handles.pendantLight.color.lerp(cb, 0.2);
        handles.bedLeftLight.color.lerp(cb, 0.2);
        handles.bedRightLight.color.lerp(cb, 0.2);
        handles.pendantBulbMat.emissive.setHex(0x60a5fa);
        handles.kitchenStripMat.emissive.setHex(0x60a5fa);
      } else {
        const cw = new THREE.Color(0xffcb82);
        handles.pendantLight.color.lerp(cw, 0.18);
        handles.bedLeftLight.color.lerp(new THREE.Color(0xffba6a), 0.18);
        handles.bedRightLight.color.lerp(new THREE.Color(0xffba6a), 0.18);
        handles.pendantBulbMat.emissive.setHex(0xffc86b);
        handles.kitchenStripMat.emissive.setHex(0xffcb78);
      }

      /* ---- B. Pencere & Panjur Servo Açıları (0..180°) -------------------- */
      currentWindowDeg = lerp(currentWindowDeg, state.windowDeg, smooth);
      const openFrac = clamp(currentWindowDeg / 180, 0, 1);
      const swingAngle = openFrac * (Math.PI * 0.48); // max ~86 deg outward swing
      handles.windowLeftSash.rotation.y = -swingAngle;
      handles.windowRightSash.rotation.y = swingAngle;

      currentBlindDeg = lerp(currentBlindDeg, state.blindDeg, smooth);
      // blind 0 deg = kapalı (panjur tüm pencereyi kaplar, scale 1.0); 180 deg = açık (yukarı toplanmış)
      const blindClosedFrac = 1 - clamp(currentBlindDeg / 180, 0, 1);
      handles.windowBlindPivot.scale.y = Math.max(0.03, blindClosedFrac);

      /* ---- C. Fan, Pompa ve Siren Aktüatörleri ------------------------------ */
      if (state.fan) {
        handles.fanBlades.rotation.y += clampedDt * 18.0;
        handles.fanLedMat.emissiveIntensity = 1.6;
      } else {
        handles.fanLedMat.emissiveIntensity = 0.2;
      }

      if (state.pump) {
        handles.pumpLedMat.emissiveIntensity = 1.1 + pulseFast * 0.9;
        handles.pumpLight.intensity = 1.4 + pulseFast * 0.8;
      } else {
        handles.pumpLedMat.emissiveIntensity = 0.15;
        handles.pumpLight.intensity = lerp(handles.pumpLight.intensity, 0, smooth);
      }
      stepParticles(pumpSys, state.pump, clampedDt, respawnPump, -6.5);

      const sirenActive = state.buzzer || state.flame || state.vib || state.gasState === 'danger';
      if (sirenActive) {
        handles.sirenBeaconMat.emissiveIntensity = 0.35 + pulseFast * 2.5;
        handles.sirenLight.intensity = 0.5 + pulseFast * 3.0;
        handles.sirenLight.color.setHex(state.flood && !state.flame && !state.vib ? 0x3b82f6 : 0xff261b);
      } else {
        handles.sirenBeaconMat.emissiveIntensity = 0.08;
        handles.sirenLight.intensity = lerp(handles.sirenLight.intensity, 0, smooth);
      }

      /* ---- D. Deprem / Sarsıntı Efekti (houseGroup + Dalga Halkaları) -------- */
      if (state.vib) {
        const amp = reducedMotion ? 0.025 : 0.11;
        const sx = (Math.sin(clockTime * 37) * 0.65 + Math.sin(clockTime * 59) * 0.35) * amp;
        const sz = (Math.cos(clockTime * 43) * 0.6 + Math.sin(clockTime * 67) * 0.4) * amp * 0.75;
        houseGroup.position.set(sx, Math.abs(Math.sin(clockTime * 48)) * amp * 0.18, sz);
        houseGroup.rotation.z = sx * 0.09;
        houseGroup.rotation.x = sz * 0.06;

        if (!reducedMotion && camera) {
          _camShakeOffset.set(sx * 0.42, Math.sin(clockTime * 52) * 0.028, sz * 0.36);
          camera.position.add(_camShakeOffset);
        }

        eqLight.intensity = 1.6 + pulseFast * 2.4;
        rings.forEach(function (rMesh) {
          rMesh.visible = true;
          rMesh.userData.phase = (rMesh.userData.phase + clampedDt * 0.75) % 1;
          const p = rMesh.userData.phase;
          const sc = 1 + p * 1.15;
          rMesh.scale.set(sc, sc, 1);
          rMesh.material.opacity = (1 - p) * 0.68;
        });
      } else {
        houseGroup.position.lerp(new THREE.Vector3(0, 0, 0), 0.25);
        houseGroup.rotation.z = lerp(houseGroup.rotation.z, 0, 0.25);
        houseGroup.rotation.x = lerp(houseGroup.rotation.x, 0, 0.25);
        eqLight.intensity = lerp(eqLight.intensity, 0, smooth);
        rings.forEach(function (rMesh) { rMesh.visible = false; });
      }

      /* ---- E. Alev / Yangın & Yükselen Duman Partikülleri ------------------- */
      stepParticles(fireSys, state.flame, clampedDt, respawnFire, 0);
      stepParticles(smokeSys, state.flame, clampedDt, respawnSmoke, 0);
      if (state.flame) {
        fireLight.intensity = 2.6 + Math.sin(clockTime * 29) * 0.85 + Math.cos(clockTime * 17) * 0.45;
      } else {
        fireLight.intensity = lerp(fireLight.intensity, 0, smooth);
      }

      /* ---- F. Gaz Kaçağı / Hava Kalitesi Bulutu ---------------------------- */
      const gasWarnOrDanger = state.gasState === 'warning' || state.gasState === 'danger';
      if (gasWarnOrDanger) {
        gasSys.mat.color.setHex(state.gasState === 'danger' ? 0x9de635 : 0xeab308);
        gasSys.mat.opacity = state.gasState === 'danger' ? 0.56 : 0.34;
        gasLight.intensity = (state.gasState === 'danger' ? 2.1 : 1.0) + pulseMed * 0.55;
        gasLight.color.setHex(state.gasState === 'danger' ? 0xa3e635 : 0xfacc15);
      } else {
        gasLight.intensity = lerp(gasLight.intensity, 0, smooth);
      }
      stepParticles(gasSys, gasWarnOrDanger, clampedDt, respawnGas, 0);

      /* ---- G. Sel / Su Baskını Dalgalı Su Katmanı & Yağmur ----------------- */
      const targetWater = state.flood ? 0.9 : -0.35;
      currentWaterLevel = lerp(currentWaterLevel, targetWater, clampedDt * 1.8);
      if (state.flood || currentWaterLevel > 0.02) {
        waterMesh.visible = true;
        waterMesh.position.y = currentWaterLevel;
        const posAttr = waterGeo.attributes.position;
        for (let i = 0; i < posAttr.count; i++) {
          const x = posAttr.getX(i);
          const z = posAttr.getZ(i);
          const wave = Math.sin(x * 1.15 + clockTime * 2.8) * 0.045 +
                       Math.cos(z * 1.35 + clockTime * 2.2) * 0.035;
          posAttr.setY(i, waterBaseY[i] + wave);
        }
        posAttr.needsUpdate = true;
        floodLight.intensity = state.flood ? (1.4 + pulseMed * 1.6) : 0;
      } else {
        waterMesh.visible = false;
        floodLight.intensity = lerp(floodLight.intensity, 0, smooth);
      }

      stepParticles(rainSys, state.rain || state.flood, clampedDt, respawnRain, -1.8);

      /* ---- H. Hafif rüzgar / yaprak salınımı ------------------------------- */
      if (!reducedMotion && handles.oliveFoliage) {
        handles.oliveFoliage.rotation.z = Math.sin(clockTime * 1.2) * (state.rain ? 0.035 : 0.015);
        handles.oliveFoliage.rotation.x = Math.cos(clockTime * 0.9) * (state.rain ? 0.025 : 0.01);
      }

      return { night: night };
    }

    function dispose() {
      disposables.forEach(function (d) {
        if (d && typeof d.dispose === 'function') d.dispose();
      });
      disposables.length = 0;
    }

    return {
      setState: setState,
      setMode: setMode,
      setNightOverride: setNightOverride,
      isNightMode: isNightMode,
      update: update,
      clearCameraShake: clearCameraShake,
      dispose: dispose
    };
  }

  House3D.createEffects = createEffects;
})();
