/**
 * Service worker : l'application (dictionnaire compris) reste utilisable
 * hors ligne. Seule la reconnaissance de photo demande une connexion la
 * toute première fois, le temps de télécharger le moteur Tesseract — qui
 * vient d'un CDN externe et ne coûte donc rien à l'hébergeur.
 *
 * Deux caches distincts, et c'est volontaire :
 *
 *  - SHELL  : le code de l'app. Renouvelé à chaque version, quelques dizaines
 *             de kilooctets.
 *  - ASSETS : dictionnaire et icônes. Jamais invalidé, parce que ces fichiers
 *             ne changent pas. Sans cette séparation, la moindre correction
 *             d'une ligne de CSS obligeait chaque téléphone à retélécharger
 *             les 348 Ko du dictionnaire.
 *
 * Si le dictionnaire ou les icônes venaient à changer, incrémenter
 * ASSET_CACHE : c'est la seule façon de forcer leur renouvellement.
 */
const SHELL_CACHE = 'boggle-shell-v5';
const ASSET_CACHE = 'boggle-assets-v1';

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
];

/* Liste volontairement réduite : les icônes de 512 px ne servent qu'à l'invite
   d'installation d'Android, et iOS n'utilise que celle de 180 px. Les charger
   d'office coûtait 38 Ko à chaque visiteur, pour rien. Elles seront mises en
   cache à la demande si un navigateur les réclame. */
const ASSETS = [
  './assets/dict-fr.txt',
  './assets/icon-180.png',
  './assets/icon-192.png',
];

const isAsset = (pathname) => pathname.includes('/assets/');

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL);

    // On ne télécharge que ce qui manque réellement.
    const assets = await caches.open(ASSET_CACHE);
    await Promise.all(ASSETS.map(async (url) => {
      if (!(await assets.match(url))) await assets.add(url);
    }));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const garder = [SHELL_CACHE, ASSET_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !garder.includes(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
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
          caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Dictionnaire et icônes : cache d'abord, sans jamais revalider.
  if (isAsset(url.pathname)) {
    e.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(ASSET_CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }))
    );
    return;
  }

  // Code de l'app : on sert le cache tout de suite et on le rafraîchit en
  // arrière-plan. Sans cela, une mise à jour ne serait jamais reprise.
  e.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || network;
    })
  );
});
