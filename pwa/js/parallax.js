/* ==========================================================================
   parallax.js — GSAP + Lenis Katmanlı Parallax & Donanım Profili Yöneticisi
   - Sinematik 4 Katmanlı Hero Parallax Sahnesi (Derinlik, Açı, Ölçek & Odak)
   - Buton & Navigasyon Bağlantılarında Akıcı İnertia ScrollTo Entegrasyonu
   - Bölümler Arası Derinlik & ScrollSpy Aktif Navigasyon Senkronizasyonu
   - Donanım Kademelerine Duyarlı Adaptasyon (ultra | mid | low)
   - Sinematik CRT / RGB Kromatik Sapma Tehdit Efektleri
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
        duration: isUltra ? 1.4 : 0.85,
        easing: function (t) {
          return Math.min(1, 1.001 - Math.pow(2, -10 * t));
        },
        orientation: 'vertical',
        gestureOrientation: 'vertical',
        smoothWheel: true,
        wheelMultiplier: isUltra ? 1.05 : 0.9,
        touchMultiplier: 1.25
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

  /* ------------------------------------------- Buton & Bağlantı ScrollTo Motoru */

  function scrollToElement(target, hash) {
    if (!target) return;

    var headerHeight = 70;
    var isUltra = getTier() === 'ultra';
    var duration = isUltra ? 1.5 : 1.1;

    if (lenisInstance && getTier() !== 'low' && !isReducedMotion()) {
      lenisInstance.scrollTo(target, {
        offset: -headerHeight,
        duration: duration,
        easing: function (t) {
          return Math.min(1, 1.001 - Math.pow(2, -10 * t));
        }
      });
    } else {
      var targetPos = target.getBoundingClientRect().top + (window.pageYOffset || window.scrollY || 0) - headerHeight;
      window.scrollTo({
        top: Math.max(0, targetPos),
        behavior: isReducedMotion() ? 'auto' : 'smooth'
      });
    }

    if (hash && window.history && window.history.pushState) {
      window.history.pushState(null, '', hash);
    }

    updateActiveNavLink(hash);
  }

  function updateActiveNavLink(targetId) {
    if (!targetId) return;
    var id = targetId.replace(/^#/, '');
    var navLinks = document.querySelectorAll('.header-nav .nav-item, .settings-nav-tabs .studio-tab');
    navLinks.forEach(function (link) {
      var href = link.getAttribute('href') || '';
      if (href === '#' + id || (id === '' && href === '#hero')) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    document.querySelectorAll('.header-nav, .settings-nav-tabs').forEach(function (nav) {
      if (typeof nav._syncBubble === 'function') {
        nav._syncBubble(true);
      }
    });
  }

  /* ------------------------------- Yaylanmalı Sıvı Baloncuk Motoru (Liquid Spring Bubble) */

  function setupLiquidBubbleNav() {
    var navContainers = document.querySelectorAll('.header-nav, .settings-nav-tabs');
    navContainers.forEach(function (nav) {
      var bubble = nav.querySelector('.nav-liquid-bubble, .tab-liquid-bubble');
      if (!bubble) return;

      var items = nav.querySelectorAll('.nav-item, .studio-tab');
      if (!items.length) return;

      function moveBubbleTo(target, animate) {
        if (!target) return;
        var navRect = nav.getBoundingClientRect();
        var targetRect = target.getBoundingClientRect();

        var left = targetRect.left - navRect.left + nav.scrollLeft;
        var top = targetRect.top - navRect.top + nav.scrollTop;
        var width = targetRect.width;
        var height = targetRect.height;

        if (!animate || typeof window.gsap === 'undefined' || getTier() === 'low') {
          bubble.style.transform = 'translate3d(' + left + 'px, ' + top + 'px, 0)';
          bubble.style.width = width + 'px';
          bubble.style.height = height + 'px';
          bubble.style.opacity = '1';
          return;
        }

        bubble.style.opacity = '1';
        window.gsap.to(bubble, {
          x: left,
          y: top,
          width: width,
          height: height,
          duration: 0.65,
          ease: 'elastic.out(1, 0.72)',
          overwrite: 'auto'
        });
      }

      function syncToActive(animate) {
        var active = nav.querySelector('.active') || items[0];
        moveBubbleTo(active, animate);
      }

      items.forEach(function (item) {
        item.addEventListener('mouseenter', function () {
          moveBubbleTo(item, true);
        });
        item.addEventListener('click', function () {
          items.forEach(function (i) { i.classList.remove('active'); });
          item.classList.add('active');
          moveBubbleTo(item, true);
        });
      });

      nav.addEventListener('mouseleave', function () {
        syncToActive(true);
      });

      requestAnimationFrame(function () {
        syncToActive(false);
      });

      window.addEventListener('resize', function () {
        syncToActive(false);
      });

      nav._syncBubble = syncToActive;
    });
  }

  function setupSmoothAnchorNavigation() {
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href^="#"], [data-scroll-to]');
      if (!link) return;

      var href = link.getAttribute('href') || link.getAttribute('data-scroll-to');
      if (!href || href === '#' || href.indexOf('#') !== 0) return;

      var targetEl = document.querySelector(href);
      if (!targetEl) return;

      e.preventDefault();

      if (window.App.sound && window.App.sound.click) {
        window.App.sound.click();
      }
      if (window.App.haptic) {
        window.App.haptic(20);
      }

      scrollToElement(targetEl, href);
    });
  }

  /* --------------------------------- Sinematik GSAP ScrollTrigger & Parallax */

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
        layer.style.opacity = '';
        layer.style.filter = '';
      });
    }

    var sections = document.querySelectorAll('.scrolly-section');
    sections.forEach(function (sec) {
      sec.style.transform = '';
      sec.style.opacity = '';
    });
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

      var isUltra = (tier === 'ultra');

      /* 1. SİNEMATİK 4-KATMANLI HERO PARALLAX KOREOGRAFİSİ */
      var layer1 = hero.querySelector('[data-parallax-layer="1"]');
      var layer2 = hero.querySelector('[data-parallax-layer="2"]');
      var layer3 = hero.querySelector('[data-parallax-layer="3"]');
      var layer4 = hero.querySelector('[data-parallax-layer="4"]');

      /* Katman 1: Siber Izgara ve Derin Ufuk (Açı, ölçek ve derin iniş) */
      if (layer1) {
        var tl1 = window.gsap.to(layer1, {
          yPercent: isUltra ? 80 : 50,
          scale: isUltra ? 1.18 : 1.05,
          opacity: isUltra ? 0.25 : 0.5,
          ease: 'none',
          scrollTrigger: {
            trigger: hero,
            start: 'top top',
            end: 'bottom top',
            scrub: isUltra ? 1.2 : 0.8,
            invalidateOnRefresh: true
          }
        });
        if (tl1 && tl1.scrollTrigger) scrollTriggers.push(tl1.scrollTrigger);
      }

      /* Katman 2: Atmosferik Partikül / Nebula (Yanal kayma, rotasyon ve genişleme) */
      if (layer2) {
        if (isUltra) {
          var tl2 = window.gsap.to(layer2, {
            yPercent: 60,
            xPercent: -8,
            rotation: 12,
            scale: 1.25,
            opacity: 0.15,
            ease: 'none',
            scrollTrigger: {
              trigger: hero,
              start: 'top top',
              end: 'bottom top',
              scrub: 1.5,
              invalidateOnRefresh: true
            }
          });
          if (tl2 && tl2.scrollTrigger) scrollTriggers.push(tl2.scrollTrigger);
        } else {
          layer2.style.transform = 'none';
        }
      }

      /* Katman 3: Ana Tipografi & HUD Başlık Metinleri (Sinematik sönme & derinlik odağı) */
      if (layer3) {
        var tl3 = window.gsap.to(layer3, {
          yPercent: isUltra ? 45 : 30,
          scale: isUltra ? 0.92 : 0.96,
          opacity: 0,
          filter: isUltra ? 'blur(6px)' : 'none',
          ease: 'power1.out',
          scrollTrigger: {
            trigger: hero,
            start: 'top top',
            end: '65% top',
            scrub: isUltra ? 1.0 : 0.6,
            invalidateOnRefresh: true
          }
        });
        if (tl3 && tl3.scrollTrigger) scrollTriggers.push(tl3.scrollTrigger);
      }

      /* Katman 4: Ön Plan Şematik Silüet (Ağır mimari çerçeve) */
      if (layer4) {
        if (isUltra) {
          var tl4 = window.gsap.to(layer4, {
            yPercent: 12,
            scale: 1.06,
            opacity: 0.4,
            ease: 'none',
            scrollTrigger: {
              trigger: hero,
              start: 'top top',
              end: 'bottom top',
              scrub: 1.8,
              invalidateOnRefresh: true
            }
          });
          if (tl4 && tl4.scrollTrigger) scrollTriggers.push(tl4.scrollTrigger);
        } else {
          layer4.style.transform = 'none';
        }
      }

      /* 2. BÖLÜM GEÇİŞLERİ & DERİNLİK AÇILMA EFEKTLERİ */
      var sections = document.querySelectorAll('.scrolly-section');
      sections.forEach(function (sec) {
        var header = sec.querySelector('.section-badge-header');
        if (header) {
          var hAnim = window.gsap.fromTo(header,
            { opacity: 0, y: isUltra ? 40 : 20 },
            {
              opacity: 1,
              y: 0,
              duration: isUltra ? 1.0 : 0.7,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: sec,
                start: 'top 85%',
                toggleActions: 'play none none none'
              }
            }
          );
          if (hAnim && hAnim.scrollTrigger) scrollTriggers.push(hAnim.scrollTrigger);
        }

        var cards = sec.querySelectorAll('.card');
        if (cards.length) {
          var cAnim = window.gsap.fromTo(cards,
            { opacity: 0, y: isUltra ? 50 : 25 },
            {
              opacity: 1,
              y: 0,
              duration: isUltra ? 1.1 : 0.75,
              stagger: 0.15,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: sec,
                start: 'top 75%',
                toggleActions: 'play none none none'
              }
            }
          );
          if (cAnim && cAnim.scrollTrigger) scrollTriggers.push(cAnim.scrollTrigger);
        }
      });

      /* 3. SCROLLSPY (Aktif Navigasyon Bölüm Takibi) */
      var spyTargets = ['hero', 'telemetry', 'command-center', 'analytics', 'diagnostics'];
      spyTargets.forEach(function (secId) {
        var el = document.getElementById(secId);
        if (!el) return;

        var st = window.ScrollTrigger.create({
          trigger: el,
          start: 'top 45%',
          end: 'bottom 45%',
          onEnter: function () { updateActiveNavLink('#' + secId); },
          onEnterBack: function () { updateActiveNavLink('#' + secId); }
        });
        scrollTriggers.push(st);
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

    setupSmoothAnchorNavigation();
    setupLiquidBubbleNav();

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
    },
    scrollTo: scrollToElement,
    getLenis: function () { return lenisInstance; }
  };

  window.App.scrollTo = scrollToElement;
})();
