// Thème de l'appli : Auto (clair le jour, sombre le soir et la nuit), Clair ou Sombre.
// Chargé dans le <head> pour appliquer le thème avant l'affichage (pas d'éclair blanc).
(function () {
  'use strict';
  var KEY = 'stats.theme';
  var DAY_START = 7, DAY_END = 20;   // mode Auto : clair de 7 h à 20 h (heure de l'appareil), sombre le reste du temps
  var MODES = ['auto', 'light', 'dark'];
  var LABELS = { auto: '◐ Auto', light: '☀ Clair', dark: '☾ Sombre' };
  var NAMES = { auto: 'automatique selon l’heure', light: 'clair', dark: 'sombre' };

  function stored() {
    try { var v = window.localStorage.getItem(KEY); return MODES.indexOf(v) >= 0 ? v : 'auto'; } catch (e) { return 'auto'; }
  }
  function resolve(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    var h = new Date().getHours();
    return h >= DAY_START && h < DAY_END ? 'light' : 'dark';
  }
  function apply() {
    var mode = stored(), theme = resolve(mode);
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-theme-mode', mode);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b120e' : '#e6f0e8');
    var btns = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < btns.length; i++) {
      btns[i].textContent = LABELS[mode];
      btns[i].setAttribute('aria-label', 'Thème ' + NAMES[mode] + '. Toucher pour changer.');
    }
  }
  function cycle() {
    var next = MODES[(MODES.indexOf(stored()) + 1) % MODES.length];
    try { window.localStorage.setItem(KEY, next); } catch (e) { /* stockage indisponible */ }
    apply();
  }

  apply();
  document.addEventListener('DOMContentLoaded', apply);
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (t && t.closest && t.closest('.theme-toggle')) cycle();
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) apply(); });
  setInterval(function () { if (stored() === 'auto') apply(); }, 60000);   // bascule automatique à l'heure dite, appli ouverte
  window.Theme = { apply: apply, cycle: cycle, resolve: resolve, mode: stored };
})();
