// Service worker : met l'appli en cache pour qu'elle s'ouvre sans réseau.
// Les appels à l'API Apps Script ne passent jamais par le cache.
// Pour publier une nouvelle version de l'appli : changer le numéro ci-dessous ET le « ?v= » de styles.css, app.js et config.js
// dans index.html et dans la liste SHELL (le navigateur ne peut plus mélanger ancien et nouveau fichier).
var VERSION = 'stats-castel-v16';
var SHELL = [
  './',
  'index.html',
  'styles.css?v=16',
  'app.js?v=16',
  'config.js?v=16',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/logo-256.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;   // API et autres origines : réseau direct
  event.respondWith(
    fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })).then(function (res) {   // revalidation à chaque fois : jamais un ancien fichier gardé 10 minutes par le navigateur
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match('index.html'); });
    })
  );
});
