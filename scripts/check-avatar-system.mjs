import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [
  nativePresets,
  nativeRenderer,
  nativeSettings,
  nativeMap,
  nativeRide,
  pwaAvatarSystem,
  pwaApp,
  pwaCss,
  pwaIndex,
  backendProfiles,
] = await Promise.all([
  readFile(new URL('../mobile/src/settings/avatars.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/components/RiderAvatar.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/SettingsScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/MapScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/ride/RideContext.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../docs/avatar-system.js', import.meta.url), 'utf8'),
  readFile(new URL('../docs/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../docs/app.css', import.meta.url), 'utf8'),
  readFile(new URL('../docs/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../backend/src/profileStore.ts', import.meta.url), 'utf8'),
]);

function extractArray(source, declaration, endMarker) {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `Missing ${declaration}`);
  const open = source.indexOf('[', start);
  assert.notEqual(open, -1, `Missing array start for ${declaration}`);
  const marker = source.indexOf(endMarker, open);
  assert.notEqual(marker, -1, `Missing end marker for ${declaration}`);
  const close = source.lastIndexOf('];', marker);
  assert.notEqual(close, -1, `Missing array end for ${declaration}`);
  return Function(`"use strict"; return (${source.slice(open, close + 1)});`)();
}

const nativeCatalogue = extractArray(nativePresets, 'export const AVATAR_PRESETS', 'export type AvatarId');
const pwaCatalogue = extractArray(pwaAvatarSystem, 'const AVATAR_PRESETS', 'const AVATAR_PRESET_BY_ID');
assert.deepEqual(pwaCatalogue, nativeCatalogue, 'PWA/native avatar catalogues must be byte-equivalent data after parsing');

const ids = nativeCatalogue.map((preset) => preset.id);
assert.equal(new Set(ids).size, ids.length, 'avatar IDs must be unique');
assert.equal(nativeCatalogue.length, 32, 'avatar collection must contain the approved 32 identities');
assert.equal(nativeCatalogue.filter((preset) => preset.family === 'helmet').length, 8, 'helmet family must contain 8 avatars');
assert.equal(nativeCatalogue.filter((preset) => preset.family === 'motorbike').length, 12, 'motorbike family must contain 12 avatars');
assert.equal(nativeCatalogue.filter((preset) => preset.family === 'car').length, 12, 'car family must contain 12 avatars');

for (const id of ids) {
  assert.ok(backendProfiles.includes(`'${id}'`), `backend no longer accepts persisted avatar id ${id}`);
}

const sharedGeometry = [
  'M24 56h16L32 70 24 56Z',
  'M9 32c1 16 9 25 23 29 14-4 22-13 23-29l-8 13-15 8-15-8-8-13Z',
  'M10 27c5-6 39-6 44 0l-3 16c-7 5-31 5-38 0l-3-16Z',
  'M17 16c7-7 19-9 29-4',
  'M14 25c7-2 10-2 14 0M36 25c4-2 7-2 14 0',
  'M28 36c0 10 1 20 4 22 3-2 4-12 4-22Z',
  'M14 20h4v10h-4ZM46 20h4v10h-4ZM14 36h4v10h-4ZM46 36h4v10h-4Z',
];

for (const geometry of sharedGeometry) {
  assert.ok(nativeRenderer.includes(geometry), `native renderer is missing shared avatar geometry ${geometry}`);
  assert.ok(pwaAvatarSystem.includes(geometry), `PWA renderer is missing shared avatar geometry ${geometry}`);
}

for (const token of ['#22D3EE', '#35E68A', '#78909A']) {
  assert.ok(nativeRenderer.includes(token), `native avatar renderer missing state colour ${token}`);
  assert.ok(pwaAvatarSystem.includes(token), `PWA avatar renderer missing state colour ${token}`);
}

