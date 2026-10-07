/* ==========================================================================
   parallax.js — GSAP + Lenis Katmanlı Parallax & Donanım Profili Yöneticisi
   - 4 Katmanlı Parallax Hero Deneyimi (GSAP ScrollTrigger)
   - Lenis Yumuşak Kaydırma (Smooth Inertia Scroll) + GSAP Ticker Senkronizasyonu
   - Donanım Kademelerine Duyarlı Adaptasyon (ultra | mid | low)
   - Tehlike Anında Sinematik HUD / CRT Efekti Yönetimi
   ========================================================================== */

(function () {
  'use strict';

  window.App = window.App || {};

  var lenisInstance = null;
  var scrollTriggers = [];
  var tickerCallback = null;
  var isInitialized = false;

  function isReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function getTier() {
    if (isReducedMotion()) return 'low';
    return (window.App.Tier && window.App.Tier.get()) || 'mid';
  }

  /* ------------------------------------------------------------- Lenis Motoru */

  function initLenis(tier) {
    if (lenisInstance) {
      lenisInstance.destroy();
      lenisInstance = null;
    }

    if (tier === 'low' || isReducedMotion() || typeof window.Lenis === 'undefined') {
      return null;
    }

    try {
      var isUltra = (tier === 'ultra');
      lenisInstance = new window.Lenis({
        duration: isUltra ? 1.2 : 0.7,
        easing: function (t) {
          return Math.min(1, 1.001 - Math.pow(2, -10 * t));
        },
        orientation: 'vertical',
        gestureOrientation: 'vertical',
        smoothWheel: true,
        wheelMultiplier: isUltra ? 1.0 : 0.85,
        touchMultiplier: 1.2
      });

      if (window.ScrollTrigger) {
        lenisInstance.on('scroll', window.ScrollTrigger.update);
      }

      return lenisInstance;
    } catch (e) {
      console.warn('[parallax] Lenis başlatılamadı, doğal kaydırmaya dönülüyor:', e);
      return null;
    }
  }

  /* ------------------------------------------- GSAP ScrollTrigger Parallax */

  function cleanupParallax() {
    if (scrollTriggers.length) {
      scrollTriggers.forEach(function (st) {
        try { st.kill(); } catch (e) {}
      });
      scrollTriggers = [];
    }

    if (window.gsap && window.gsap.ticker && tickerCallback) {
      try {
        window.gsap.ticker.remove(tickerCallback);
      } catch (e) {}
      tickerCallback = null;
    }

    var hero = document.getElementById('hero');
    if (hero) {
      var layers = hero.querySelectorAll('[data-parallax-layer]');
      layers.forEach(function (layer) {
        layer.style.transform = '';
      });
    }
  }

  function initParallax(tier) {
    cleanupParallax();

    var hero = document.getElementById('hero');
    if (!hero) return;

    /* Düşük donanımda tüm JS scroll ve transformları kapat */
    if (tier === 'low' || isReducedMotion()) {
      return;
    }

    if (typeof window.gsap === 'undefined' || typeof window.ScrollTrigger === 'undefined') {
      console.info('[parallax] GSAP veya ScrollTrigger bulunamadı, doğal kaydırma devrede.');
      return;
    }

    try {
      window.gsap.registerPlugin(window.ScrollTrigger);

      /* Lenis ve GSAP Ticker Senkronizasyonu */
      if (lenisInstance) {
        tickerCallback = function (time) {
          if (lenisInstance) {
            lenisInstance.raf(time * 1000);
          }
        };
        window.gsap.ticker.add(tickerCallback);
        window.gsap.ticker.lagSmoothing(0);
      }

      /* Katman Hız Katsayıları (yPercent) */
      var speeds = {
        '1': 70, // Derinlik / Siber Izgara katmanı
        '2': 55, // Atmosferik Partikül / Nebula katmanı
        '3': 40, // Ana Başlık / HUD Metinleri
        '4': 10  // Ön Plan Şematik Silüet / Çerçeve
      };

      var isUltra = (tier === 'ultra');
      var layers = hero.querySelectorAll('[data-parallax-layer]');

      layers.forEach(function (layer) {
        var layerIndex = layer.getAttribute('data-parallax-layer');

        /* Mid profilde yalnızca katman 1 ve 3 hareket etsin (GPU optimizasyonu) */
        if (!isUltra && layerIndex !== '1' && layerIndex !== '3') {
          layer.style.transform = 'none';
          return;
        }

        var speed = speeds[layerIndex] || 30;
        var yVal = isUltra ? speed : speed * 0.65;

        var anim = window.gsap.to(layer, {
          yPercent: yVal,
          ease: 'none',
          scrollTrigger: {
            trigger: hero,
            start: 'top top',
            end: 'bottom top',
            scrub: true,
            invalidateOnRefresh: true
          }
        });

        if (anim && anim.scrollTrigger) {
          scrollTriggers.push(anim.scrollTrigger);
        }
      });

      /* Bölüm Geçiş Reveal Efektleri (Ultra & Mid) */
      var sections = document.querySelectorAll('.scrolly-section');
      sections.forEach(function (sec) {
        var anim = window.gsap.fromTo(sec, 
          { opacity: isUltra ? 0.85 : 0.95, y: isUltra ? 30 : 15 },
          {
            opacity: 1,
            y: 0,
            duration: 0.8,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: sec,
              start: 'top 85%',
              toggleActions: 'play none none none'
            }
          }
        );
        if (anim && anim.scrollTrigger) {
          scrollTriggers.push(anim.scrollTrigger);
        }
      });

    } catch (err) {
      console.warn('[parallax] GSAP ScrollTrigger hatası:', err);
    }
  }

  /* -------------------------------------------------------- Yeniden Yapılandır */

  function applyTier(tier) {
    initLenis(tier);
    initParallax(tier);

    /* Sinematik CRT ve RGB Split kontrolü */
    var html = document.documentElement;
    if (tier === 'ultra') {
      html.classList.add('enable-fx-ultra');
      html.classList.remove('enable-fx-mid', 'enable-fx-low');
    } else if (tier === 'mid') {
      html.classList.add('enable-fx-mid');
      html.classList.remove('enable-fx-ultra', 'enable-fx-low');
    } else {
      html.classList.add('enable-fx-low');
      html.classList.remove('enable-fx-ultra', 'enable-fx-mid');
    }
  }

  /* ------------------------------------------------------------- Başlatma */

  function init() {
    if (isInitialized) return;
    isInitialized = true;

    var currentTier = getTier();
    applyTier(currentTier);

    if (window.App.Tier && window.App.Tier.onChange) {
      window.App.Tier.onChange(function (newTier) {
        applyTier(newTier);
      });
    }

    window.addEventListener('pagehide', function () {
      cleanupParallax();
      if (lenisInstance) {
        lenisInstance.destroy();
        lenisInstance = null;
      }
    });

    window.addEventListener('resize', function () {
      if (window.ScrollTrigger) {
        window.ScrollTrigger.refresh();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.App.Parallax = {
    refresh: function () {
      if (window.ScrollTrigger) window.ScrollTrigger.refresh();
    },
    destroy: function () {
      cleanupParallax();
      if (lenisInstance) {
        lenisInstance.destroy();
        lenisInstance = null;
      }
    },
    reinit: function () {
      applyTier(getTier());
    }
  };
})();
