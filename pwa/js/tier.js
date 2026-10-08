/* ==========================================================================
   tier.js — Donanım Profilleme Motoru (Hardware Tiering Engine)
   - Cihaz donanım gücüne dinamik adaptasyon (low | mid | ultra)
   - Metrikler: concurrency, deviceMemory, getBattery, prefers-reduced-motion,
     15-kare mikro rAF (FPS) testi
   - Dinamik Düşürme (Dynamic Throttle): 3 sn boyunca FPS < 35 ise kademe düşür
   ========================================================================== */

(function () {
  'use strict';

  window.App = window.App || {};

  var TIERS = ['low', 'mid', 'ultra'];
  var currentTier = 'mid';
  var listeners = [];
  var fpsMonitorActive = false;
  var lowFpsConsecutiveMs = 0;
  var lastFrameTime = 0;
  var monitorRafId = null;

  function notify(tier) {
    document.documentElement.setAttribute('data-tier', tier);
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](tier);
      } catch (e) {
        console.warn('[tier] Dinleyici hatası:', e);
      }
    }
  }

  function setTier(newTier) {
    if (TIERS.indexOf(newTier) === -1) return;
    if (currentTier === newTier) return;
    console.info('[tier] Donanım profili güncellendi:', currentTier, '->', newTier);
    currentTier = newTier;
    notify(currentTier);

    if (currentTier === 'low') {
      stopFpsMonitor();
    }
  }

  function stepDown() {
    if (currentTier === 'ultra') {
      setTier('mid');
    } else if (currentTier === 'mid') {
      setTier('low');
    }
  }

  /* 1. Başlangıç Donanım Metrikleri */
  function detectInitialTier() {
    var reducedMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return 'low';

    var cores = navigator.hardwareConcurrency || 4;
    var mem = navigator.deviceMemory || 4;

    /* Düşük donanım / eski mobil */
    if (cores <= 2 || mem <= 2) {
      return 'low';
    }

    /* Güçlü PC / Amiral gemisi */
    if (cores >= 8 && mem >= 8) {
      return 'ultra';
    }
    if (cores >= 6 && mem >= 4) {
      return 'ultra';
    }

    return 'mid';
  }

  /* 2. Pil Seviyesi / Güç Tasarrufu */
  function checkBattery() {
    if (typeof navigator.getBattery === 'function') {
      navigator.getBattery().then(function (battery) {
        function evalBattery() {
          if (!battery.charging && battery.level <= 0.20) {
            console.warn('[tier] Düşük pil modu (%' + Math.round(battery.level * 100) + '), profil düşürülüyor.');
            setTier('low');
          }
        }
        evalBattery();
        battery.addEventListener('levelchange', evalBattery);
        battery.addEventListener('chargingchange', evalBattery);
      }).catch(function () {});
    }
  }

  /* 3. 15-Karelik Mikro rAF Benchmark */
  function runMicroBenchmark(callback) {
    var frames = 0;
    var maxFrames = 15;
    var lastTime = performance.now();
    var frameDeltas = [];

    function sample(now) {
      var delta = now - lastTime;
      lastTime = now;
      if (frames > 0) {
        frameDeltas.push(delta);
      }
      frames++;
      if (frames < maxFrames) {
        requestAnimationFrame(sample);
      } else {
        var total = 0;
        for (var i = 0; i < frameDeltas.length; i++) {
          total += frameDeltas[i];
        }
        var avgDelta = total / (frameDeltas.length || 1);
        var approxFps = 1000 / (avgDelta || 16.6);
        callback(approxFps, avgDelta);
      }
    }

    requestAnimationFrame(sample);
  }

  /* 4. Dinamik rAF FPS Monitörü (3 saniye < 35 FPS ise profil düşür) */
  function startFpsMonitor() {
    if (fpsMonitorActive || currentTier === 'low') return;
    fpsMonitorActive = true;
    lowFpsConsecutiveMs = 0;
    lastFrameTime = performance.now();

    function monitor(now) {
      if (!fpsMonitorActive) return;

      var delta = now - lastFrameTime;
      lastFrameTime = now;

      /* Makul delta aralığı (sekme arka plandayken aşırı yüksek delta oluşmasını yoksay) */
      if (delta > 0 && delta < 250) {
        var currentFps = 1000 / delta;
        if (currentFps < 35) {
          lowFpsConsecutiveMs += delta;
          if (lowFpsConsecutiveMs >= 3000) {
            console.warn('[tier] FPS 3 saniye boyunca < 35 (' + Math.round(currentFps) + ' fps), otomatik düşürülüyor.');
            stepDown();
            lowFpsConsecutiveMs = 0;
          }
        } else {
          lowFpsConsecutiveMs = Math.max(0, lowFpsConsecutiveMs - delta * 0.5);
        }
      }

      if (currentTier !== 'low') {
        monitorRafId = requestAnimationFrame(monitor);
      } else {
        fpsMonitorActive = false;
      }
    }

    monitorRafId = requestAnimationFrame(monitor);
  }

  function stopFpsMonitor() {
    fpsMonitorActive = false;
    if (monitorRafId) {
      cancelAnimationFrame(monitorRafId);
      monitorRafId = null;
    }
  }

  /* Anında Senkron Başlangıç (FOUC ve Layout Shift Önleme) */
  var initial = detectInitialTier();
  currentTier = initial;
  document.documentElement.setAttribute('data-tier', currentTier);

  /* Sayfa Yüklendiğinde Doğrulama ve Dinamik İzleme */
  function initTierEngine() {
    checkBattery();

    // İlk açılışta komut dosyaları ve ağ bağlantıları kurulurken FPS geçici düşebilir.
    // Gerçek boşta render performansını ölçmek için 1.2s beklenir.
    setTimeout(function () {
      runMicroBenchmark(function (fps) {
        console.info('[tier] Boşta rAF Testi: ~' + Math.round(fps) + ' FPS, ilk donanım kademesi:', currentTier);
        if (fps < 20) {
          setTier('low');
        } else if (fps < 42 && currentTier === 'ultra') {
          setTier('mid');
        }
        startFpsMonitor();
      });
    }, 1200);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        stopFpsMonitor();
      } else if (currentTier !== 'low') {
        startFpsMonitor();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTierEngine);
  } else {
    initTierEngine();
  }

  App.Tier = {
    get: function () { return currentTier; },
    set: setTier,
    isLow: function () { return currentTier === 'low'; },
    isMid: function () { return currentTier === 'mid'; },
    isUltra: function () { return currentTier === 'ultra'; },
    onChange: function (fn) {
      if (typeof fn === 'function') listeners.push(fn);
    },
    stepDown: stepDown,
    startFpsMonitor: startFpsMonitor,
    stopFpsMonitor: stopFpsMonitor
  };
})();
