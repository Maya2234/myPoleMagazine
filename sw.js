/* Service worker: caches the app shell so the app opens offline.
 * Bump CACHE whenever you change any file below, or users keep the old copy. */
const CACHE = 'mypolemagazine-v5';
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
 * cache first version you had to bump CACHE or you kept seeing the previous build. */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isOurs = url.origin === location.origin;
  const isClient = url.origin === CDN;   // the Supabase client module, needed offline too
  if (!isOurs && !isClient) return;

  event.respondWith((async () => {
    try {
      const res = await fetch(request);
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
