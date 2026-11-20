import assert from 'node:assert/strict';
import {
  formatNavigationDistance,
  formatNavigationDuration,
  formatNavigationSpeed,
  maneuverIcon,
  navigationInstructionRoad,
  navigationManeuverAction,
  normalizeNavigationInstructionText,
  navigationPromptStageForDistance,
  navigationPromptText,
  navigationSpeedUnit,
  navigationStepStartPrompt,
  FASTER_ROUTE_CHECK_MS,
  fasterRouteAnnouncement,
  fasterRouteSavingSeconds,
  routeAheadPath,
  routeChoices,
  routeTrafficDelayText,
  stopsOnTheWay,
  navigationEtaShareText,
  routeTwistiness,
  routeStyleAvoidsMotorways,
  routeIndexForStyle,
  routeTrafficNote,
  routeShareText,
} from '../shared/src/navigationGuidance.ts';

await import('../docs/navigation-guidance.js');

const browser = globalThis.RiderNavigationGuidance;
assert.ok(browser, 'PWA navigation guidance must expose RiderNavigationGuidance');

const fixtures = {
  distance: [
    [0, 'km'], [40, 'km'], [75, 'km'], [999, 'km'], [1000, 'km'], [1600, 'km'],
    [0, 'mi'], [30, 'mi'], [75, 'mi'], [160, 'mi'], [1609.344, 'mi'],
  ],
  speed: [[null, 'mi'], [-1, 'mi'], [0, 'mi'], [13.4112, 'mi'], [13.8889, 'km']],
  duration: [0, 1, 30, 59, 60, 61, 599, 600, 3599, 3600, 3661, 7199],
  maneuver: [
    undefined, 'straight', 'turn-left', 'turn-right', 'turn-slight-left', 'turn-slight-right',
    'turn-sharp-left', 'turn-sharp-right', 'uturn-left', 'uturn-right', 'fork-left',
    'fork-right', 'ramp-left', 'ramp-right', 'merge', 'roundabout-left',
    'roundabout-right', 'ferry', 'ferry-train', 'depart', 'name-change',
    'arrive', 'provider-future-value',
  ],
  promptDistance: [Number.NaN, 4000, 3200, 1600, 940, 800, 501, 500, 320, 151, 150, 100, 41, 40, 0],
  prompt: [
    ['Turn left onto A1', 480, 'km', 1],
    ['Turn left onto A1', 140, 'mi', 2],
    ['Turn left onto A1', 30, 'mi', 3],
    ['  Keep   right  ', 500, 'km', 1],
    ['', 30, 'km', 3],
    ['Continue', 800, 'mi', 0],
  ],
  instruction: [
    'Turn left onto A1',
    '  Continue   to follow  St Paul\'s Rd / A1201 ',
    'Keep right, then merge',
    '',
    'Turn right onto Camden Rd/A503',
    'At the roundabout, take the 2nd exit onto Holloway Rd',
    'Head north on Camden Rd toward Kentish Town Rd',
    'Turn left towards Leisure Wy',
    'Turn right onto High Rd towards Barnet',
    'Turn left onto Caledonian Rd. Destination will be on the right',
    'Your destination is on the left',
  ],
};

for (const [metres, unit] of fixtures.distance) {
  assert.equal(
    browser.formatNavigationDistance(metres, unit),
    formatNavigationDistance(metres, unit),
    `PWA/native distance drift at ${metres} ${unit}`,
  );
}

for (const [speedMps, unit] of fixtures.speed) {
  assert.equal(browser.formatNavigationSpeed(speedMps, unit), formatNavigationSpeed(speedMps, unit));
  assert.equal(browser.navigationSpeedUnit(unit), navigationSpeedUnit(unit));
}

for (const seconds of fixtures.duration) {
  assert.equal(
    browser.formatNavigationDuration(seconds),
    formatNavigationDuration(seconds),
    `PWA/native duration drift at ${seconds}s`,
  );
}

for (const maneuver of fixtures.maneuver) {
  assert.equal(browser.navigationManeuverAction(maneuver), navigationManeuverAction(maneuver));
  assert.equal(browser.maneuverIcon(maneuver), maneuverIcon(maneuver));
}

for (const metres of fixtures.promptDistance) {
  for (const speed of [undefined, null, -1, 0, 8, 31.3, 60, Number.NaN]) {
    assert.equal(
      browser.navigationPromptStageForDistance(metres, speed),
      navigationPromptStageForDistance(metres, speed),
    );
  }
}
for (const args of [
  ['Turn left onto A3', 19_312, 'mi', false],
  ['Turn left onto A3.', 19_312, 'km', true],
  ['Turn left onto A3', 900, 'mi', false],
  ['', 900, 'mi', false],
  ['  Keep   right  ', 2000, 'mi', false],
  ['Turn right', Number.NaN, 'km', false],
]) {
  assert.equal(browser.navigationStepStartPrompt(...args), navigationStepStartPrompt(...args));
}

for (const [instruction, metres, unit, stage] of fixtures.prompt) {
  assert.equal(
    browser.navigationPromptText(instruction, metres, unit, stage),
    navigationPromptText(instruction, metres, unit, stage),
  );
}

