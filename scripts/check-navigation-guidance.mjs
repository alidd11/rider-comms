import assert from 'node:assert/strict';
import {
  formatNavigationDistance,
  formatNavigationDuration,
  formatNavigationSpeed,
  maneuverIcon,
  navigationManeuverAction,
  normalizeNavigationInstructionText,
  navigationPromptStageForDistance,
  navigationPromptText,
  navigationSpeedUnit,
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
  promptDistance: [Number.NaN, 800, 501, 500, 151, 150, 41, 40, 0],
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
  assert.equal(
    browser.navigationPromptStageForDistance(metres),
    navigationPromptStageForDistance(metres),
  );
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
}

console.log('Navigation guidance PWA/native parity valid');
