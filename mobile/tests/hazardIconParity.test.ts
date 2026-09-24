import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [nativeIcon, nativeSheet, nativeMap, pwa] = await Promise.all([
  readFile(new URL('../src/components/HazardIcon.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/screens/HazardReportSheet.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/screens/mapMarkers.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../../docs/app.js', import.meta.url), 'utf8'),
]);

const types = ['police', 'hidden_police', 'police_checkpoint', 'camera', 'accident', 'road_closure'];
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

assert.doesNotMatch(nativeSheet, /Pothole/, 'native report sheet must not expose the retired pothole category');
assert.doesNotMatch(pwa, /label: 'Pothole'/, 'PWA report sheet must not expose the retired pothole category');

const POLICE_CAP_REVISION = 'M6 20C10 13 16 9 24 9C32 9 38 13 42 20L36 24H12Z';
const HIDDEN_POLICE_BARRIER = 'M4 27H44V39H4Z';
assert.ok(nativeIcon.includes(POLICE_CAP_REVISION), 'native Police icon must use the revised peaked-cap silhouette');
assert.ok(pwa.includes(POLICE_CAP_REVISION), 'PWA Police icon must match the revised peaked-cap silhouette');
assert.ok(nativeIcon.includes(HIDDEN_POLICE_BARRIER), 'native Hidden police icon must show the concealment barrier');
assert.ok(pwa.includes(HIDDEN_POLICE_BARRIER), 'PWA Hidden police icon must show the same concealment barrier');
assert.ok(nativeIcon.includes('fill={WHITE}') && pwa.includes('fill="#F4F7F8"'), 'police artwork must retain the high-contrast shield treatment');