for (const instruction of fixtures.instruction) {
  assert.equal(
    browser.normalizeNavigationInstructionText(instruction),
    normalizeNavigationInstructionText(instruction),
  );
  assert.equal(browser.navigationInstructionRoad(instruction), navigationInstructionRoad(instruction));
}

console.log('Navigation guidance PWA/native parity valid');

{
  const straight = Array.from({ length: 40 }, (_, i) => ({ lat: 51.5 + i * 0.001, lon: -0.1 }));
  const zigzag = Array.from({ length: 40 }, (_, i) => ({ lat: 51.5 + i * 0.001, lon: -0.1 + (i % 2) * 0.0008 }));
  const jitter = Array.from({ length: 40 }, (_, i) => ({ lat: 51.5 + i * 0.00005, lon: -0.1 + (i % 2) * 0.00001 }));
  for (const points of [straight, zigzag, jitter, [], [straight[0]]]) {
    assert.equal(browser.routeTwistiness(points), routeTwistiness(points));
  }
  for (const routes of [
    [],
    [{ durationSeconds: 1380, coordinates: straight }],
    [{ durationSeconds: 1380, coordinates: straight }, { durationSeconds: 1740, coordinates: zigzag }, { durationSeconds: 1500, coordinates: straight }],
    [{ durationSeconds: 1740, coordinates: zigzag }, { durationSeconds: 1380, coordinates: zigzag }],
    [{ durationSeconds: 1400, coordinates: straight }, { durationSeconds: 1420, coordinates: straight }],
  ]) {
    assert.deepEqual(browser.routeChoices(routes), routeChoices(routes));
  }
  for (const routes of [
    [{ durationSeconds: 1380, coordinates: straight }, { durationSeconds: 1740, coordinates: zigzag }, { durationSeconds: 1500, coordinates: straight }],
    [{ durationSeconds: 1400, coordinates: straight }],
    [],
  ]) {
    for (const style of ['fastest', 'twisty', 'no_motorways']) {
      assert.equal(browser.routeIndexForStyle(routes, style), routeIndexForStyle(routes, style));
      for (const setting of [true, false]) assert.equal(browser.routeStyleAvoidsMotorways(style, setting), routeStyleAvoidsMotorways(style, setting));
    }
  }
  for (const [duration, typical, fastest] of [[1800, 1200, true], [1800, 1200, false], [1800, 1750, true], [1800, 1750, false], [1800, null, true], [1800, undefined, false]]) {
    assert.equal(browser.routeTrafficNote(duration, typical, fastest), routeTrafficNote(duration, typical, fastest));
  }
  for (const [duration, typical] of [[1800, 1200], [1800, 1750], [1800, null], [1800, undefined], [1800, Number.NaN]]) {
    assert.equal(browser.routeTrafficDelayText(duration, typical), routeTrafficDelayText(duration, typical));
  }
}

assert.equal(browser.FASTER_ROUTE_CHECK_MS, FASTER_ROUTE_CHECK_MS);
for (const [remaining, fresh] of [[1800, 1400], [1800, 1650], [7200, 6600], [7200, 6400], [600, 400], [600, 0], [Number.NaN, 100], [600, Number.NaN]]) {
  assert.equal(browser.fasterRouteSavingSeconds(remaining, fresh), fasterRouteSavingSeconds(remaining, fresh));
}
for (const saving of [180, 360, 3700]) assert.equal(browser.fasterRouteAnnouncement(saving), fasterRouteAnnouncement(saving));

{
  const line = Array.from({ length: 500 }, (_, i) => ({ lat: 51.5 + i * 0.0005, lon: -0.1 }));
  for (const [points, here, max] of [[line, { lat: 51.55, lon: -0.1001 }, 200], [line, line[0], 50], [line.slice(0, 5), line[4], 200], [[], line[0], 200], [line, line.at(-1), 200]]) {
    assert.deepEqual(browser.routeAheadPath(points, here, max), routeAheadPath(points, here, max));
  }
  const places = [{ id: 'a', travelSeconds: 1300 }, { id: 'b' }, { id: 'c', travelSeconds: 1230 }, { id: 'd', travelSeconds: 1000 }];
  for (const remaining of [1200, null, Number.NaN]) {
    assert.deepEqual(browser.stopsOnTheWay(places, remaining), stopsOnTheWay(places, remaining));
  }
}

for (const [destination, arrival, metres, unit] of [['Box Hill', '4:35 pm', 12_400, 'mi'], ['  ', '16:35', 900, 'km'], ['Café', '9:05 am', 40, 'mi']]) {
  assert.equal(browser.navigationEtaShareText(destination, arrival, metres, unit), navigationEtaShareText(destination, arrival, metres, unit));
}
for (const [destination, arrival, metres, unit, via] of [['Home', '7:25 PM', 17_700, 'mi', 'A41'], ['  ', '19:25', 900, 'km', ' ']]) {
  assert.equal(browser.routeShareText(destination, arrival, metres, unit, via), routeShareText(destination, arrival, metres, unit, via));
}
