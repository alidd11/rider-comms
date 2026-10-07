import assert from 'node:assert/strict';
import {
  navigationCameraProfile,
  navigationCentreAheadMeters,
  navigationMetresPerPoint,
  navigationRiderScreenOffset,
  nextNavigationCameraCorrection,
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
    { speedMps: 10, maneuverDistanceMeters: 90, maneuver: 'straight' },
    { speedMps: 10, maneuverDistanceMeters: 90 },
    { speedMps: 10, maneuverDistanceMeters: 90, maneuver: 'ramp-right' },
  ],
  centre: [
    { viewportHeight: 932, topOcclusion: 269, bottomOcclusion: 308, zoom: 18.9, pitch: 50.4, latitude: 51.5 },
    { viewportHeight: 844, topOcclusion: 0, bottomOcclusion: 0, zoom: 18, pitch: 58, latitude: 40 },
    { viewportHeight: 844, topOcclusion: 400, bottomOcclusion: 400, zoom: 18, pitch: 58, latitude: 40 },
    { viewportHeight: 390, topOcclusion: 120, bottomOcclusion: 30, zoom: 17.6, pitch: 54, latitude: -33.9 },
    { viewportHeight: 0, topOcclusion: 0, bottomOcclusion: 0, zoom: 18, pitch: 50, latitude: 51 },
    { viewportHeight: 844, topOcclusion: Number.NaN, bottomOcclusion: 200, zoom: 18, pitch: Number.NaN, latitude: Number.NaN },
  ],
  correction: [
    [1, { targetOffset: 80, measuredOffset: 120, flatOffset: 70, pitch: 50 }],
    [1, { targetOffset: 80, measuredOffset: 40, flatOffset: 30, pitch: 50 }],
    [1.4, { targetOffset: 80, measuredOffset: 80, flatOffset: 60, pitch: 50 }],
    [1, { targetOffset: 80, measuredOffset: 70, flatOffset: 70, pitch: 50 }],
    [1, { targetOffset: 10, measuredOffset: 70, flatOffset: 50, pitch: 50 }],
    [1, { targetOffset: 80, measuredOffset: -70, flatOffset: 50, pitch: 50 }],
    [Number.NaN, { targetOffset: 80, measuredOffset: 300, flatOffset: 50, pitch: 50 }],
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

for (const input of fixtures.centre) {
  assert.equal(
    browser.navigationRiderScreenOffset(input.viewportHeight, input.topOcclusion, input.bottomOcclusion),
    navigationRiderScreenOffset(input.viewportHeight, input.topOcclusion, input.bottomOcclusion),
    `PWA/native rider offset drift for ${JSON.stringify(input)}`,
  );
  assert.equal(
    browser.navigationMetresPerPoint(input.zoom, input.latitude),
    navigationMetresPerPoint(input.zoom, input.latitude),
    `PWA/native metres-per-point drift for ${JSON.stringify(input)}`,
  );
}

for (const [current, sample] of fixtures.correction) {
  assert.equal(
    browser.nextNavigationCameraCorrection(current, sample),
    nextNavigationCameraCorrection(current, sample),
    `PWA/native camera correction drift for ${current}, ${JSON.stringify(sample)}`,
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
