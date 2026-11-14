/* Section navigation uses the browser's scroll and history. */
(function () {
  'use strict';

  const nav = document.querySelector('.header-nav');
  const sections = new Map();
  if (nav) {
    for (const link of nav.querySelectorAll('a[href^="#"]')) {
      const id = link.hash.slice(1);
      if (document.getElementById(id)) sections.set(id, link);
    }
  }

  function highlight(id) {
    for (const [section, link] of sections) {
      const selected = section === id;
      link.classList.toggle('active', selected);
      if (selected) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }

  function highlightHash() {
    const target = document.getElementById(location.hash.slice(1));
    const section = target && target.closest('.scrolly-section, #hero');
    highlight(section ? section.id : 'hero');
  }

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
