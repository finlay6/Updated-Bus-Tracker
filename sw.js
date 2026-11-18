const CACHE = 'bus-tracker-static-v4';
const FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/maplibre-E2rbe4Uv.js',
  './assets/maplibre-qvkd0SPb.css',
  './assets/maplibre-gl-worker-BslLc_p7.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('bus-tracker-') && key !== CACHE).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const root = new URL('./', self.location.href);
  if (request.method !== 'GET' || url.origin !== root.origin || !url.pathname.startsWith(root.pathname) || url.pathname.includes('/bt/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(new URL('index.html', root))));
    return;
  }
  if (FILES.some((file) => new URL(file, root).href === url.href)) {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch {
        return cached || Response.error();
      }
    }));
  }
});
