/* ==========================================================================
   Deneyap Ev Koruma - Mobil uygulama davranışları
   --------------------------------------------------------------------------
   Web sitesi mobil tarayıcıda da çalışır. Bu betik yalnızca uygulama hissini
   güçlendiren küçük dokunuşları ekler:
     - Android WebView köprüsü varsa "Uygulama" menüsü
     - Alt sekmelerde dokunsal geri bildirim
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
  }, true);

  window.addEventListener('pageshow', addAppClass);
})();
