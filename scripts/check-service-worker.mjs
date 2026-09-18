import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [workerSource, appSource] = await Promise.all([
  readFile(new URL('../docs/sw.js', import.meta.url), 'utf8'),
  readFile(new URL('../docs/app.js', import.meta.url), 'utf8'),
]);

const installStart = workerSource.indexOf("self.addEventListener('install'");
const activateStart = workerSource.indexOf("self.addEventListener('activate'");
assert.ok(installStart >= 0 && activateStart > installStart, 'service worker install handler is missing');
const installHandler = workerSource.slice(installStart, activateStart);

assert.doesNotMatch(
  installHandler,
  /skipWaiting/,
  'install must leave the update waiting until the rider chooses Update now'
);
assert.match(
  workerSource,
  /if \(!isShellAsset && !isNavigation\) return;/,
  'fetch handling must be allowlisted to shell assets and navigations'
);
assert.match(
  workerSource,
  /response\.ok && isShellAsset/,
  'only immutable application-shell responses may enter the cache'
);
assert.match(
  workerSource,
  /event\.data\?\.type === 'SKIP_WAITING'/,
  'the explicit update action must still be able to activate a waiting worker'
);
assert.match(
  appSource,
  /registration\.waiting && navigator\.serviceWorker\.controller/,
  'the UI must reveal an update that was already waiting when the page loaded'
);

console.log('Service-worker lifecycle and cache policy valid');
