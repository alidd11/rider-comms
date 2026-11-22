// Rider Comms Staff has its own scope and cache namespace. Cache only
// public app-shell files. Never store staff bearer tokens, API data or reports.
const CACHE_NAME = 'rider-comms-staff-vbootstrap';
const PREFIX = 'rider-comms-staff-v';
const STATIC_FILES = [
  './index.html', './manifest.json', '../admin.css', '../admin.js',
  '../fonts/InterVariable.woff2', '../icons/icon-192.png', '../icons/icon-512.png',
  '../icons/apple-touch-icon.png',
];
const URLS = new Set(STATIC_FILES.map((url) => new URL(url, self.location.href).href));
const SHELL = new URL('./index.html', self.location.href).href;
const SCOPE = new URL('./', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => Promise.all(
    STATIC_FILES.map(async (file) => {
      const response = await fetch(file, { cache: 'reload', credentials: 'omit' });
      if (!response.ok) throw new Error('Staff shell asset unavailable');
      await cache.put(file, response);
    }),
  )));
});
// A new worker waits until the page has checked that no case editor or
// privileged dialog will be interrupted. The page then requests activation.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const isShell = URLS.has(url.href);
  const isStaffNavigation = request.mode === 'navigate' && url.href.startsWith(SCOPE);
  // Other same-origin pages and anything private are never handled here.
  if (!isShell && !isStaffNavigation) return;

  event.respondWith((async () => {
    const load = async () => {
      const result = await fetch(request, { cache: 'no-store', credentials: 'omit' });
      if (result.ok && isShell) {
        const copy = result.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
      }
      return result;
    };
    try {
      return await load(); // Always check for deployed updates first.
    } catch {
      const cache = await caches.open(CACHE_NAME);
      // Offline navigation displays only a static shell, which revalidates
      // every staff session through /admin/me before showing privileged data.
      return (await cache.match(isStaffNavigation ? SHELL : request)) || Response.error();
    }
  })());
});
