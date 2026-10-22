/* ==========================================================================
   theme-boot.js — ilk boyamadan ÖNCE temayı uygular (FOUC önleme).

   <head> içinde, senkron olarak yüklenir. Neden ayrı dosya?
   Satır içi <script> kullanılırsa Content-Security-Policy'nin
   script-src 'unsafe-inline' içermesi gerekir; bu da XSS korumasını
   büyük ölçüde zayıflatır (bkz. vercel.json). Bu dosya aynı işi yapar,
   CSP ise sıkı kalır: script-src 'self' + iki CDN.
   ========================================================================== */

(function () {
  'use strict';
  try {
    var s = JSON.parse(localStorage.getItem('deneyap.settings.v2') || '{}');
    var t = s.theme || 'dark';
    var dark = t === 'dark' || t === 'amoled' ||
               (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var resolved = (t === 'system') ? (dark ? 'dark' : 'light') : t;
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-color-scheme', dark ? 'dark' : 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
