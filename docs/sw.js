const CACHE_NAME = 'rider-comms-pwa-v120';
const ASSETS = [
  './', './index.html', './app.css?v=97', './avatar-system.js?v=1', './app.js?v=96', './routes.css?v=39', './routes.js?v=34', './movement-safety.js?v=2', './message-state.js?v=2', './config.js?v=31',
  './manifest.json', './icons/icon-192.png', './icons/icon-512.png',
];
const SHELL_URLS = new Set(ASSETS.map((asset) => new URL(asset, self.location.href).href));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all(
      ASSETS.map(async (asset) => {
        const response = await fetch(asset, { cache: 'reload' });
        if (!response.ok) throw new Error(`Could not cache ${asset}`);
        await cache.put(asset, response);
      })
    ))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;
  const isNavigation = event.request.mode === 'navigate';
  const isShellAsset = SHELL_URLS.has(requestUrl.href);
  // Never put arbitrary same-origin GETs in the offline cache. In particular,
  // future authenticated/API routes must pass through untouched.
  if (!isShellAsset && !isNavigation) return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((response) => {
        if (response.ok && isShellAsset) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
        }
        return response;
      })
      .catch(async () => {
        if (isShellAsset) {
          const cached = await caches.match(event.request);
          if (cached) return cached;
        }
        if (isNavigation) return caches.match('./index.html');
        return Response.error();
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
