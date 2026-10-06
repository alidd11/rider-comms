import assert from 'node:assert/strict';
import {
  navigationCameraProfile,
  navigationCentreAheadMeters,
  offsetAlongHeading,
  stabilizeNavigationHeading,
} from '../shared/src/navigationCamera.ts';

await import('../docs/navigation-camera.js');

const browser = globalThis.RiderNavigationCamera;
assert.ok(browser, 'PWA navigation camera must expose RiderNavigationCamera');

const fixtures = {
  profile: [
    { speedMps: null },
    { speedMps: 0 },
    { speedMps: 1.5 },
    { speedMps: 5 },
    { speedMps: 10 },
    { speedMps: 18 },
    { speedMps: 27 },
    { speedMps: 10, maneuverDistanceMeters: 90, maneuver: 'turn-right' },
    { speedMps: 10, maneuverDistanceMeters: 90, maneuver: 'roundabout-right' },
    { speedMps: 10, maneuverDistanceMeters: 300, maneuver: 'roundabout-right' },
    { speedMps: 10, maneuverDistanceMeters: 90, maneuver: 'uturn-left' },
    { speedMps: 10, maneuverDistanceMeters: 90, maneuver: 'fork-left' },
  ],
  centre: [
    { viewportHeight: 932, topOcclusion: 269, bottomOcclusion: 308, zoom: 18.9, pitch: 50.4, latitude: 51.5 },
    { viewportHeight: 844, topOcclusion: 0, bottomOcclusion: 0, zoom: 18, pitch: 58, latitude: 40 },
    { viewportHeight: 844, topOcclusion: 400, bottomOcclusion: 400, zoom: 18, pitch: 58, latitude: 40 },
    { viewportHeight: 390, topOcclusion: 120, bottomOcclusion: 30, zoom: 17.6, pitch: 54, latitude: -33.9 },
    { viewportHeight: 0, topOcclusion: 0, bottomOcclusion: 0, zoom: 18, pitch: 50, latitude: 51 },
    { viewportHeight: 844, topOcclusion: Number.NaN, bottomOcclusion: 200, zoom: 18, pitch: Number.NaN, latitude: Number.NaN },
  ],
  offset: [
    [51.5, -0.1, 0, 50],
    [51.5, -0.1, 90, 50],
    [-33.9, 151.2, 225, 120],
    [51.5, -0.1, 30, -20],
  ],
  heading: [
    [null, 210, 0.4],
    [42, 210, 0.4],
    [350, 10, 10],
    [10, 350, 20],
    [180, 179, 27],
  ],
};

for (const input of fixtures.profile) {
  assert.deepEqual(
    browser.navigationCameraProfile(input),
    navigationCameraProfile(input),
    `PWA/native camera profile drift for ${JSON.stringify(input)}`,
  );
}

for (const input of fixtures.centre) {
  assert.equal(
    browser.navigationCentreAheadMeters(input),
    navigationCentreAheadMeters(input),
    `PWA/native camera centre drift for ${JSON.stringify(input)}`,
  );
}

for (const args of fixtures.offset) {
  assert.deepEqual(
    browser.offsetAlongHeading(...args),
    offsetAlongHeading(...args),
    `PWA/native heading offset drift for ${JSON.stringify(args)}`,
  );
}

for (const [previousHeading, candidateHeading, speedMps] of fixtures.heading) {
  assert.equal(
    browser.stabilizeNavigationHeading(previousHeading, candidateHeading, speedMps),
    stabilizeNavigationHeading(previousHeading, candidateHeading, speedMps),
    `PWA/native heading smoothing drift at ${previousHeading}, ${candidateHeading}, ${speedMps}`,
  );
}

console.log('Navigation camera PWA/native parity valid');
