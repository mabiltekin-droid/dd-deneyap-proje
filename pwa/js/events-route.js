/* Preserve URLs shared when the event log was part of the dashboard. */
(function () {
  'use strict';

  function openEventsPage() {
    if (window.location.hash !== '#eventLog') return;
    const target = new URL('./events.html', window.location.href);
    target.search = window.location.search;
    window.location.replace(target.href);
  }

  openEventsPage();
  window.addEventListener('hashchange', openEventsPage);
})();
