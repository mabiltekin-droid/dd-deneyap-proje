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
      try { lenisInstance.destroy(); } catch (e) {}
      lenisInstance = null;
    }

    if (tickerCallback && window.gsap && window.gsap.ticker) {
      try { window.gsap.ticker.remove(tickerCallback); } catch (e) {}
      tickerCallback = null;
    }

    if (tier === 'low' || isReducedMotion() || typeof window.Lenis === 'undefined') {
      return null;
    }

    try {
      var isUltra = (tier === 'ultra');
      lenisInstance = new window.Lenis({
        duration: isUltra ? 0.9 : 0.65,
        easing: function (t) {
          return Math.min(1, 1.001 - Math.pow(2, -10 * t));
        },
        orientation: 'vertical',
        gestureOrientation: 'vertical',
        smoothWheel: false,
        wheelMultiplier: 1.0,
        touchMultiplier: 1.0
      });

      if (window.ScrollTrigger) {
        lenisInstance.on('scroll', window.ScrollTrigger.update);
      }

      /* RAF Ticker — Her sayfada (index veya settings) KESİNTİSİZ çalışır */
      if (window.gsap && window.gsap.ticker) {
        tickerCallback = function (time) {
          if (lenisInstance) {
            lenisInstance.raf(time * 1000);
          }
        };
        window.gsap.ticker.add(tickerCallback);
        window.gsap.ticker.lagSmoothing(0);
      } else {
        var rafFn = function (time) {
          if (lenisInstance) {
            lenisInstance.raf(time);
            requestAnimationFrame(rafFn);
          }
        };
        requestAnimationFrame(rafFn);
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

    var header = document.querySelector('.glass-header');
    var headerHeight = (header ? header.offsetHeight : 72) + 12;
    var targetPos = target.getBoundingClientRect().top + (window.pageYOffset || window.scrollY || 0) - headerHeight;

    window.scrollTo({
      top: Math.max(0, targetPos),
      behavior: isReducedMotion() ? 'auto' : 'smooth'
    });

    if (lenisInstance && typeof lenisInstance.scrollTo === 'function') {
      try {
        lenisInstance.scrollTo(Math.max(0, targetPos), { immediate: true });
      } catch (e) {}
    }

    if (hash && window.history && window.history.pushState) {
      window.history.pushState(null, '', hash);
    }

    updateActiveNavLink(hash);
  }

  function updateActiveNavLink(targetId) {
    if (!targetId) return;
    var id = targetId.replace(/^#/, '');
    var navLinks = document.querySelectorAll('.header-nav .nav-item, .settings-header-nav .nav-item, .settings-nav-tabs .studio-tab');
    navLinks.forEach(function (link) {
      var href = link.getAttribute('href') || '';
      if (href === '#' + id || (id === '' && (href === '#hero' || href === '#accountCard'))) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    document.querySelectorAll('.header-nav, .settings-header-nav, .settings-nav-tabs').forEach(function (nav) {
      if (typeof nav._syncBubble === 'function') {
        nav._syncBubble(true);
      }
    });
  }

  /* ------------------------------- Yaylanmalı Sıvı Baloncuk Motoru (Liquid Spring Bubble) */

  function setupLiquidBubbleNav() {
    var navContainers = document.querySelectorAll('.header-nav, .settings-header-nav, .settings-nav-tabs');
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
          duration: 0.55,
          ease: 'elastic.out(1, 0.75)',
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
          try {
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
          } catch (e) {}
        });
      });

      nav.addEventListener('mouseleave', function () {
        syncToActive(true);
      });

      nav.addEventListener('scroll', function () {
        syncToActive(false);
      }, { passive: true });

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
      if (e.button && e.button !== 0) return; // Orta tuş (button 1) veya sağ tuş için varsayılan tarayıcı davranışı korunsun
      var link = e.target.closest('a[href*="#"], [data-scroll-to]');
      if (!link) return;

      var rawHref = link.getAttribute('href') || link.getAttribute('data-scroll-to') || '';
      var hashIdx = rawHref.indexOf('#');
      if (hashIdx === -1) return;

      var hash = rawHref.substring(hashIdx);
      if (hash === '#' || hash.length < 2) return;

      var pathname = rawHref.substring(0, hashIdx);
      var currentPath = (window.location.pathname.replace(/^.*\//, '') || 'index.html').toLowerCase();
      var targetPath = pathname.replace(/^.*\//, '').replace(/^\.\//, '').toLowerCase();

      // Eğer bağlantı başka sayfaya aitse SPA geçiş motoru ele alsın
      if (targetPath && targetPath !== currentPath) return;

      var targetEl = document.querySelector(hash);
      if (!targetEl) return;

      e.preventDefault();

      if (window.App && window.App.sound && window.App.sound.click) {
        window.App.sound.click();
      }
      if (window.App && window.App.haptic) {
        window.App.haptic(20);
      }

      scrollToElement(targetEl, hash);
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

    var sections = document.querySelectorAll('.scrolly-section, .config-panel');
    sections.forEach(function (sec) {
      sec.style.transform = '';
      sec.style.opacity = '';
    });
  }

  function initParallax(tier) {
    cleanupParallax();

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

      var isUltra = (tier === 'ultra');
      var hero = document.getElementById('hero');

      /* 1. SİNEMATİK 4-KATMANLI HERO PARALLAX KOREOGRAFİSİ (Varsa) */
      if (hero) {
        var layer1 = hero.querySelector('[data-parallax-layer="1"]');
        var layer2 = hero.querySelector('[data-parallax-layer="2"]');
        var layer3 = hero.querySelector('[data-parallax-layer="3"]');
        var layer4 = hero.querySelector('[data-parallax-layer="4"]');

        /* Katman 1: Siber Izgara ve Derin Ufuk */
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

        /* Katman 2: Atmosferik Partikül / Nebula */
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

        /* Katman 3: Ana Tipografi & HUD Başlık Metinleri */
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

        /* Katman 4: Ön Plan Şematik Silüet */
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
      }

      /* 2. BÖLÜM VE KONFİGÜRASYON PANELLERİ İÇİN GİRİŞ ANİMASYONLARI */
      var sections = document.querySelectorAll('.scrolly-section, .config-panel');
      sections.forEach(function (sec) {
        var header = sec.querySelector('.section-badge-header, .panel-header');
        if (header) {
          var hAnim = window.gsap.fromTo(header,
            { opacity: 0, y: isUltra ? 30 : 16 },
            {
              opacity: 1,
              y: 0,
              duration: isUltra ? 0.85 : 0.6,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: sec,
                start: 'top 88%',
                toggleActions: 'play none none none'
              }
            }
          );
          if (hAnim && hAnim.scrollTrigger) scrollTriggers.push(hAnim.scrollTrigger);
        }

        var cards = sec.querySelectorAll('.card');
        if (cards.length) {
          var cAnim = window.gsap.fromTo(cards,
            { opacity: 0, y: isUltra ? 45 : 22 },
            {
              opacity: 1,
              y: 0,
              duration: isUltra ? 0.95 : 0.7,
              stagger: 0.12,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: sec,
                start: 'top 78%',
                toggleActions: 'play none none none'
              }
            }
          );
          if (cAnim && cAnim.scrollTrigger) scrollTriggers.push(cAnim.scrollTrigger);
        }
      });

      /* 3. SCROLLSPY (Aktif Navigasyon Bölüm Takibi — Hem Index Hem Settings) */
      var spyTargets = [
        'hero', 'telemetry', 'command-center', 'analytics', 'diagnostics',
        'accountCard', 'connSection', 'thresholdSection', 'telegramSection', 'themeSection', 'backupSection'
      ];
      spyTargets.forEach(function (secId) {
        var el = document.getElementById(secId);
        if (!el) return;

        var st = window.ScrollTrigger.create({
          trigger: el,
          start: 'top 40%',
          end: 'bottom 40%',
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

  /* ------------------------------- Anlık Sayfalar Arası Geçiş Motoru (Instant SPA View Switcher) */
  var pageCache = {};

  function preloadPage(url) {
    if (!url) return Promise.resolve(null);
    var cleanUrl = url.split('#')[0].split('?')[0];
    if (pageCache[cleanUrl]) return Promise.resolve(pageCache[cleanUrl]);
    return fetch(cleanUrl)
      .then(function (res) { return res.text(); })
      .then(function (html) {
        pageCache[cleanUrl] = html;
        return html;
      })
      .catch(function () { return null; });
  }

  function switchToPage(targetUrl) {
    var cleanTarget = targetUrl.split('#')[0].split('?')[0];
    var hash = targetUrl.indexOf('#') !== -1 ? targetUrl.substring(targetUrl.indexOf('#')) : '';

    var currentClean = (window.location.pathname.replace(/^.*\//, '') || 'index.html').toLowerCase();
    var targetFile = (cleanTarget.replace(/^.*\//, '').replace(/^\.\//, '') || 'index.html').toLowerCase();

    if (currentClean === targetFile) {
      if (hash) {
        var el = document.querySelector(hash);
        if (el) scrollToElement(el, hash);
      }
      return Promise.resolve();
    }

    return preloadPage(targetFile).then(function (html) {
      if (!html) {
        window.location.href = targetUrl;
        return;
      }

      var parser = new DOMParser();
      var doc = parser.parseFromString(html, 'text/html');

      var newMain = doc.querySelector('main');
      var oldMain = document.querySelector('main');
      if (!newMain || !oldMain) {
        window.location.href = targetUrl;
        return;
      }

      document.title = doc.title || document.title;

      oldMain.className = newMain.className;
      oldMain.id = newMain.id;
      oldMain.innerHTML = newMain.innerHTML;

      var newNav = doc.querySelector('.header-nav');
      var oldNav = document.querySelector('.header-nav');
      if (newNav && oldNav) {
        oldNav.className = newNav.className;
        oldNav.innerHTML = newNav.innerHTML;
      }

      var newActions = doc.querySelector('.header-actions');
      var oldActions = document.querySelector('.header-actions');
      if (newActions && oldActions) {
        var newBack = newActions.querySelector('.nav-back-pill');
        var oldBack = oldActions.querySelector('.nav-back-pill');
        if (newBack && oldBack) {
          oldBack.replaceWith(newBack);
        } else if (newBack && !oldBack) {
          oldActions.prepend(newBack);
        } else if (!newBack && oldBack) {
          oldBack.remove();
        }
        var newAcct = newActions.querySelector('#accountBtn');
        var oldAcct = oldActions.querySelector('#accountBtn');
        if (newAcct && !oldAcct) {
          oldActions.insertBefore(newAcct, oldActions.firstChild);
        } else if (!newAcct && oldAcct) {
          oldAcct.remove();
        }
      }

      var newBottom = doc.querySelector('.bottom-nav');
      var oldBottom = document.querySelector('.bottom-nav');
      if (newBottom && oldBottom) {
        oldBottom.innerHTML = newBottom.innerHTML;
      }

      if (window.history && window.history.pushState) {
        window.history.pushState(null, '', targetUrl);
      }

      if (targetFile.indexOf('settings') !== -1) {
        if (window.App && typeof window.App.initSettings === 'function') {
          window.App.initSettings();
        }
      } else {
        if (window.App && typeof window.App.initDashboard === 'function') {
          window.App.initDashboard();
        }
      }

      if (window.App && window.App.Parallax) {
        window.App.Parallax.reinit();
      }
      setupLiquidBubbleNav();
      setupInstantPageTransitions();

      if (hash) {
        requestAnimationFrame(function () {
          var targetEl = document.querySelector(hash);
          if (targetEl) {
            scrollToElement(targetEl, hash);
          } else {
            window.scrollTo({ top: 0, behavior: 'instant' });
          }
        });
      } else {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }

      if (window.App && window.App.sound && window.App.sound.click) {
        window.App.sound.click();
      }
      if (window.App && window.App.haptic) {
        window.App.haptic(25);
      }
    });
  }

  function setupInstantPageTransitions() {
    var currentFile = (window.location.pathname.replace(/^.*\//, '') || 'index.html').toLowerCase();
    if (currentFile.indexOf('settings') !== -1) {
      preloadPage('./index.html');
      preloadPage('index.html');
    } else {
      preloadPage('./settings.html');
      preloadPage('settings.html');
    }

    document.querySelectorAll('a[href*="index.html"], a[href*="settings.html"], .bottom-nav a, .nav-back-pill, .acct-pill').forEach(function (el) {
      var href = el.getAttribute('href');
      if (!href && el.getAttribute('onclick')) {
        var m = el.getAttribute('onclick').match(/location\.href=['"]([^'"]+)['"]/);
        if (m) {
          href = m[1];
          el.removeAttribute('onclick');
          el.setAttribute('data-target-url', href);
        }
      }
      if (!href && el.getAttribute('data-target-url')) {
        href = el.getAttribute('data-target-url');
      }
      if (!href) return;

      el.addEventListener('pointerenter', function () { preloadPage(href); }, { passive: true });
      el.addEventListener('pointerdown', function () { preloadPage(href); }, { passive: true });

      el.addEventListener('click', function (e) {
        if (e.button && e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        switchToPage(href);
      });
    });
  }

  window.addEventListener('popstate', function () {
    switchToPage(window.location.href);
  });

  /* ------------------------------------------------------------- Başlatma */

  function init() {
    if (isInitialized) return;
    isInitialized = true;

    setupSmoothAnchorNavigation();
    setupLiquidBubbleNav();
    setupInstantPageTransitions();

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
