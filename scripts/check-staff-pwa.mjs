import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../docs/', import.meta.url);
const load = (path) => readFile(new URL(path, root), 'utf8');
const [manifestText, html, worker, riderWorker, adminJs, buildScript, adminHtml] = await Promise.all([
  load('staff/manifest.json'), load('staff/index.html'), load('staff/sw.js'),
  load('sw.js'), load('admin.js'),
  readFile(new URL('./build-pwa.mjs', import.meta.url), 'utf8'),
  load('admin.html'),
]);

// A separate PWA identity must not fork the actual operations controls:
// navigation, permissions and keyboard semantics evolve on both pages.
const body = (markup) => markup.split('<body>')[1]?.split('</body>')[0];
assert.equal(
  body(html).replace('src="../admin.js"', 'src="admin.js"'),
  body(adminHtml),
  'Staff and legacy admin shells must have identical body markup',
);
const manifest = JSON.parse(manifestText);
assert.equal(manifest.name, 'Rider Comms Staff');
assert.equal(manifest.id, './');
assert.equal(manifest.start_url, './');
assert.equal(manifest.scope, './');
assert.equal(manifest.display, 'standalone');
assert.ok(manifest.icons.some((entry) => entry.sizes === '192x192'));
assert.ok(manifest.icons.some((entry) => entry.sizes === '512x512'));
assert.match(html, /href="\.\/manifest\.json"/);
assert.match(html, /href="\.\.\/admin\.css"/);
assert.match(html, /src="\.\.\/admin\.js"/);
assert.match(html, /apple-mobile-web-app-title/);
assert.match(html, /worker-src 'self'; manifest-src 'self'/);
assert.doesNotMatch(html, /'unsafe-inline'|'unsafe-eval'/);
assert.match(adminJs, /\/auth\/staff-login/);
assert.match(adminJs, /\/admin\/me/);
assert.match(adminJs, /STAFF_SESSION_KEY/);
assert.match(adminJs, /IS_STAFF_PWA && 'serviceWorker' in navigator/);
assert.match(worker, /const STATIC_FILES = \[/);
assert.match(worker, /if \(!isShell && !isStaffNavigation\) return;/);
assert.match(worker, /request\.method !== 'GET'/);
assert.match(worker, /requestUrl|url\.origin !== self\.location\.origin/);
assert.match(worker, /key\.startsWith\(PREFIX\)/);
assert.doesNotMatch(worker, /auth\/login|auth\/staff-login|localStorage|Authorization/);
assert.match(riderWorker, /k\.startsWith\('rider-comms-pwa-v'\)/);
assert.match(riderWorker, /requestUrl\.pathname\.startsWith\(new URL\('\.\/staff\/'/);
assert.match(buildScript, /resolve\(source, 'staff'\)/);
assert.match(buildScript, /rider-comms-staff-v/);
console.log('Staff PWA install, CSP, session and cache isolation contracts valid');
