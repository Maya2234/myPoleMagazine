/* Service worker: caches the app shell so the app opens offline.
 * Bump CACHE whenever you change any file below, or users keep the old copy. */
const CACHE = 'mypolemagazine-v50';
const CDN = 'https://esm.sh';   // the Supabase client is imported from here
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/store.js',
  'js/supabase.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/avatars/pleaser-black.jpg',
  'icons/avatars/pleaser-blue.jpg',
  'icons/avatars/pleaser-boot.jpg',
  'icons/avatars/pleaser-orange.jpg',
  'icons/avatars/pleaser-pink.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

/* Network first, cache second. The cache is what makes the app open offline, but a network
 * first strategy means edits show up on reload while you are developing - with the old
 * cache first version you had to bump CACHE or you kept seeing the previous build.
 *
 * For our own files, "network first" has to mean the network: a plain fetch() is allowed to answer
 * out of the browser's HTTP cache, and that is how a release ends up serving the new app.js beside a
 * ten-minute-old store.js. Two halves of different builds crash the moment one of them calls
 * something the other has never exported. cache: 'no-store' asks the server for the file itself, so
 * a reload always lands on one whole build. The CDN is left to the HTTP cache on purpose: its URLs
 * carry a version and its payload is large, so there is nothing stale to gain by re-fetching it. */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isOurs = url.origin === location.origin;
  const isClient = url.origin === CDN;   // the Supabase client module, needed offline too
  if (!isOurs && !isClient) return;

  event.respondWith((async () => {
    try {
      const res = await (isOurs ? fetch(request, { cache: 'no-store' }) : fetch(request));
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(request);
      if (hit) return hit;
      if (request.mode === 'navigate') {
        const shell = await caches.match('index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
