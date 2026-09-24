import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [routeImages, nativeBrowser, pwaRoutes, pwaBuild] = await Promise.all([
  readFile(new URL('../mobile/src/routes/routeImages.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/routes/CuratedRouteBrowser.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../docs/routes.js', import.meta.url), 'utf8'),
  readFile(new URL('./build-pwa.mjs', import.meta.url), 'utf8'),
]);

assert.match(routeImages, /ROUTE_CARD_IMAGE_FALLBACK_WIDTH = 640/);
assert.match(routeImages, /ROUTE_CARD_IMAGE_MAX_WIDTH = 1280/);
assert.match(routeImages, /Math\.ceil\(safeLogicalWidth \* safePixelRatio\)/);

assert.match(nativeBrowser, /PixelRatio\.get\(\)/);
assert.match(nativeBrowser, /Image\.prefetch\(highResolutionUri\)/);
assert.match(nativeBrowser, /fadeDuration=\{0\}/);
assert.match(nativeBrowser, /routeCardImageSource\(route\.id\)/);

assert.match(pwaRoutes, /window\.devicePixelRatio/);
assert.match(pwaRoutes, /upgradeRouteCardImages\(root\)/);
assert.match(pwaRoutes, /data-route-card-image=/);
assert.match(pwaRoutes, /navigator\.connection\?\.saveData/);
assert.match(pwaRoutes, /routeCardImage\(route\)/);

assert.match(pwaBuild, /readFile\(resolve\(destination, 'routes\.css'\), 'utf8'\)/);
assert.match(pwaBuild, /readFile\(resolve\(destination, 'routes\.js'\), 'utf8'\)/);
assert.match(pwaBuild, /\.update\(rawRoutesCss\)/);
assert.match(pwaBuild, /\.update\(rawRoutesJs\)/);

console.log('Route HiDPI checks passed');
