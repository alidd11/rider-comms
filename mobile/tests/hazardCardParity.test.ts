import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [nativeCard, nativeMap, pwa, pwaCss] = await Promise.all([
  readFile(new URL('../src/components/HazardDetailCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/screens/MapScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../../docs/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../../docs/app.css', import.meta.url), 'utf8'),
]);

for (const label of ['Still there', 'Gone']) {
  assert.match(nativeCard, new RegExp(label), `native hazard card missing ${label}`);
  assert.match(pwa, new RegExp(label), `PWA hazard card missing ${label}`);
}

assert.match(nativeMap, /<HazardDetailCard/, 'native map must render the focused hazard card');
assert.match(nativeMap, /selectedDestination && !selectedHazard/, 'native destination card must yield to a focused hazard');
assert.match(nativeCard, /minHeight: MIN_TOUCH_TARGET/, 'native hazard vote controls must preserve rider-friendly tap targets');
assert.match(nativeCard, /hazardAgeLabel/, 'native hazard card must expose report age');
assert.match(pwa, /hazard-vote-count/, 'PWA hazard counts must be visually secondary badges');
assert.match(pwa, /hazard-card-dismiss/, 'PWA hazard card must use the compact dismiss control');
assert.match(pwaCss, /#hazardCard \.hazard-vote-button\{[\s\S]*?min-height:48px/, 'PWA hazard vote controls must be at least 48px high');
assert.match(pwaCss, /#hazardCard \.hazard-card-head/, 'PWA hazard card must use the compact header layout');

console.log('Hazard detail card PWA/native parity valid');
