/* Section navigation uses the browser's scroll and history. */
(function () {
  'use strict';

  const sections = new Map();
  for (const link of document.querySelectorAll('.header-nav a[href^="#"], .bottom-nav a[href^="#"]')) {
    const id = link.hash.slice(1);
    if (!document.getElementById(id)) continue;
    if (!sections.has(id)) sections.set(id, []);
    sections.get(id).push(link);
  }

  function highlight(id) {
    for (const [section, links] of sections) {
      const selected = section === id;
      for (const link of links) {
        link.classList.toggle('active', selected);
        if (selected) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    }
  }

  function highlightHash() {
    const target = document.getElementById(location.hash.slice(1));
    const section = target && target.closest('.scrolly-section, #hero');
    highlight(section ? section.id : 'hero');
  }

  document.addEventListener('click', function (event) {
    const link = event.target.closest('.header-nav a[href^="#"], .bottom-nav a[href^="#"]');
    if (!link || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(link.hash.slice(1));
    if (!target?.hidden) return;
    event.preventDefault();
    const message = document.getElementById('noDeviceMsg')?.textContent;
    window.App?.toast(message || 'Cihaz bağlantısı bekleniyor.', { kind: 'warn' });
  });

  window.addEventListener('hashchange', highlightHash);
  highlightHash();

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(function (entries) {
      const visible = entries.find(entry => entry.isIntersecting);
      if (visible) highlight(visible.target.id);
    }, { rootMargin: '-30% 0px -60% 0px' });
    for (const id of sections.keys()) observer.observe(document.getElementById(id));
  }
})();
