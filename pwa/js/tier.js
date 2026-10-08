/* ==========================================================================
   tier.js — Donanım Profilleme Motoru (Hardware Tiering Engine)
   - Cihaz donanım gücüne dinamik adaptasyon (low | mid | ultra)
   - Metrikler: concurrency, deviceMemory, getBattery, prefers-reduced-motion,
     15-kare mikro rAF (FPS) testi
   - Dinamik Düşürme & Histerezis Toparlanma (Dynamic Throttle & StepUp)
   ========================================================================== */

(function () {
  'use strict';

  window.App = window.App || {};

  var TIERS = ['low', 'mid', 'ultra'];
  var currentTier = 'mid';
  var listeners = [];
  var fpsMonitorActive = false;
  var lowFpsConsecutiveMs = 0;
  var highFpsConsecutiveMs = 0;
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

    var baseline = detectInitialTier();
    if (currentTier === 'low' && baseline === 'low') {
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

  function stepUp() {
    var baseline = detectInitialTier();
    if (currentTier === 'low' && (baseline === 'mid' || baseline === 'ultra')) {
      setTier('mid');
    } else if (currentTier === 'mid' && baseline === 'ultra') {
      setTier('ultra');
    }
  }

  /* 1. Başlangıç Donanım Metrikleri */
  function detectInitialTier() {
    var reducedMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return 'low';

    var cores = navigator.hardwareConcurrency || 4;
    var mem = navigator.deviceMemory || (cores >= 8 ? 8 : 4);

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

  /* 2. Pil Seviyesi / Güç Tasarrufu & Şarj Değişimi */
  function checkBattery() {
    if (typeof navigator.getBattery === 'function') {
      navigator.getBattery().then(function (battery) {
        function evalBattery() {
          if (!battery.charging && battery.level <= 0.20) {
            console.warn('[tier] Düşük pil modu (%' + Math.round(battery.level * 100) + '), profil düşürülüyor.');
            setTier('low');
          } else if (battery.charging) {
            var baseline = detectInitialTier();
            if (TIERS.indexOf(currentTier) < TIERS.indexOf(baseline)) {
              console.info('[tier] Cihaz şarja takıldı, donanım profili yeniden değerlendiriliyor:', baseline);
              setTier(baseline);
              startFpsMonitor();
            }
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

  /* 4. Dinamik rAF FPS Monitörü (Düşürme & 5 sn >= 55 FPS ile Toparlanma) */
  function startFpsMonitor() {
    var baseline = detectInitialTier();
    if (fpsMonitorActive || (currentTier === 'low' && baseline === 'low')) return;
    fpsMonitorActive = true;
    lowFpsConsecutiveMs = 0;
    highFpsConsecutiveMs = 0;
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
          highFpsConsecutiveMs = 0;
          if (lowFpsConsecutiveMs >= 3000) {
            console.warn('[tier] FPS 3 saniye boyunca < 35 (' + Math.round(currentFps) + ' fps), otomatik düşürülüyor.');
            stepDown();
            lowFpsConsecutiveMs = 0;
          }
        } else {
          lowFpsConsecutiveMs = Math.max(0, lowFpsConsecutiveMs - delta * 0.5);
          if (currentFps >= 55) {
            highFpsConsecutiveMs += delta;
            var baselineHw = detectInitialTier();
            if (highFpsConsecutiveMs >= 5000) {
              if (TIERS.indexOf(currentTier) < TIERS.indexOf(baselineHw)) {
                console.info('[tier] FPS 5 saniye boyunca >= 55 (' + Math.round(currentFps) + ' fps), profil yükseltiliyor.');
                stepUp();
              }
              highFpsConsecutiveMs = 0;
            }
          } else {
            highFpsConsecutiveMs = Math.max(0, highFpsConsecutiveMs - delta * 0.5);
          }
        }
      }

      var currentBaseline = detectInitialTier();
      if (currentTier !== 'low' || currentBaseline !== 'low') {
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

  /* LCP Sonrası Gecikmeli Benchmark & Dinamik İzleme */
  function scheduleMicroBenchmark() {
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
    }, 400);
  }

  function initTierEngine() {
    checkBattery();

    if (document.readyState === 'complete') {
      scheduleMicroBenchmark();
    } else {
      window.addEventListener('load', scheduleMicroBenchmark, { once: true });
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        stopFpsMonitor();
      } else if (currentTier !== 'low' || detectInitialTier() !== 'low') {
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
    stepUp: stepUp,
    startFpsMonitor: startFpsMonitor,
    stopFpsMonitor: stopFpsMonitor
  };
})();
