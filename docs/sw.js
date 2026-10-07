const CACHE_NAME = 'rider-comms-pwa-v147';
const ASSETS = [
  './', './index.html', './app.css?v=111', './avatar-system.js?v=1', './navigation-road-events.js?v=1', './position-interpolation.js?v=1', './navigation-guidance.js?v=1', './navigation-camera.js?v=3', './voice-activity.js?v=1', './app.js?v=117', './routes.css?v=39', './routes.js?v=34', './movement-safety.js?v=2', './message-state.js?v=2', './config.js?v=31',
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

const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;
  const isNavigation = event.request.mode === 'navigate';
  const isShellAsset = SHELL_URLS.has(requestUrl.href);
  // Never put arbitrary same-origin GETs in the offline cache. In particular,
  // future authenticated/API routes must pass through untouched.
  if (!isShellAsset && !isNavigation) return;
  const fetchAndCache = () => fetch(event.request, { cache: 'no-store' })
    .then((response) => {
      if (response.ok && isShellAsset) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
      }
      return response;
    });
  const cachedCopy = async () => {
    if (isShellAsset) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
    }
    if (isNavigation) return caches.match('./index.html');
    return undefined;
  };

  // Versioned assets (?v=<content hash>) never change, so the cached copy is
  // always right: serve it straight away instead of waiting on a weak signal.
  if (isShellAsset && requestUrl.searchParams.has('v')) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetchAndCache()));
    return;
  }

  // The page itself stays network-first so updates arrive, but on a
  // connection that accepts the request and then stalls, fall back to the
  // cached shell after a few seconds rather than hanging until the browser
  // gives up.
  event.respondWith((async () => {
    const network = fetchAndCache();
    const timedOut = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
    try {
      const first = await Promise.race([network, timedOut]);
      if (first) return first;
      const cached = await cachedCopy();
      return cached || await network;
    } catch {
      return (await cachedCopy()) || Response.error();
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
