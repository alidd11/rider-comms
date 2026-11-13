import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import * as shared from '../shared/src/navigationPuck.ts';

await import('../docs/navigation-puck.js');
const browser = globalThis.RiderNavigationPuck;
assert.ok(browser, 'PWA navigation puck must expose RiderNavigationPuck');

// The browser copy is generated; it must match the shared module's code.
const sharedCode = stripTypeScriptTypes(readFileSync(new URL('../shared/src/navigationPuck.ts', import.meta.url), 'utf8'));
const exported = [...sharedCode.matchAll(/export (?:function|const) (\w+)/g)].map((match) => match[1]);
assert.deepEqual(Object.keys(browser).sort(), exported.sort(), 'Run node scripts/build-navigation-puck.mjs');

const at = (east, north) => ({ lat: 51.5 + north / 111_195, lon: -0.12 + east / (111_195 * Math.cos(51.5 * Math.PI / 180)) });
const route = [at(0, 0), at(0, 500), at(500, 500), at(500, 1000), at(480, 1400)];
const fixes = [
  [{ ...at(9, 200), accuracyMeters: 10, headingDegrees: 2, speedMps: 12 }, null],
  [{ ...at(60, 200), accuracyMeters: 8, speedMps: 12 }, 150],
  [{ ...at(5, 200), accuracyMeters: 8, headingDegrees: 180, speedMps: 12 }, 190],
  [{ ...at(4, 495), accuracyMeters: 30, headingDegrees: 45, speedMps: 9 }, 480],
  [{ ...at(500, 800), accuracyMeters: 8, headingDegrees: 0, speedMps: 15 }, 100],
  [{ ...at(490, 1300), accuracyMeters: null, headingDegrees: null, speedMps: null }, 1200],
];

for (const impl of [shared, browser]) assert.equal(typeof impl.matchFixToPath, 'function');
const sharedIndex = shared.buildNavigationPathIndex(route);
const browserIndex = browser.buildNavigationPathIndex(route);
assert.deepEqual(browserIndex, sharedIndex, 'path index');
for (const [fix, previous] of fixes) {
  const a = shared.matchFixToPath(sharedIndex, fix, previous);
  const b = browser.matchFixToPath(browserIndex, fix, previous);
  assert.deepEqual(b, a, `match ${JSON.stringify(fix)}`);
  for (const seconds of [0, 0.4, 1, 3]) {
    assert.deepEqual(
      browser.predictNavigationPuck(browserIndex, b, fix.speedMps, seconds),
      shared.predictNavigationPuck(sharedIndex, a, fix.speedMps, seconds),
      `predict ${seconds}s`,
    );
  }
}
for (const distance of [-5, 0, 250, 500, 999, 2000]) {
  assert.deepEqual(browser.navigationPathPointAt(browserIndex, distance), shared.navigationPathPointAt(sharedIndex, distance));
}
assert.equal(browser.navigationFixAgeSeconds(1_000, 1_800), shared.navigationFixAgeSeconds(1_000, 1_800));
for (const [travel, mapHeading] of [[87, 87], [10, 350], [358, 0], [45, null], [-1, 0], [null, 0]]) {
  assert.equal(browser.navigationPuckConeDegrees(travel, mapHeading), shared.navigationPuckConeDegrees(travel, mapHeading), `cone ${travel}/${mapHeading}`);
}

{
  let a = shared.startNavigationTrip(0);
  let b = browser.startNavigationTrip(0);
  for (const fix of [{ ...at(0, 0), accuracyMeters: 5 }, { ...at(0, 3), accuracyMeters: 5 }, { ...at(0, 80), accuracyMeters: 90 }, { ...at(40, 80), accuracyMeters: 9 }]) {
    a = shared.recordNavigationTripFix(a, fix);
    b = browser.recordNavigationTripFix(b, fix);
    assert.deepEqual(b, a, 'trip');
  }
  assert.equal(browser.navigationTripSeconds(b, 90_400), shared.navigationTripSeconds(a, 90_400));
}

console.log('Navigation puck PWA/native parity valid: map matching, route prediction, fix age and heading cone agree');
