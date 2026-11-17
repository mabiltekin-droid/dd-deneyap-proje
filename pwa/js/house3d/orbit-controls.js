/* ==========================================================================
   house3d/orbit-controls.js — Akıcı 360° yörünge, zoom, pan ve oda odaklanma
   --------------------------------------------------------------------------
   CDN bare-specifier ("three") sorununa takılmadan yüklenen Three.js örneği
   üzerinden çalışan, düşük maliyetli (60 FPS) OrbitControls implementasyonu.
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});
  const House3D = (App.House3D = App.House3D || {});

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function createOrbitControls(THREE, camera, domElement, opts) {
    const o = opts || {};
    const defaultPos = new THREE.Vector3(
      o.defaultPos ? o.defaultPos[0] : -5.8,
      o.defaultPos ? o.defaultPos[1] : 4.85,
      o.defaultPos ? o.defaultPos[2] : 10.25
    );
    const defaultTarget = new THREE.Vector3(
      o.defaultTarget ? o.defaultTarget[0] : 0.05,
      o.defaultTarget ? o.defaultTarget[1] : 2.7,
      o.defaultTarget ? o.defaultTarget[2] : -0.15
    );

    const target = defaultTarget.clone();
    const curTarget = target.clone();

    const offset = camera.position.clone().sub(target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    const curSph = sph.clone();

    const minDistance = o.minDistance || 4.8;
    const maxDistance = o.maxDistance || 21.0;
    const minPolar = o.minPolarAngle || 0.22;
    const maxPolar = o.maxPolarAngle || Math.PI * 0.475;
    const damping = o.dampingFactor || 0.11;
    const rotateSpeed = o.rotateSpeed || 0.0068;
    const zoomSpeed = o.zoomSpeed || 0.0012;
    const panSpeed = o.panSpeed || 0.0095;

    let enabled = true;
    const pointers = new Map();
    let mode = 'none'; // 'rotate' | 'pan' | 'pinch'
    let prevPinchDist = 0;
    let prevMid = null;
    let flyState = null;

    function clampTarget(vec) {
      vec.x = clamp(vec.x, -4.2, 4.2);
      vec.y = clamp(vec.y, 0.8, 5.2);
      vec.z = clamp(vec.z, -3.0, 3.2);
    }

    function cancelFly() {
      flyState = null;
    }

    function panBy(dx, dy) {
      const dist = curSph.radius;
      const factor = dist * panSpeed * 0.14;
      const forward = new THREE.Vector3().subVectors(target, camera.position).normalize();
      const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();
      target.addScaledVector(right, -dx * factor);
      target.addScaledVector(up, dy * factor);
      clampTarget(target);
    }

    function pointerCenterAndDist() {
      const pts = Array.from(pointers.values());
      if (pts.length < 2) return null;
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      return {
        dist: Math.hypot(dx, dy),
        mx: (pts[0].x + pts[1].x) * 0.5,
        my: (pts[0].y + pts[1].y) * 0.5
      };
    }

    function onPointerDown(e) {
      if (!enabled) return;
      cancelFly();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY });
      try { domElement.setPointerCapture(e.pointerId); } catch (err) { /* yoksay */ }

      if (pointers.size === 1) {
        mode = (e.button === 2 || e.shiftKey) ? 'pan' : 'rotate';
      } else if (pointers.size >= 2) {
        mode = 'pinch';
        const info = pointerCenterAndDist();
        prevPinchDist = info ? info.dist : 0;
        prevMid = info ? { x: info.mx, y: info.my } : null;
      }
    }

    function onPointerMove(e) {
      if (!enabled || !pointers.has(e.pointerId)) return;
      const p = pointers.get(e.pointerId);
      const dx = e.clientX - p.lastX;
      const dy = e.clientY - p.lastY;
      p.x = e.clientX;
      p.y = e.clientY;
      p.lastX = e.clientX;
      p.lastY = e.clientY;

      if (pointers.size === 1) {
        if (mode === 'pan') {
          panBy(dx, dy);
        } else {
          sph.theta -= dx * rotateSpeed;
          sph.phi = clamp(sph.phi - dy * rotateSpeed, minPolar, maxPolar);
        }
      } else if (pointers.size >= 2 && mode === 'pinch') {
        const info = pointerCenterAndDist();
        if (info && prevPinchDist > 0) {
          const ratio = prevPinchDist / Math.max(10, info.dist);
          sph.radius = clamp(sph.radius * Math.pow(ratio, 0.9), minDistance, maxDistance);
          if (prevMid) {
            panBy((info.mx - prevMid.x) * 0.8, (info.my - prevMid.y) * 0.8);
          }
          prevPinchDist = info.dist;
          prevMid = { x: info.mx, y: info.my };
        }
      }
    }

    function onPointerUp(e) {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        mode = 'none';
        prevPinchDist = 0;
        prevMid = null;
      } else if (pointers.size === 1) {
        mode = 'rotate';
        const rem = pointers.values().next().value;
        rem.lastX = rem.x;
        rem.lastY = rem.y;
      }
    }

    function onWheel(e) {
      if (!enabled) return;
      e.preventDefault();
      cancelFly();
      const scale = Math.exp(clamp(e.deltaY, -160, 160) * zoomSpeed);
      sph.radius = clamp(sph.radius * scale, minDistance, maxDistance);
    }

    function onContextMenu(e) {
      e.preventDefault();
    }

    function setImmediate(posArr, tgtArr) {
      cancelFly();
      target.set(tgtArr[0], tgtArr[1], tgtArr[2]);
      curTarget.copy(target);
      const v = new THREE.Vector3(posArr[0], posArr[1], posArr[2]).sub(target);
      sph.setFromVector3(v);
      sph.phi = clamp(sph.phi, minPolar, maxPolar);
      sph.radius = clamp(sph.radius, minDistance, maxDistance);
      curSph.copy(sph);
      applyCamera();
    }

    function flyTo(posArr, tgtArr, durationMs) {
      const nextTarget = new THREE.Vector3(tgtArr[0], tgtArr[1], tgtArr[2]);
      const nextVec = new THREE.Vector3(posArr[0], posArr[1], posArr[2]).sub(nextTarget);
      const endSph = new THREE.Spherical().setFromVector3(nextVec);
      endSph.phi = clamp(endSph.phi, minPolar, maxPolar);
      endSph.radius = clamp(endSph.radius, minDistance, maxDistance);

      flyState = {
        startTime: performance.now(),
        duration: durationMs || 680,
        startTarget: curTarget.clone(),
        endTarget: nextTarget,
        startPos: camera.position.clone(),
        endPos: new THREE.Vector3().setFromSpherical(endSph).add(nextTarget)
      };
    }

    function reset(instant) {
      const pos = [defaultPos.x, defaultPos.y, defaultPos.z];
      const tgt = [defaultTarget.x, defaultTarget.y, defaultTarget.z];
      if (instant) setImmediate(pos, tgt);
      else flyTo(pos, tgt, 640);
    }

    function applyCamera() {
      const pos = new THREE.Vector3().setFromSpherical(curSph).add(curTarget);
      camera.position.copy(pos);
      camera.lookAt(curTarget);
    }

    function update() {
      if (flyState) {
        const raw = (performance.now() - flyState.startTime) / flyState.duration;
        const t = clamp(raw, 0, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        const posNow = flyState.startPos.clone().lerp(flyState.endPos, ease);
        curTarget.copy(flyState.startTarget).lerp(flyState.endTarget, ease);
        target.copy(curTarget);
        const v = posNow.sub(curTarget);
        curSph.setFromVector3(v);
        sph.copy(curSph);
        applyCamera();
        if (t >= 1) flyState = null;
        return;
      }

      const dTheta = Math.atan2(Math.sin(sph.theta - curSph.theta), Math.cos(sph.theta - curSph.theta));
      curSph.theta += dTheta * damping;
      curSph.phi += (sph.phi - curSph.phi) * damping;
      curSph.radius += (sph.radius - curSph.radius) * damping;
      curTarget.lerp(target, damping);
      applyCamera();
    }

    domElement.addEventListener('pointerdown', onPointerDown);
    domElement.addEventListener('pointermove', onPointerMove);
    domElement.addEventListener('pointerup', onPointerUp);
    domElement.addEventListener('pointercancel', onPointerUp);
    domElement.addEventListener('wheel', onWheel, { passive: false });
    domElement.addEventListener('contextmenu', onContextMenu);

    setImmediate(
      [defaultPos.x, defaultPos.y, defaultPos.z],
      [defaultTarget.x, defaultTarget.y, defaultTarget.z]
    );

    function dispose() {
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerup', onPointerUp);
      domElement.removeEventListener('pointercancel', onPointerUp);
      domElement.removeEventListener('wheel', onWheel);
      domElement.removeEventListener('contextmenu', onContextMenu);
      pointers.clear();
    }

    return {
      update: update,
      flyTo: flyTo,
      reset: reset,
      setEnabled: function (v) { enabled = !!v; },
      getCamera: function () { return camera; },
      dispose: dispose
    };
  }

  House3D.createOrbitControls = createOrbitControls;
})();
