import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [nativeIcon, nativeSheet, nativeMap, pwa] = await Promise.all([
  readFile(new URL('../src/components/HazardIcon.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/screens/HazardReportSheet.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/screens/MapScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../../docs/app.js', import.meta.url), 'utf8'),
]);

const types = ['police', 'hidden_police', 'police_checkpoint', 'camera', 'accident', 'hazard', 'road_closure'];
for (const type of types) {
  assert.match(nativeIcon, new RegExp("case '" + type + "'"), 'native icon family missing ' + type);
  assert.match(pwa, new RegExp("case '" + type + "'"), 'PWA icon family missing ' + type);
}

assert.match(nativeSheet, /<HazardIcon type=\{type\} size=\{40\}/, 'native report sheet must use the approved artwork');
assert.match(nativeMap, /<HazardMarkerIcon type=\{hazard\.type\} size=\{size\} selected=\{selected\}/, 'native map must reuse the icon family');
assert.match(nativeMap, /const size = selected \? 32 : 26;/, 'native compact marker sizes must match the icon sheet');
assert.match(pwa, /hazardIconMarkup\(t\)/, 'PWA report sheet must use the approved artwork');
assert.match(pwa, /hazardPinIcon\(hazard\.type\)/, 'PWA map must use compact illustrated markers');
assert.match(pwa, /const size = selected \? 32 : 26;/, 'PWA compact marker sizes must match native');

console.log('Hazard icon PWA/native parity valid');
