import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [nativePresets, nativeRenderer, nativeMap, nativeRide, pwa, backendProfiles] = await Promise.all([
  readFile(new URL('../mobile/src/settings/avatars.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/components/RiderAvatar.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/MapScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/ride/RideContext.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../docs/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../backend/src/profileStore.ts', import.meta.url), 'utf8'),
]);

const avatars = [
  ['ember', '#FF8A2B', 'M32 10c-4 4-7 8-5 12 1.4 3 5.2 4.2 8 2.2 4-2.8 3-8-3-14Z'],
  ['ridge', '#4C8BF5', 'M19 24l8-10 5 6 4-5 9 9H19Z'],
  ['moss', '#3DD68C', 'M21 24c3-9 11-12 22-11-2 8-8 12-17 11 4-3 8-6 13-8-7 2-12 4-18 8Z'],
  ['dusk', '#8B5CF6', 'M37 11a10 10 0 1 0 7 16 11 11 0 1 1-7-16Z'],
  ['blaze', '#FF5A5F', 'M35 9 23 25h8l-3 12 13-19h-9l3-9Z'],
  ['gold', '#FBBF24', 'm32 10 3.4 7 7.7 1.1-5.6 5.4 1.3 7.7-6.8-3.6-6.8 3.6 1.3-7.7-5.6-5.4 7.7-1.1L32 10Z'],
  ['slate', '#64748B', 'M32 10 44 26l-12-5-12 5 12-16Z'],
  ['rose', '#EC4899', 'M32 10a7 7 0 0 0-7 7c0 6 7 13 7 13s7-7 7-13a7 7 0 0 0-7-7Zm0 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z'],
];

for (const [id, colour, motif] of avatars) {
  for (const [surface, source] of [['native', nativePresets], ['PWA', pwa]]) {
    assert.ok(source.includes(`id: '${id}'`), `${surface} avatar catalogue is missing ${id}`);
    assert.ok(source.includes(`bg: '${colour}'`), `${surface} avatar ${id} colour drifted from the shared design`);
    assert.ok(source.includes(`motifPath: '${motif}'`), `${surface} avatar ${id} motif drifted from the shared design`);
  }
  assert.ok(backendProfiles.includes(`'${id}'`), `backend no longer accepts persisted avatar id ${id}`);
}

const visor = 'M13 30.5C18 25 46 25 51 30.5L48 42.5C42.5 47 21.5 47 16 42.5L13 30.5Z';
assert.ok(nativeRenderer.includes(visor), 'native avatar visor geometry changed');
assert.ok(pwa.includes(visor), 'PWA avatar visor geometry changed');
assert.ok(nativeRenderer.includes('#22D3EE') && pwa.includes('#22D3EE'), 'avatar accent/eyes must stay shared cyan');
assert.ok(nativeRenderer.includes('#35E68A') && pwa.includes('#35E68A'), 'online state must stay shared green');

assert.match(nativeMap, /<RiderAvatar[\s\S]*mapMarker[\s\S]*selected/, 'native self marker must use the selected RiderAvatar');
assert.match(nativeMap, /rideLocations[\s\S]*<RiderAvatar[\s\S]*mapMarker/, 'native private ride positions must render RiderAvatar markers');
assert.match(nativeMap, /client\.getPublicProfile\(id\)/, 'native live ride markers must resolve authoritative avatar identities');
assert.match(pwa, /function riderAvatarMapIcon\([\s\S]*riderAvatarSvg/, 'PWA must build map markers from the shared avatar geometry');
assert.match(pwa, /function addMapMarker\([\s\S]*icon: riderAvatarMapIcon\(person, current\)/, 'PWA rider markers must use avatar map icons');

assert.match(nativeRide, /const RIDE_LOCATION_REFRESH_MS = 10_000/, 'native ride locations must retain their 10 second refresh cadence');
assert.match(pwa, /const RIDE_LOCATION_REFRESH_MS = 10_000/, 'PWA ride locations must retain their 10 second refresh cadence');
assert.match(pwa, /function visibleMapRiders\(\)[\s\S]*state\.activeRide[\s\S]*rideMemberLocations\.has/, 'PWA map avatars must remain limited to authorised private ride locations');
assert.match(nativeMap, /ridersInZone\.length[\s\S]*exact locations private/, 'native public Nearby must continue to expose a count rather than individual coordinates');

console.log(`Rider avatar parity valid: ${avatars.length} persisted identities share geometry, map states and 10s ride-location refresh`);
