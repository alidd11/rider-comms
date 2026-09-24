import assert from 'node:assert/strict';
import {
  navigationCameraProfile,
  navigationViewportBias,
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
    { speedMps: 6, viewportBias: 1.25 },
  ],
  viewportBias: [
    [844, 0, 0],
    [844, 180, 120],
    [0, 0, 0],
    [Number.NaN, 10, 10],
    [844, Number.NaN, 50],
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

for (const [viewportHeight, topOcclusion, bottomOcclusion] of fixtures.viewportBias) {
  assert.equal(
    browser.navigationViewportBias(viewportHeight, topOcclusion, bottomOcclusion),
    navigationViewportBias(viewportHeight, topOcclusion, bottomOcclusion),
    `PWA/native viewport bias drift at ${viewportHeight}, ${topOcclusion}, ${bottomOcclusion}`,
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
