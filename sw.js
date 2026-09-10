/**
 * Service worker : l'application (dictionnaire compris) reste utilisable
 * hors ligne. Seule la reconnaissance de photo demande une connexion la
 * toute première fois, le temps de télécharger le moteur Tesseract.
 */
const CACHE = 'boggle-v3';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/dict.js',
  './js/solver.js',
  './js/ocr.js',
  './js/timer.js',
  './assets/dict-fr.txt',
  './assets/icon-180.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // Tesseract & co : réseau direct

  // Navigation : réseau d'abord, cache en secours.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Le dictionnaire et les icônes ne changent jamais : cache d'abord.
  if (/\/(assets)\//.test(url.pathname)) {
    e.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }))
    );
    return;
  }

  // Code de l'app : on sert le cache tout de suite, et on le rafraîchit en
  // arrière-plan. Sans cela, une mise à jour ne serait jamais reprise.
  e.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || network;
    })
  );
});
