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
  var moreDialog = null;

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

  /* ------------------------------------------------ Mobil "Diğer" menüsü */

  function pageKind() {
    var p = (window.location.pathname || '').toLowerCase();
    if (p.indexOf('earthquake') !== -1 || document.body.classList.contains('quake-body')) return 'earthquake';
    if (p.indexOf('settings') !== -1 || document.body.classList.contains('settings-studio-body')) return 'settings';
    if (p.indexOf('events') !== -1 || document.body.classList.contains('events-body')) return 'events';
    return 'index';
  }

  function buildMoreDialog() {
    if (moreDialog && document.body.contains(moreDialog)) return moreDialog;
    if (!document.querySelector('.bottom-nav')) return null;

    var existing = document.getElementById('mobileMoreDialog');
    if (existing) {
      moreDialog = existing;
      return existing;
    }

    var kind = pageKind();
    var isIndex = kind === 'index';
    var prefix = isIndex ? '' : './';

    var dlg = document.createElement('dialog');
    dlg.id = 'mobileMoreDialog';
    dlg.className = 'mobile-more-dialog';
    dlg.setAttribute('aria-labelledby', 'mobileMoreTitle');

    dlg.innerHTML =
      '<div class="mmd-sheet">' +
        '<div class="mmd-head">' +
          '<h2 id="mobileMoreTitle">Diğer bölümler</h2>' +
          '<button type="button" class="mmd-close" aria-label="Menüyü kapat">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
              '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
            '</svg>' +
          '</button>' +
        '</div>' +
        '<nav class="mmd-grid" aria-label="Ek bölümler">' +
          '<a class="mmd-item" href="' + prefix + '#analytics" data-mmd-view="analytics">' +
            '<span class="mmd-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18M7 15l4-4 3 3 5-6"/></svg></span>' +
            '<span class="mmd-txt"><strong>Geçmiş</strong><small>24 saatlik sensör eğrileri</small></span>' +
          '</a>' +
          '<a class="mmd-item" href="' + prefix + '#diagnostics" data-mmd-view="diagnostics">' +
            '<span class="mmd-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M9 2v2M20 15h2M20 9h2M9 20v2M15 20v2M2 9h2M2 15h2"/></svg></span>' +
            '<span class="mmd-txt"><strong>Sistem</strong><small>Bağlantı, bellek ve kart durumu</small></span>' +
          '</a>' +
          '<a class="mmd-item' + (kind === 'earthquake' ? ' active' : '') + '" href="./earthquake.html"' + (kind === 'earthquake' ? ' aria-current="page"' : '') + '>' +
            '<span class="mmd-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2.2"/><path d="M8.5 8.5a5 5 0 0 0 0 7"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M5.2 5.2a9.6 9.6 0 0 0 0 13.6"/><path d="M18.8 5.2a9.6 9.6 0 0 1 0 13.6"/></svg></span>' +
            '<span class="mmd-txt"><strong>Deprem</strong><small>EMSC canlı sismik akış</small></span>' +
          '</a>' +
          '<a class="mmd-item' + (kind === 'settings' ? ' active' : '') + '" href="./settings.html"' + (kind === 'settings' ? ' aria-current="page"' : '') + '>' +
            '<span class="mmd-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></span>' +
            '<span class="mmd-txt"><strong>Ayarlar</strong><small>Cihaz, eşikler ve bildirimler</small></span>' +
          '</a>' +
          '<a class="mmd-item" href="./settings.html#accountCard">' +
            '<span class="mmd-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>' +
            '<span class="mmd-txt"><strong>Hesap ve roller</strong><small>Oturum ve aile erişimi</small></span>' +
          '</a>' +
          (isIndex
            ? '<button type="button" class="mmd-item" id="mobileMoreVoiceBtn">' +
                '<span class="mmd-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><line x1="12" y1="19" x2="12" y2="22"/></svg></span>' +
                '<span class="mmd-txt"><strong>Sesli komut</strong><small>Mikrofonla kontrol et</small></span>' +
              '</button>'
            : '<a class="mmd-item" href="./#hero">' +
                '<span class="mmd-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></svg></span>' +
                '<span class="mmd-txt"><strong>Panel</strong><small>Canlı özet ve sensörler</small></span>' +
              '</a>') +
        '</nav>' +
        '<div class="mmd-foot">' +
          '<button type="button" class="btn sm ghost" id="mobileMoreInstallBtn">Uygulamayı indir</button>' +
          '<a class="btn sm ghost" href="./privacy.html">Gizlilik</a>' +
        '</div>' +
      '</div>';

    document.body.appendChild(dlg);
    moreDialog = dlg;

    var closeBtn = dlg.querySelector('.mmd-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        if (dlg.open) dlg.close();
      });
    }

    dlg.addEventListener('click', function (e) {
      if (e.target === dlg) {
        dlg.close();
        return;
      }
      var link = e.target && e.target.closest ? e.target.closest('a') : null;
      if (link) {
        haptic();
        if (dlg.open) dlg.close();
      }
    });

    dlg.addEventListener('close', function () {
      var btn = document.getElementById('mobileMoreBtn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });

    var voiceAction = document.getElementById('mobileMoreVoiceBtn');
    if (voiceAction) {
      voiceAction.addEventListener('click', function () {
        haptic();
        if (dlg.open) dlg.close();
        if (window.App && window.App.Speech && typeof window.App.Speech.toggle === 'function') {
          window.App.Speech.toggle();
        }
      });
    }

    var installAction = document.getElementById('mobileMoreInstallBtn');
    if (installAction) {
      if (window.App && window.App.isStandalone) {
        installAction.hidden = true;
      } else {
        installAction.addEventListener('click', function () {
          haptic();
          if (dlg.open) dlg.close();
          var realBtn = document.getElementById('pwaInstallBtn');
          if (realBtn) realBtn.click();
        });
      }
    }

    syncMoreViewHighlight();
    return dlg;
  }

  function syncMoreViewHighlight(activeView) {
    var main = document.querySelector('[data-panel-view]');
    var view = activeView || (main && main.dataset.panelView) || '';
    var kind = pageKind();
    var moreBtn = document.getElementById('mobileMoreBtn');
    if (moreBtn) {
      var isSecondary = kind === 'settings' || kind === 'earthquake' || view === 'analytics' || view === 'diagnostics';
      moreBtn.classList.toggle('active', isSecondary);
    }
    if (!moreDialog) return;
    var items = moreDialog.querySelectorAll('[data-mmd-view]');
    for (var i = 0; i < items.length; i++) {
      var on = items[i].getAttribute('data-mmd-view') === view;
      items[i].classList.toggle('active', on);
      if (on) items[i].setAttribute('aria-current', 'location');
      else items[i].removeAttribute('aria-current');
    }
  }

  function openMoreDialog() {
    var dlg = buildMoreDialog();
    if (!dlg) return;
    haptic();
    syncMoreViewHighlight();
    var btn = document.getElementById('mobileMoreBtn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    if (!dlg.open) {
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');
    }
  }

  /* Android tarafında yerel menü düğmesi görünür olur. */
  addAppClass();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildMoreDialog);
  } else {
    buildMoreDialog();
  }

  document.addEventListener('deneyap:panel-view', function (e) {
    syncMoreViewHighlight(e && e.detail);
  });

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    var moreBtn = target.closest('#mobileMoreBtn');
    if (moreBtn) {
      event.preventDefault();
      openMoreDialog();
      return;
    }

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

  window.addEventListener('pageshow', function () {
    addAppClass();
    syncMoreViewHighlight();
  });
})();
