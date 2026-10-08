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
  var lenisRafId = null;
  var isProgrammaticScroll = false;
  var programmaticScrollTimer = null;
  var isInitialized = false;

  function isReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function getTier() {
    if (isReducedMotion()) return 'low';
    return (window.App.Tier && window.App.Tier.get()) || 'mid';
  }

  /* ------------------------------------------------------------- Lenis Motoru */

  function startLenisLoop() {
    stopLenisLoop();
    function loop(time) {
      if (lenisInstance) {
        try {
          lenisInstance.raf(time);
        } catch (e) {}
        lenisRafId = requestAnimationFrame(loop);
      }
    }
    lenisRafId = requestAnimationFrame(loop);
  }

  function stopLenisLoop() {
    if (lenisRafId) {
      cancelAnimationFrame(lenisRafId);
      lenisRafId = null;
    }
  }

  function destroyLenis() {
    stopLenisLoop();
    if (lenisInstance) {
      try { lenisInstance.destroy(); } catch (e) {}
      lenisInstance = null;
    }
  }

  function initLenis(tier) {
    destroyLenis();

    if (tier === 'low' || isReducedMotion() || typeof window.Lenis === 'undefined') {
      return null;
    }

    try {
      var isUltra = (tier === 'ultra');
      lenisInstance = new window.Lenis({
        duration: isUltra ? 1.0 : 0.85,
        easing: function (t) {
          return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
        },
        orientation: 'vertical',
        gestureOrientation: 'vertical',
        smoothWheel: true,
        wheelMultiplier: 1.0,
        touchMultiplier: 1.0
      });

      if (window.ScrollTrigger) {
        lenisInstance.on('scroll', window.ScrollTrigger.update);
      }

      /* Lenis bağımsız ve kesintisiz rAF döngüsü ile çalışır */
      startLenisLoop();

      return lenisInstance;
    } catch (e) {
      console.warn('[parallax] Lenis başlatılamadı, doğal kaydırmaya dönülüyor:', e);
      return null;
    }
  }

  /* ------------------------------------------- Buton & Bağlantı ScrollTo Motoru */

  function smoothScrollTo(targetPos, duration, onComplete) {
    if (typeof targetPos !== 'number' || isNaN(targetPos)) {
      targetPos = 0;
    }
    targetPos = Math.max(0, Math.round(targetPos));

    if (isReducedMotion()) {
      window.scrollTo(0, targetPos);
      if (lenisInstance && typeof lenisInstance.scrollTo === 'function') {
        try { lenisInstance.scrollTo(targetPos, { immediate: true }); } catch (e) {}
      }
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    var dur = typeof duration === 'number' ? duration : 0.95;

    if (lenisInstance && typeof lenisInstance.scrollTo === 'function') {
      try {
        var completed = false;
        var done = function () {
          if (completed) return;
          completed = true;
          if (typeof onComplete === 'function') onComplete();
        };

        lenisInstance.scrollTo(targetPos, {
          duration: dur,
          easing: function (t) {
            return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
          },
          immediate: false,
          onComplete: done
        });

        // Güvenlik zaman aşımı (Lenis nadir durumlarda tamamlanamazsa garanti fallback)
        setTimeout(function () {
          if (!completed) {
            var curr = window.pageYOffset || window.scrollY || document.documentElement.scrollTop || 0;
            if (Math.abs(curr - targetPos) > 30) {
              fallbackRafScroll(targetPos, 0.35, done);
            } else {
              done();
            }
          }
        }, (dur * 1000) + 120);

        return;
      } catch (e) {
        console.warn('[parallax] Lenis scrollTo hatası, dahili RAF kaydırma devreye giriyor:', e);
      }
    }

    fallbackRafScroll(targetPos, dur, onComplete);
  }

  function fallbackRafScroll(targetPos, duration, onComplete) {
    var start = window.pageYOffset || window.scrollY || document.documentElement.scrollTop || 0;
    var change = targetPos - start;
    if (Math.abs(change) < 2) {
      window.scrollTo(0, targetPos);
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    var durMs = (duration || 0.85) * 1000;
    var startTime = null;

    function anim(currentTime) {
      if (!startTime) startTime = currentTime;
      var elapsed = currentTime - startTime;
      var progress = Math.min(1, elapsed / durMs);
      var ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      window.scrollTo(0, Math.round(start + change * ease));
      if (progress < 1) {
        requestAnimationFrame(anim);
      } else {
        window.scrollTo(0, targetPos);
        if (typeof onComplete === 'function') onComplete();
      }
    }
    requestAnimationFrame(anim);
  }

  function scrollToElement(target, hash, options) {
    if (!target) return;
    options = options || {};

    var header = document.querySelector('.glass-header');
    var headerHeight = (header ? header.offsetHeight : 72) + 16;
    var targetPos = 0;

    if (target !== document.body && target.id !== 'hero') {
      var rect = target.getBoundingClientRect();
      var currentScroll = window.pageYOffset || window.scrollY || document.documentElement.scrollTop || 0;
      targetPos = Math.max(0, Math.round(rect.top + currentScroll - headerHeight));
    }

    if (hash && window.history && window.history.pushState) {
      try {
        window.history.pushState(null, '', hash);
      } catch (e) {}
    }

    isProgrammaticScroll = true;
    clearTimeout(programmaticScrollTimer);
    updateActiveNavLink(hash);

    var dur = options.duration || 0.95;
    smoothScrollTo(targetPos, dur, function () {
      isProgrammaticScroll = false;
      updateActiveNavLink(hash);
      if (typeof options.onComplete === 'function') options.onComplete();
    });

    programmaticScrollTimer = setTimeout(function () {
      isProgrammaticScroll = false;
    }, (dur * 1000) + 150);
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
          duration: 0.5,
          ease: 'elastic.out(1, 0.75)',
          overwrite: 'auto'
        });
      }

      function syncToActive(animate) {
        var active = nav.querySelector('.active') || items[0];
        moveBubbleTo(active, animate);
      }

      items.forEach(function (item) {
        if (item._bubbleBound) return;
        item._bubbleBound = true;

        item.addEventListener('mouseenter', function () {
          moveBubbleTo(item, true);
        });
        item.addEventListener('click', function () {
          items.forEach(function (i) { i.classList.remove('active'); });
          item.classList.add('active');
          moveBubbleTo(item, true);

          // Yatay çubuk taşması varsa (mobil ekranlar), yalnızca nav içi yatay kaydır
          // ASLA item.scrollIntoView çağrılmaz (sayfa dikey kaydırmasını bozmaz)!
          if (nav.scrollWidth > nav.clientWidth) {
            var centerOffset = item.offsetLeft - (nav.clientWidth / 2) + (item.clientWidth / 2);
            nav.scrollTo({ left: Math.max(0, centerOffset), behavior: 'smooth' });
          }
        });
      });

      if (!nav._bubbleEventsBound) {
        nav._bubbleEventsBound = true;
        nav.addEventListener('mouseleave', function () {
          syncToActive(true);
        });

        nav.addEventListener('scroll', function () {
          syncToActive(false);
        }, { passive: true });

        window.addEventListener('resize', function () {
          syncToActive(false);
        });
      }

      requestAnimationFrame(function () {
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
          onEnter: function () {
            if (!isProgrammaticScroll) updateActiveNavLink('#' + secId);
          },
          onEnterBack: function () {
            if (!isProgrammaticScroll) updateActiveNavLink('#' + secId);
          }
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
        if (el) scrollToElement(el, hash, { duration: 1.15 });
      } else {
        smoothScrollTo(0, 0.85);
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

      /* Temizle: Eski DOM'da main dışında kalmış olabilecek fazlalıklar */
      var strayHero = document.querySelector('body > #hero, body > .hero-section');
      if (strayHero) strayHero.remove();
      var strayFooter = document.querySelector('body > .scada-footer');
      if (strayFooter) strayFooter.remove();

      document.title = doc.title || document.title;
      document.body.className = doc.body.className;

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
        if (newAcct && oldAcct) {
          oldAcct.replaceWith(newAcct);
        } else if (newAcct && !oldAcct) {
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
        if (window.App && typeof window.App.destroyDashboard === 'function') {
          window.App.destroyDashboard();
        }
        if (window.App && typeof window.App.initSettings === 'function') {
          window.App.initSettings();
        }
        if (window.App && typeof window.App.initAccount === 'function') {
          window.App.initAccount();
        }
      } else {
        if (window.App && typeof window.App.destroySettings === 'function') {
          window.App.destroySettings();
        }
        if (window.App && typeof window.App.initDashboard === 'function') {
          window.App.initDashboard();
        }
        if (window.App && typeof window.App.initHistory === 'function') {
          window.App.initHistory();
        }
      }

      if (window.App && window.App.Parallax) {
        window.App.Parallax.reinit();
      }
      setupLiquidBubbleNav();
      setupInstantPageTransitions();
      if (window.App && window.App.init3DTilt) window.App.init3DTilt();
      if (window.App && window.App.initRipple) window.App.initRipple();

      if (hash) {
        setTimeout(function () {
          var targetEl = document.querySelector(hash);
          if (targetEl) {
            scrollToElement(targetEl, hash, { duration: 1.0 });
          } else {
            smoothScrollTo(0, 0.7);
          }
        }, 120);
      } else {
        smoothScrollTo(0, 0.7);
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

    if (window.location.hash) {
      setTimeout(function () {
        var initEl = document.querySelector(window.location.hash);
        if (initEl) scrollToElement(initEl, window.location.hash, { duration: 1.1 });
      }, 300);
    }

    window.addEventListener('pagehide', function () {
      cleanupParallax();
      destroyLenis();
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
      destroyLenis();
    },
    reinit: function () {
      applyTier(getTier());
    },
    scrollTo: scrollToElement,
    smoothScrollTo: smoothScrollTo,
    getLenis: function () { return lenisInstance; }
  };

  window.App.scrollTo = scrollToElement;
  window.App.smoothScrollTo = smoothScrollTo;
})();