assert.match(nativeSettings, /AVATAR_FAMILIES[\s\S]*avatarFamilyTabs[\s\S]*visiblePresets/, 'native picker must expose helmet/motorbike/car family tabs');
assert.match(pwaApp, /window\.RiderAvatarSystem/, 'PWA app must consume the standalone deterministic avatar renderer');
assert.match(pwaApp, /avatar-family-tabs[\s\S]*data-avatar-family-tab[\s\S]*data-avatar-family-panel/, 'PWA picker must expose helmet/motorbike/car family tabs');
assert.ok(pwaCss.includes('.avatar-family-tabs'), 'PWA family picker styling is missing');
assert.ok(pwaCss.includes('.avatar-family-panel[hidden]'), 'PWA family panels must hide inactive avatar families');
assert.ok(pwaIndex.includes('avatar-system.js?v=1'), 'PWA must load the deterministic avatar renderer before app.js');
assert.match(pwaApp, /function riderAvatarMapIcon\([\s\S]*riderAvatarSvg\(person\.avatarId/, 'PWA map markers must use the selected deterministic avatar');
assert.match(nativeMap, /<RiderAvatar[\s\S]*mapMarker[\s\S]*selected/, 'native self marker must use the selected RiderAvatar');
assert.match(nativeMap, /rideLocations[\s\S]*<RiderAvatar[\s\S]*mapMarker/, 'native private ride positions must render RiderAvatar markers');
assert.match(nativeMap, /client\.getPublicProfile\(id\)/, 'native live ride markers must resolve authoritative avatar identities');
assert.match(pwaApp, /function addMapMarker\([\s\S]*icon: riderAvatarMapIcon\(person, current, status\)/, 'PWA rider markers must use avatar map icons');

assert.match(
  pwaApp,
  /function updateNavigationPositionIcon\(\)[\s\S]*riderAvatarMapIcon\(state\.profile, true, undefined, 54\)/,
  'PWA navigation must keep the rider-selected avatar as the live self marker',
);
assert.ok(!pwaApp.includes('function navigationPositionMapIcon()'), 'PWA navigation must not replace the selected rider avatar with a generic chevron');
assert.match(
  nativeMap,
  /size=\{activeRoute \? 54 : 44\}[\s\S]*mapMarker[\s\S]*selected/,
  'native navigation must keep the rider-selected avatar as the live self marker',
);
assert.ok(!nativeMap.includes('navigationPositionMarker'), 'native navigation must not replace the selected rider avatar with a generic chevron');

assert.match(nativeRide, /const RIDE_LOCATION_REFRESH_MS = 10_000/, 'native ride locations must retain their 10 second refresh cadence');
assert.match(pwaApp, /const RIDE_LOCATION_REFRESH_MS = 10_000/, 'PWA ride locations must retain their 10 second refresh cadence');
assert.match(nativeMap, /const RIDE_AVATAR_REFRESH_MS = 30_000/, 'native ride avatar identity must refresh every 30 seconds');
assert.match(pwaApp, /const RIDE_AVATAR_REFRESH_MS = 30_000/, 'PWA ride avatar identity must refresh every 30 seconds');
assert.match(pwaApp, /function visibleMapRiders\(\)[\s\S]*state\.activeRide[\s\S]*rideMemberLocations\.has/, 'PWA map avatars must remain limited to authorised private ride locations');
assert.match(nativeMap, /ridersInZone\.length[\s\S]*exact locations private/, 'native public Nearby must continue to expose a count rather than individual coordinates');

assert.ok(
  pwaApp.includes("document.querySelectorAll('[data-avatar]').forEach"),
  'PWA profile rendering must iterate the full avatar node collection rather than call forEach on a single element',
);

for (const selector of [
  "document.querySelectorAll('#sheetBody [data-avatar-option]').forEach",
  "document.querySelectorAll('#sheetBody [data-avatar-family-tab]').forEach",
  "body.querySelectorAll('[data-avatar-family-tab]').forEach",
  "body.querySelectorAll('[data-avatar-family-panel]').forEach",
]) {
  assert.ok(pwaApp.includes(selector), `PWA avatar picker must iterate a node collection: ${selector}`);
}

for (const [id, bg] of Object.entries({
  ember: '#FF8A2B',
  ridge: '#4C8BF5',
  moss: '#3DD68C',
  dusk: '#8B5CF6',
  blaze: '#FF5A5F',
  gold: '#FBBF24',
  slate: '#64748B',
  rose: '#EC4899',
})) {
  const preset = nativeCatalogue.find((entry) => entry.id === id);
  assert.equal(preset?.bg, bg, `existing helmet ${id} base colour must remain backwards-compatible`);
}

console.log('Rider avatar parity valid: 32 deterministic helmet/motorbike/car identities share picker, navigation/map states and persistence rules');
