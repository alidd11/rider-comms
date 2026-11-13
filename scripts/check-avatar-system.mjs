import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [
  nativePresets,
  nativeRenderer,
  nativeSettings,
  nativeMapScreen,
  nativeRideProfilesHook,
  nativeRide,
  pwaAvatarSystem,
  pwaApp,
  pwaCss,
  pwaIndex,
  backendProfiles,
] = await Promise.all([
  readFile(new URL('../shared/src/avatars.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/components/RiderAvatar.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/SettingsScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/MapScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/useRideProfiles.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/ride/RideContext.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../docs/avatar-system.js', import.meta.url), 'utf8'),
  readFile(new URL('../docs/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../docs/app.css', import.meta.url), 'utf8'),
  readFile(new URL('../docs/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../backend/src/profileStore.ts', import.meta.url), 'utf8'),
]);
// MapScreen.tsx delegates ride-avatar-identity refreshing to the
// useRideProfiles hook -- checked together since assertions below don't
// care which file a given literal lives in.
const nativeMap = nativeMapScreen + nativeRideProfilesHook;
// The native renderer imports its geometry from shared/src/avatars.ts.
const nativeArtwork = nativeRenderer + nativePresets;

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
  'M14 46C11 40 10.5 33 12 27C14.5 17 23 11 33 11C43 11 51 16 54 25L56.5 35C57.2 38.5 56 42 53 44.5L47 48.5C44.5 50 41.5 49.6 39.5 47.5C37 45 33 43.6 29 44.2L20 46C18 46.4 15.5 46.8 14 46Z',
  'M32.5 21.5C40 19.2 48 19.6 53.6 22.6L55.6 31.2C49 33.2 40.5 33.3 34.5 31.2C31.4 28.6 31 24.2 32.5 21.5Z',
  'M14 46C16 44 22 42.5 29 42.3C33.5 42.2 37 43.5 39.5 45.7V47.5C37 45 33 43.6 29 44.2L20 46C18 46.4 15.5 46.8 14 46ZM12.5 27.5C10.4 26.4 9 24.6 9.2 22.4L13.8 21.2C14.2 23.4 13.7 25.6 12.5 27.5Z',
  'M46.5 38.2L53.2 36.6M46.4 41.6L51.6 40.2M13.2 35.6L31.6 31.4',
  'M18.5 19C22 15.2 27 13.2 33 13.2',
  'M35 24C41 22.4 47.5 22.8 52.5 25',
  'translate(8.5 15) scale(.42)',
  'GROUND_Y = 49.5',
  'REAR_WHEEL_X = 19',
  'FRONT_WHEEL_X = 45',
  'mixColour(preset.bg, \'#0B1419\', 0.78)',
  'mixColour(preset.bg, \'#FFFFFF\', 0.38)',
  '#7FA9B8',
  'preset.wheelRadius',
];

for (const geometry of sharedGeometry) {
  assert.ok(nativeArtwork.includes(geometry), `native renderer is missing shared avatar geometry ${geometry}`);
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
assert.match(nativeMap, /client\.getPublicProfiles\(ids\)/, 'native live ride markers must resolve authoritative avatar identities');
assert.match(pwaApp, /function addMapMarker\([\s\S]*icon: riderAvatarMapIcon\(person, current, status\)/, 'PWA rider markers must use avatar map icons');

assert.match(
  pwaApp,
  /function updateNavigationPositionIcon\(\)[\s\S]*riderAvatarMapIcon\(state\.profile, true, undefined, 64, true\)/,
  'PWA navigation must keep the rider-selected avatar as the enlarged tail-free live self marker',
);
assert.ok(!pwaApp.includes('navigationPositionMapIcon('), 'PWA navigation must not reference a generic navigation chevron anywhere');
assert.match(
  nativeMap + await readFile(new URL('../mobile/src/screens/mapMarkers.tsx', import.meta.url), 'utf8'),
  /NavigationPuckMarker[\s\S]*size=\{64\}[\s\S]*mapMarker=\{false\}[\s\S]*selected/,
  'native navigation must keep the rider-selected avatar as the enlarged tail-free live self marker',
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

for (const preset of nativeCatalogue.filter((entry) => entry.family !== 'helmet')) {
  assert.ok(preset.bodyPath, `${preset.id} needs side-on body artwork`);
}

console.log('Rider avatar parity valid: 32 deterministic helmet/motorbike/car identities share picker, navigation/map states and persistence rules');
