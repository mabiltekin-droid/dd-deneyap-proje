/* Dashboard views share the current device connection and browser history. */
(function () {
  'use strict';

  const main = document.querySelector('[data-panel-view]');
  if (!main) return;

  const panels = new Set(['hero', 'telemetry', 'command-center', 'analytics', 'diagnostics']);
  const links = Array.from(document.querySelectorAll('.header-nav a[href^="#"], .bottom-nav a[href^="#"]'));

  function viewFor(target) {
    const section = target && target.closest('#hero, .scrolly-section');
    return section && panels.has(section.id) ? section.id : '';
  }

  function show(target) {
    const view = viewFor(target) || 'hero';
    main.dataset.panelView = view;
    for (const link of links) {
      const current = link.hash === '#' + view;
      link.classList.toggle('active', current);
      if (current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    const moreBtn = document.getElementById('mobileMoreBtn');
    if (moreBtn) {
      moreBtn.classList.toggle('active', view === 'analytics' || view === 'diagnostics');
    }
    const moreDlg = document.getElementById('mobileMoreDialog');
    if (moreDlg && moreDlg.open) {
      try { moreDlg.close(); } catch (e) { /* yoksay */ }
    }
    if (window.scrollY) window.scrollTo({top:0,behavior:'instant'});
    if (target && target.id !== view && !target.closest('[hidden]')) target.scrollIntoView();
    document.dispatchEvent(new CustomEvent('deneyap:panel-view', { detail: view }));
  }

  document.documentElement.classList.add('js-panel');
  show(document.getElementById(location.hash.slice(1)));
  window.addEventListener('pageshow', () => {
    const target = document.getElementById(location.hash.slice(1));
    const view = viewFor(target);
    if (view && view !== main.dataset.panelView) show(target);
    else if (target && target.id === (main.dataset.panelView || 'hero') && window.scrollY) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  });
  window.addEventListener('hashchange', () => show(document.getElementById(location.hash.slice(1))));

  document.addEventListener('click', function (event) {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.button > 0 || event.metaKey || event.altKey ||
        event.ctrlKey || event.shiftKey) return;
    const target = document.getElementById(link.hash.slice(1));
    if (!viewFor(target)) return;
    event.preventDefault();
    if (link.hash !== location.hash) history.pushState(null, '', link.hash);
    show(target);
  });
})();
