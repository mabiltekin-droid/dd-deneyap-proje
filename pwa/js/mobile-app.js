/* ==========================================================================
   Deneyap Ev Koruma - Mobil uygulama davranışları
   --------------------------------------------------------------------------
   Web sitesi mobil tarayıcıda da çalışır. Bu betik yalnızca uygulama hissini
   güçlendiren küçük dokunuşları ekler:
     - Android WebView köprüsü varsa "Uygulama" menüsü
     - Alt sekmelerde dokunsal geri bildirim
     - Aktif sekmeye tekrar dokununca sayfanın başına dönme
     - Sayfa geçişlerinden sonra alt gezinmeyi güncel tutma
   ========================================================================== */

(function () {
  'use strict';

  var root = document.documentElement;

  function addAppClass() {
    try {
      if (window.AndroidApp && typeof window.AndroidApp.platform === 'function') {
        if (window.AndroidApp.platform() === 'android') root.classList.add('android-app');
      }
    } catch (e) {
      /* Köprü yoksa normal web sitesi davranışı devam eder. */
    }
  }

  function haptic() {
    try {
      if (window.AndroidApp && typeof window.AndroidApp.haptic === 'function') {
        window.AndroidApp.haptic();
        return;
      }
    } catch (e) { /* yoksay */ }
    try {
      if (navigator.vibrate) navigator.vibrate(8);
    } catch (e) { /* yoksay */ }
  }

  function openNativeMenu() {
    haptic();
    try {
      if (window.AndroidApp && typeof window.AndroidApp.openMenu === 'function') {
        window.AndroidApp.openMenu();
      }
    } catch (e) { /* yoksay */ }
  }

  function setBottomActive(link) {
    var nav = document.querySelector('.bottom-nav');
    if (!nav || !link) return;
    var links = nav.querySelectorAll('a');
    for (var i = 0; i < links.length; i++) {
      var on = links[i] === link;
      links[i].classList.toggle('active', on);
      if (on) links[i].setAttribute('aria-current', 'page');
      else links[i].removeAttribute('aria-current');
    }
  }

  function syncFromHash() {
    var hash = window.location.hash;
    if (!hash) return;
    var nav = document.querySelector('.bottom-nav');
    if (!nav) return;
    var link = nav.querySelector('a[href="' + hash + '"]');
    if (link) setBottomActive(link);
  }

  var cockpitLabels = {
    unknown: 'BEKLEMEDE',
    normal: 'CANLI',
    warning: 'DİKKAT',
    danger: 'ALARM',
    offline: 'ÇEVRİMDIŞI'
  };

  function syncCockpit() {
    var widget = document.getElementById('homeWidget');
    var badge = document.getElementById('mobileCockpitLive');
    var label = document.getElementById('mobileCockpitLiveText');
    if (!widget || !badge || !label) return;
    var state = widget.getAttribute('data-state') || 'unknown';
    if (!cockpitLabels[state]) state = 'unknown';
    badge.setAttribute('data-state', state);
    label.textContent = cockpitLabels[state];
  }

  var cockpitObserver = null;

  function watchCockpit() {
    if (cockpitObserver) {
      cockpitObserver.disconnect();
      cockpitObserver = null;
    }
    var widget = document.getElementById('homeWidget');
    if (!widget || typeof MutationObserver === 'undefined') return;
    cockpitObserver = new MutationObserver(syncCockpit);
    cockpitObserver.observe(widget, { attributes: true, attributeFilter: ['data-state'] });
    syncCockpit();
  }

  /* Android tarafında yerel menü düğmesi görünür olur. */
  addAppClass();

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    var menuBtn = target.closest('#mobileNativeMenu');
    if (menuBtn) {
      event.preventDefault();
      openNativeMenu();
      return;
    }

    var modeBtn = target.closest('.mobile-quickbar .mode-btn');
    if (modeBtn) {
      haptic();
      return;
    }

    var navLink = target.closest('.bottom-nav a');
    if (!navLink) return;

    haptic();

    var href = navLink.getAttribute('href') || '';
    if (href.charAt(0) !== '#') return;

    var isActive = navLink.classList.contains('active') ||
      navLink.getAttribute('aria-current') === 'page';

    if (isActive) {
      event.preventDefault();
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (e) {
        window.scrollTo(0, 0);
      }
    }

    setBottomActive(navLink);
  }, true);

  /* Sayfa içi bağlantılarla (veya tarayıcı geri tuşuyla) hash değişirse
     alt sekmeyi güncelle. Scroll sırasında parallax.js zaten güncelliyor. */
  window.addEventListener('hashchange', syncFromHash);
  window.addEventListener('pageshow', function () {
    addAppClass();
    syncFromHash();
    watchCockpit();
  });
  document.addEventListener('deneyap:pagechange', function () {
    addAppClass();
    syncFromHash();
    watchCockpit();
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      addAppClass();
      syncFromHash();
      watchCockpit();
    });
  } else {
    syncFromHash();
    watchCockpit();
  }
})();
