/* ==========================================================================
   studio-nav.js - Ayarlar Stüdyosu: hamburger menü + sekmeli bölüm gezintisi
   --------------------------------------------------------------------------
   Amaç:
     Uzun tek sayfa yerine aynı anda yalnızca bir yapılandırma paneli gösterir.
     Tüm bölümler, üst çubuktaki üç çizgi (hamburger) düğmesinden açılan
     çekmecede gruplanmış bir liste hâlinde toplanır.

   Özellikler:
     - Menü, panel DOM'undan üretilir (başlık/açıklama/numara otomatik).
     - Yetkiye göre gizlenen paneller (Profilim, Davetler) menüde de gizlenir.
     - Adres çubuğu desteği: #accountCard, #thresholdSection veya #h-th gibi
       eski bağlantılar doğru sekmeyi açar.
     - Son seçilen sekme localStorage'da hatırlanır.
     - parallax.js'in SPA sayfa geçişlerinde App.initSettings / initDashboard
       sarmalanır; menü her geçişte yeniden kurulur.
     - Erişilebilirlik: role=dialog, inert, Esc ile kapatma, odak tuzağı.
   ========================================================================== */

(function () {
  'use strict';

  var STORE_KEY = 'dd.studio.tab';

  /* Menüde görünen kısa adlar. Tanımsız panelde h3 metni kullanılır. */
  var LABELS = {
    accountCard: 'Hesap & Roller',
    profileCard: 'Profilim',
    inviteCard: 'Davetler',
    devicesSection: 'Cihazlarım',
    connSection: 'Cihaz & Ağ',
    thresholdSection: 'Eşikler',
    automationSection: 'Modlar',
    telegramSection: 'Telegram',
    notifySection: 'Bildirimler',
    themeSection: 'Görünüm',
    backupSection: 'Bakım'
  };

  /* Feather tarzı 24x24 ikon gövdeleri (stroke ortak) */
  var ICONS = {
    accountCard: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    profileCard: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="M9 12l2 2 4-4"/>',
    inviteCard: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
    devicesSection: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    connSection: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    thresholdSection: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    automationSection: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    telegramSection: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    notifySection: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    themeSection: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    backupSection: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="23" x2="12" y2="15"/>'
  };

  var drawer = null;
  var backdrop = null;
  var menuBtn = null;
  var navEl = null;
  var closeBtn = null;
  var toolbar = null;
  var titleEl = null;
  var stepEl = null;
  var progressEl = null;
  var prevBtn = null;
  var nextBtn = null;

  var items = {};
  var currentId = null;
  var lastFocus = null;
  var isOpen = false;
  var panelObserver = null;
  var booted = false;

  /* ------------------------------------------------------------ Yardımcılar */

  function byId(id) {
    return document.getElementById(id);
  }

  function mainRoot() {
    return document.querySelector('.settings-studio-main');
  }

  function allPanels() {
    var root = mainRoot();
    if (!root) return [];
    return Array.prototype.slice.call(root.querySelectorAll('.config-panel'));
  }

  function panelById(id) {
    if (!id) return null;
    var el = byId(id);
    if (!el || !el.classList || !el.classList.contains('config-panel')) return null;
    var root = mainRoot();
    return root && root.contains(el) ? el : null;
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function panelLabel(panel) {
    if (!panel) return '';
    if (LABELS[panel.id]) return LABELS[panel.id];
    var h = panel.querySelector('.panel-title-row h3') || panel.querySelector('h3');
    return h ? h.textContent.trim() : (panel.id || '');
  }

  function panelSub(panel) {
    var tag = panel.querySelector('.panel-tag');
    if (!tag) return '';
    var text = tag.textContent.replace(/[\[\]]/g, '');
    var idx = text.indexOf('//');
    if (idx !== -1) text = text.slice(idx + 2);
    return text.trim();
  }

  function iconSvg(id) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[id] || ICONS.accountCard) + '</svg>';
  }

  function readStore() {
    try { return localStorage.getItem(STORE_KEY) || ''; } catch (e) { return ''; }
  }

  function writeStore(value) {
    try { localStorage.setItem(STORE_KEY, value); } catch (e) { /* yoksay */ }
  }

  function versionText() {
    return (window.App && window.App.VERSION) ? ('v' + window.App.VERSION) : 'Deneyap Ev Koruma';
  }

  function focusEl(el) {
    if (!el || typeof el.focus !== 'function') return;
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
  }

  function scrollTop() {
    try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }
    catch (e) { try { window.scrollTo(0, 0); } catch (e2) {} }
  }

  /* ------------------------------------------------------------- Çekmece UI */

  function ensureDrawer() {
    if (drawer && document.body.contains(drawer)) return;

    backdrop = byId('studioMenuBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'studioMenuBackdrop';
      backdrop.className = 'studio-drawer-backdrop';
      document.body.appendChild(backdrop);
    }
    backdrop.addEventListener('click', function () { closeMenu(true); });

    drawer = byId('studioMenu');
    if (!drawer) {
      drawer = document.createElement('aside');
      drawer.id = 'studioMenu';
      drawer.className = 'studio-drawer';
      drawer.setAttribute('role', 'dialog');
      drawer.setAttribute('aria-modal', 'true');
      drawer.setAttribute('aria-labelledby', 'studioMenuTitle');
      drawer.innerHTML =
        '<div class="studio-drawer-head">' +
          '<div class="sdb-brand">' +
            '<span class="sdb-kicker">MERKEZİ YAPILANDIRMA</span>' +
            '<h2 id="studioMenuTitle">Bölümler</h2>' +
          '</div>' +
          '<button type="button" class="studio-drawer-close" id="studioMenuClose" aria-label="Menüyü kapat">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
              '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
            '</svg>' +
          '</button>' +
        '</div>' +
        '<nav class="studio-drawer-nav" id="studioMenuNav" aria-label="Ayar bölümleri"></nav>' +
        '<div class="studio-drawer-foot">' +
          '<span class="sdf-dot" aria-hidden="true"></span>' +
          '<span id="studioMenuVersion"></span>' +
          '<a href="./index.html">Sensörler</a>' +
        '</div>';
      document.body.appendChild(drawer);
    }

    if (!isOpen) {
      drawer.setAttribute('aria-hidden', 'true');
      drawer.setAttribute('inert', '');
    }

    navEl = byId('studioMenuNav');
    closeBtn = byId('studioMenuClose');
    if (closeBtn && !closeBtn._bound) {
      closeBtn._bound = true;
      closeBtn.addEventListener('click', function () { closeMenu(true); });
    }
  }

  function ensureMenuButton() {
    var actions = document.querySelector('.glass-header .header-actions') ||
                  document.querySelector('.header-actions');
    if (!actions) return null;

    var btn = byId('studioMenuBtn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'studioMenuBtn';
      btn.type = 'button';
      btn.className = 'studio-menu-btn';
      btn.setAttribute('aria-label', 'Ayar bölümleri menüsünü aç');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-controls', 'studioMenu');
      btn.innerHTML =
        '<span class="smb-lines" aria-hidden="true"><span></span><span></span><span></span></span>' +
        '<span class="smb-text">Bölümler</span>';
      btn.addEventListener('click', function () {
        if (isOpen) closeMenu(true);
        else openMenu();
      });
    }

    if (btn.parentNode !== actions) actions.insertBefore(btn, actions.firstChild);
    return btn;
  }

  function removeMenuButton() {
    if (menuBtn && menuBtn.parentNode) menuBtn.parentNode.removeChild(menuBtn);
    menuBtn = null;
  }

  /* ------------------------------------------------------------- Araç çubuğu */

  function ensureToolbar(root) {
    var el = byId('studioToolbar');
    if (!el) {
      el = document.createElement('div');
      el.className = 'studio-toolbar';
      el.id = 'studioToolbar';
      el.innerHTML =
        '<div class="stb-crumbs">' +
          '<span class="stb-kicker">YAPILANDIRMA BÖLÜMÜ</span>' +
          '<h2 class="stb-title" id="studioCurrent" tabindex="-1">—</h2>' +
        '</div>' +
        '<div class="stb-meta">' +
          '<span class="stb-count" id="studioStep">01 / 01</span>' +
          '<button type="button" class="stb-arrow" id="studioPrev" aria-label="Önceki bölüm" title="Önceki bölüm">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>' +
          '</button>' +
          '<button type="button" class="stb-arrow" id="studioNext" aria-label="Sonraki bölüm" title="Sonraki bölüm">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="stb-progress" aria-hidden="true"><span id="studioProgress"></span></div>';

      var intro = root.querySelector('.studio-intro-bar');
      if (intro && intro.parentNode === root) root.insertBefore(el, intro.nextSibling);
      else root.insertBefore(el, root.firstChild);
    } else if (!root.contains(el)) {
      var introEl = root.querySelector('.studio-intro-bar');
      if (introEl && introEl.parentNode === root) root.insertBefore(el, introEl.nextSibling);
      else root.insertBefore(el, root.firstChild);
    }

    toolbar = el;
    titleEl = byId('studioCurrent');
    stepEl = byId('studioStep');
    progressEl = byId('studioProgress');
    prevBtn = byId('studioPrev');
    nextBtn = byId('studioNext');

    if (!el._bound) {
      el._bound = true;
      if (prevBtn) prevBtn.addEventListener('click', function () { step(-1); });
      if (nextBtn) nextBtn.addEventListener('click', function () { step(1); });
    }
  }

  function updateHeaderOffset() {
    var header = document.querySelector('.glass-header') || document.querySelector('header');
    if (!header) return;
    var h = Math.round(header.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty('--studio-header-h', (h + 1) + 'px');
  }

  /* ------------------------------------------------------------------ Menü */

  function buildMenu() {
    if (!navEl) return;
    var root = mainRoot();
    if (!root) return;

    navEl.innerHTML = '';
    items = {};

    var groups = root.querySelectorAll('.settings-group');

    Array.prototype.forEach.call(groups, function (group) {
      var groupPanels = group.querySelectorAll('.config-panel');
      if (!groupPanels.length) return;

      var groupLabelEl = group.querySelector('.settings-group-label .sgl-text');
      var groupLabel = groupLabelEl ? groupLabelEl.textContent.trim() : 'Bölümler';

      var wrap = document.createElement('div');
      wrap.className = 'studio-menu-group';

      var heading = document.createElement('p');
      heading.className = 'studio-menu-group-label';
      heading.textContent = groupLabel;
      wrap.appendChild(heading);

      Array.prototype.forEach.call(groupPanels, function (panel) {
        var id = panel.id;
        if (!id) return;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'studio-menu-item';
        btn.setAttribute('data-panel', id);
        btn.innerHTML =
          '<span class="smi-icon">' + iconSvg(id) + '</span>' +
          '<span class="smi-text">' +
            '<span class="smi-title"></span>' +
            '<span class="smi-sub"></span>' +
          '</span>' +
          '<span class="smi-num"></span>';

        btn.querySelector('.smi-title').textContent = panelLabel(panel);
        btn.querySelector('.smi-sub').textContent = panelSub(panel);

        btn.addEventListener('click', function () {
          var ok = activate(id, {});
          if (ok) {
            closeMenu(false);
            var activePanel = panelById(id);
            var title = activePanel && (activePanel.querySelector('.panel-title-row h3') ||
                                        activePanel.querySelector('h3'));
            if (title) {
              title.setAttribute('tabindex', '-1');
              focusEl(title);
            }
          }
        });

        wrap.appendChild(btn);
        items[id] = btn;
      });

      navEl.appendChild(wrap);
    });

    syncAvailability();
    updateActiveStyles();
  }

  function syncAvailability() {
    Object.keys(items).forEach(function (id) {
      var panel = panelById(id);
      items[id].hidden = !panel || panel.hidden;
    });

    if (navEl) {
      Array.prototype.forEach.call(navEl.querySelectorAll('.studio-menu-group'), function (group) {
        var visible = Array.prototype.some.call(group.querySelectorAll('.studio-menu-item'), function (btn) {
          return !btn.hidden;
        });
        group.hidden = !visible;
      });
    }

    renumber();
  }

  /* Görünür bölümleri 1'den başlayarak yeniden numaralandırır. Böylece
     yetkiyle gizlenen Profilim/Davetler numarada boşluk bırakmaz; menü,
     üst çubuk sayacı ve panel etiketleri aynı sırayı gösterir. */
  function renumber() {
    var visible = allPanels().filter(function (panel) { return !panel.hidden; });

    allPanels().forEach(function (panel) {
      var tag = panel.querySelector('.panel-tag');
      if (!tag) return;

      if (typeof tag._originalText !== 'string') tag._originalText = tag.textContent;
      var m = tag._originalText.match(/^(\[\s*CONFIG\s+)(\d+)([\s\S]*)$/);
      if (!m) return;

      var idx = visible.indexOf(panel);
      tag.textContent = idx === -1
        ? tag._originalText
        : (m[1] + pad(idx + 1) + m[3]);
    });

    if (!navEl) return;
    var menuNo = 0;
    Array.prototype.forEach.call(navEl.querySelectorAll('.studio-menu-item'), function (btn) {
      if (btn.hidden) return;
      menuNo += 1;
      var num = btn.querySelector('.smi-num');
      if (num) num.textContent = pad(menuNo);
    });
  }

  function updateActiveStyles() {
    Object.keys(items).forEach(function (id) {
      var btn = items[id];
      var active = id === currentId;
      btn.classList.toggle('is-active', active);
      if (active) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
  }

  function updateToolbar() {
    if (!toolbar) return;
    var available = allPanels().filter(function (p) { return !p.hidden; });
    var panel = panelById(currentId);
    var availIdx = available.indexOf(panel);

    if (titleEl) titleEl.textContent = panel ? panelLabel(panel) : 'Bölüm seçin';

    if (stepEl) {
      stepEl.textContent = (panel && availIdx !== -1)
        ? (pad(availIdx + 1) + ' / ' + pad(available.length))
        : ('-- / ' + pad(available.length));
    }

    if (progressEl) {
      var pct = (panel && availIdx !== -1 && available.length)
        ? ((availIdx + 1) / available.length) * 100
        : 0;
      progressEl.style.width = pct.toFixed(1) + '%';
    }

    if (prevBtn) prevBtn.disabled = availIdx <= 0;
    if (nextBtn) nextBtn.disabled = availIdx === -1 || availIdx >= available.length - 1;

    if (panel) {
      document.title = panelLabel(panel) + ' · Ayarlar — Deneyap Ev Koruma';
    }
  }

  /* ------------------------------------------------------------- Sekme akışı */

  function panelFromHash() {
    var raw = (window.location.hash || '').replace(/^#/, '');
    if (!raw) return null;
    try { raw = decodeURIComponent(raw); } catch (e) { /* yoksay */ }

    var direct = panelById(raw);
    if (direct) return direct;

    var el = byId(raw);
    if (el && el.closest) {
      var parent = el.closest('.config-panel');
      if (parent && mainRoot() && mainRoot().contains(parent)) return parent;
    }
    return null;
  }

  function firstAvailablePanel() {
    var list = allPanels();
    for (var i = 0; i < list.length; i += 1) {
      if (!list[i].hidden) return list[i];
    }
    return null;
  }

  function activate(id, options) {
    options = options || {};
    var panel = panelById(id);
    if (!panel || panel.hidden) return false;

    var root = mainRoot();
    if (!root) return false;

    allPanels().forEach(function (p) {
      p.classList.toggle('is-tab-active', p === panel);
    });

    currentId = id;
    root.classList.add('is-tabbed');

    updateActiveStyles();
    updateToolbar();

    if (options.remember !== false) writeStore(id);

    if (options.hash !== false) {
      try {
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', '#' + id);
        }
      } catch (e) { /* yoksay */ }
    }

    if (options.scroll !== false) scrollTop();

    return true;
  }

  function step(direction) {
    var list = allPanels().filter(function (p) { return !p.hidden; });
    var panel = panelById(currentId);
    var idx = list.indexOf(panel);
    if (idx === -1) return;

    var next = list[idx + direction];
    if (!next) return;

    activate(next.id, {});
    var title = next.querySelector('.panel-title-row h3') || next.querySelector('h3');
    if (title) {
      title.setAttribute('tabindex', '-1');
      focusEl(title);
    }
  }

  function checkActiveAvailability() {
    var panel = panelById(currentId);
    if (!panel || panel.hidden) {
      var next = firstAvailablePanel();
      if (next) activate(next.id, {});
    }
    updateToolbar();
  }

  /* --------------------------------------------------------------- Aç / kapat */

  function resetMenuUi() {
    isOpen = false;

    if (drawer) {
      drawer.classList.remove('is-open');
      drawer.setAttribute('aria-hidden', 'true');
      drawer.setAttribute('inert', '');
    }
    if (backdrop) backdrop.classList.remove('is-open');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');

    document.body.classList.remove('studio-menu-open');
    document.documentElement.classList.remove('studio-menu-open');
  }

  function openMenu() {
    if (!drawer) return;

    isOpen = true;
    lastFocus = document.activeElement;

    drawer.classList.add('is-open');
    drawer.removeAttribute('inert');
    drawer.setAttribute('aria-hidden', 'false');
    if (backdrop) backdrop.classList.add('is-open');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');

    document.body.classList.add('studio-menu-open');
    document.documentElement.classList.add('studio-menu-open');

    var target = (currentId && items[currentId]) ? items[currentId] : closeBtn;
    window.setTimeout(function () {
      if (!isOpen) return;
      focusEl(target);

      var activeItem = currentId ? items[currentId] : null;
      if (activeItem && navEl) {
        var top = activeItem.offsetTop - (navEl.clientHeight / 2) + (activeItem.offsetHeight / 2);
        navEl.scrollTop = Math.max(0, top);
      }
    }, 60);
  }

  function closeMenu(restoreFocus) {
    if (!drawer) return;
    var wasOpen = isOpen;
    resetMenuUi();

    if (restoreFocus && wasOpen) {
      var target = (lastFocus && document.body.contains(lastFocus) && !drawer.contains(lastFocus))
        ? lastFocus
        : menuBtn;
      focusEl(target);
    }
    lastFocus = null;
  }

  function onKeyDown(e) {
    if (!isOpen || !drawer) return;

    if (e.key === 'Escape' || e.keyCode === 27) {
      e.preventDefault();
      closeMenu(true);
      return;
    }

    if (e.key === 'Tab' || e.keyCode === 9) {
      var focusables = Array.prototype.filter.call(
        drawer.querySelectorAll('button:not([disabled]), a[href]'),
        function (el) { return !el.hidden && el.offsetParent !== null; }
      );
      if (!focusables.length) return;

      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      var inside = drawer.contains(document.activeElement);

      if (e.shiftKey) {
        if (!inside || document.activeElement === first) {
          e.preventDefault();
          focusEl(last);
        }
      } else if (!inside || document.activeElement === last) {
        e.preventDefault();
        focusEl(first);
      }
    }
  }

  /* ------------------------------------------------------------ Yaşam döngüsü */

  function watchPanels() {
    if (typeof MutationObserver === 'undefined') return;
    if (panelObserver) panelObserver.disconnect();

    var root = mainRoot();
    if (!root) return;

    panelObserver = new MutationObserver(function () {
      syncAvailability();
      checkActiveAvailability();
    });

    Array.prototype.forEach.call(root.querySelectorAll('.config-panel'), function (panel) {
      panelObserver.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    });
  }

  function sync() {
    var root = mainRoot();

    if (!root) {
      resetMenuUi();
      removeMenuButton();
      currentId = null;
      return;
    }

    ensureDrawer();
    menuBtn = ensureMenuButton();
    ensureToolbar(root);
    updateHeaderOffset();

    var versionEl = byId('studioMenuVersion');
    if (versionEl) versionEl.textContent = versionText();

    buildMenu();
    watchPanels();

    var target = null;
    var hashed = panelFromHash();
    if (hashed && !hashed.hidden) {
      target = hashed.id;
    } else if (currentId && panelById(currentId) && !panelById(currentId).hidden) {
      target = currentId;
    } else {
      var stored = readStore();
      if (stored && panelById(stored) && !panelById(stored).hidden) target = stored;
    }

    if (!target) {
      var first = firstAvailablePanel();
      if (first) target = first.id;
    }

    if (target) {
      /* Adres çubuğu görünen panelle uyuşmuyorsa (eski #h-th başlık bağlantısı,
         bilinmeyen kimlik veya yetkiyle gizlenmiş panel) tekil kimliğe çevir. */
      var canonical = '#' + target;
      var currentHash = window.location.hash || '';
      var fixHash = !!(currentHash && currentHash !== canonical);
      activate(target, { hash: fixHash, scroll: fixHash });
    } else {
      updateToolbar();
    }
  }

  function onHashChange() {
    var panel = panelFromHash();
    if (panel && !panel.hidden) {
      activate(panel.id, { hash: false, scroll: false });
      return;
    }

    if (panel && panel.hidden) {
      var next = firstAvailablePanel();
      if (next) activate(next.id, { scroll: false });
      return;
    }

    var active = panelById(currentId);
    if (active) {
      try {
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', '#' + active.id);
        }
      } catch (e) { /* yoksay */ }
    }
  }

  function hookApp(name) {
    var App = window.App;
    if (!App || typeof App[name] !== 'function' || App[name]._studioNavHooked) return;

    var original = App[name];
    var wrapped = function () {
      var result = original.apply(this, arguments);
      try { sync(); } catch (e) {
        if (window.console && console.warn) console.warn('[studio-nav] yeniden kurulamadı:', e);
      }
      return result;
    };
    wrapped._studioNavHooked = true;
    App[name] = wrapped;
  }

  function boot() {
    if (booted) return;
    booted = true;

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('hashchange', onHashChange);
    window.addEventListener('resize', updateHeaderOffset);

    hookApp('initSettings');
    hookApp('initDashboard');

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', sync);
    } else {
      sync();
    }
  }

  window.App = window.App || {};
  window.App.StudioNav = {
    refresh: sync,
    show: function (id) { return activate(id, {}); },
    open: openMenu,
    close: function () { closeMenu(true); }
  };

  boot();
})();
