import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  navigationInstructionRoad,
  formatNavigationDistance,
  formatNavigationSpeed,
  maneuverIcon,
  navigationManeuverAction,
  navigationPromptStageForDistance,
  navigationPromptText,
  navigationSpeedUnit,
  navigationStepStartPrompt,
} from '../src/navigationGuidance.ts';
import { routeChoices, routeTrafficDelayText, routeTwistiness } from '@rider-comms/shared';

describe('navigation guidance presentation', () => {
  it('formats metric and imperial distances consistently for navigation', () => {
    assert.equal(formatNavigationDistance(75, 'km'), '80 m');
    assert.equal(formatNavigationDistance(1600, 'km'), '1.6 km');
    assert.equal(formatNavigationDistance(75, 'mi'), '250 ft');
    assert.equal(formatNavigationDistance(1609.344, 'mi'), '1.0 mi');
    // Rounding never produces "1000 m" or "10.0 km".
    assert.equal(formatNavigationDistance(997, 'km'), '1.0 km');
    assert.equal(formatNavigationDistance(994, 'km'), '990 m');
    assert.equal(formatNavigationDistance(9_960, 'km'), '10 km');
    assert.equal(formatNavigationDistance(9.96 * 1609.344, 'mi'), '10 mi');
  });

  it('formats live GPS speed without implying a legal speed limit', () => {
    assert.equal(formatNavigationSpeed(13.4112, 'mi'), '30');
    assert.equal(navigationSpeedUnit('mi'), 'mph');
    assert.equal(formatNavigationSpeed(13.8889, 'km'), '50');
    assert.equal(navigationSpeedUnit('km'), 'km/h');
    assert.equal(formatNavigationSpeed(null, 'mi'), '—');
    assert.equal(formatNavigationSpeed(-1, 'mi'), '—');
  });

  it('derives glanceable actions only from structured maneuver metadata', () => {
    assert.equal(navigationManeuverAction('straight'), 'Go straight');
    assert.equal(navigationManeuverAction('turn-slight-right'), 'Bear right');
    assert.equal(navigationManeuverAction('turn-sharp-left'), 'Sharp left');
    assert.equal(navigationManeuverAction('fork-right'), 'Keep right');
    assert.equal(navigationManeuverAction('roundabout-right'), 'At roundabout');
    assert.equal(navigationManeuverAction('ferry'), 'Take the ferry');
    assert.equal(navigationManeuverAction('ferry-train'), 'Take the ferry train');
    assert.equal(navigationManeuverAction('depart'), 'Start route');
    assert.equal(navigationManeuverAction('name-change'), 'Continue');
    assert.equal(navigationManeuverAction(undefined), 'Continue');
    assert.equal(navigationManeuverAction('provider-future-value'), 'Continue');
    assert.equal(navigationManeuverAction('arrive'), 'Arrive');
  });

  it('stages advance turn prompts without repeating far-away instructions', () => {
    assert.equal(navigationPromptStageForDistance(800), 0);
    assert.equal(navigationPromptStageForDistance(500), 1);
    assert.equal(navigationPromptStageForDistance(150), 2);
    assert.equal(navigationPromptStageForDistance(40), 3);

    assert.equal(navigationPromptText('Turn left onto A1', 480, 'km', 1), 'In 480 m, turn left onto A1');
    assert.equal(navigationPromptText('Turn left onto A1', 140, 'mi', 2), 'In 460 ft, turn left onto A1');
    // A road name first keeps its capitals.
    assert.equal(navigationPromptText('A1 towards Barnet', 140, 'mi', 2), 'In 460 ft, A1 towards Barnet');
    assert.equal(navigationPromptText('Turn left onto A1', 30, 'mi', 3), 'Turn left onto A1');
    assert.equal(navigationPromptText('Turn left onto A1', 800, 'mi', 0), '');
  });

  it('warns earlier at speed, as Google Maps and Waze do', () => {
    // 70 mph: the first warning about a mile out, not 500 m.
    assert.equal(navigationPromptStageForDistance(1600, 31.3), 0);
    assert.equal(navigationPromptStageForDistance(1500, 31.3), 1);
    assert.equal(navigationPromptStageForDistance(460, 31.3), 2);
    assert.equal(navigationPromptStageForDistance(90, 31.3), 3);
    // Never earlier than 2 miles, however fast.
    assert.equal(navigationPromptStageForDistance(3300, 200), 0);
    // Slow or unknown speed keeps the distance thresholds.
    assert.equal(navigationPromptStageForDistance(800, 5), 0);
    assert.equal(navigationPromptStageForDistance(500, null), 1);
    assert.equal(navigationPromptStageForDistance(500, -1), 1);
  });

  it('says how far a long road goes when its step begins', () => {
    assert.equal(navigationStepStartPrompt('Turn left onto A3', 19_312, 'mi', false), 'Turn left onto A3. Continue for 12 mi.');
    assert.equal(navigationStepStartPrompt('Turn left onto A3.', 19_312, 'km', true), 'Continue for 19 km.');
    assert.equal(navigationStepStartPrompt('Turn left onto A3', 900, 'mi', false), 'Turn left onto A3');
    assert.equal(navigationStepStartPrompt('Turn left onto A3', 900, 'mi', true), '');
    assert.equal(navigationStepStartPrompt('', Number.NaN, 'mi', false), '');
  });

  it('maps Google maneuver values to directional native icons', () => {
    assert.equal(maneuverIcon('turn-left'), 'arrow-back');
    assert.equal(maneuverIcon('turn-right'), 'arrow-forward');
    assert.equal(maneuverIcon('uturn-left'), 'return-up-back');
    assert.equal(maneuverIcon('uturn-right'), 'return-up-forward');
    assert.equal(maneuverIcon('merge'), 'git-merge-outline');
    assert.equal(maneuverIcon('roundabout-left'), 'sync');
    assert.equal(maneuverIcon('roundabout-right'), 'sync');
    assert.equal(maneuverIcon('ferry'), 'boat-outline');
    assert.equal(maneuverIcon('ferry-train'), 'boat-outline');
    assert.equal(maneuverIcon(undefined), 'navigate');
    assert.equal(maneuverIcon('provider-future-value'), 'navigate');
    assert.equal(maneuverIcon('straight'), 'arrow-up');
  });
});

describe('navigationInstructionRoad', () => {
  it('quotes the road the instruction names, or returns null', () => {
    assert.equal(navigationInstructionRoad('Turn right onto Camden Rd/A503'), 'Camden Rd / A503');
    assert.equal(navigationInstructionRoad('At the roundabout, take the 2nd exit onto Holloway Rd'), 'Holloway Rd');
    assert.equal(navigationInstructionRoad('Head north on Camden Rd toward Kentish Town Rd'), 'Camden Rd');
    assert.equal(navigationInstructionRoad('Keep left to stay on M25'), 'M25');
    assert.equal(navigationInstructionRoad('Turn left onto Caledonian Rd. Destination will be on the right'), 'Caledonian Rd');
    assert.equal(navigationInstructionRoad('Turn left towards Leisure Wy'), 'Leisure Wy');
    assert.equal(navigationInstructionRoad('Slight right toward Leisure Wy'), 'Leisure Wy');
    assert.equal(navigationInstructionRoad('Turn right onto High Rd towards Barnet'), 'High Rd');
    assert.equal(navigationInstructionRoad('Turn left'), null);
    assert.equal(navigationInstructionRoad('Your destination is on the left'), null);
    assert.equal(navigationInstructionRoad(''), null);
  });

  it('scores how twisty a route is, ignoring GPS-scale wiggles', () => {
    const straight = Array.from({ length: 40 }, (_, i) => ({ lat: 51.5 + i * 0.001, lon: -0.1 }));
    const zigzag = Array.from({ length: 40 }, (_, i) => ({ lat: 51.5 + i * 0.001, lon: -0.1 + (i % 2) * 0.0008 }));
    const jitter = Array.from({ length: 40 }, (_, i) => ({ lat: 51.5 + i * 0.00005, lon: -0.1 + (i % 2) * 0.00001 }));
    assert.ok(routeTwistiness(straight) < 1);
    assert.ok(routeTwistiness(zigzag) > 200);
    // Under 200 m measured: too short to judge.
    assert.equal(routeTwistiness(jitter), 0);
    assert.equal(routeTwistiness([]), 0);
  });

  it('labels the fastest way, a twisty one and the rest, with how much longer', () => {
    const straight = Array.from({ length: 40 }, (_, i) => ({ lat: 51.5 + i * 0.001, lon: -0.1 }));
    const zigzag = Array.from({ length: 40 }, (_, i) => ({ lat: 51.5 + i * 0.001, lon: -0.1 + (i % 2) * 0.0008 }));
    assert.deepEqual(routeChoices([
      { durationSeconds: 1380, coordinates: straight },
      { durationSeconds: 1740, coordinates: zigzag },
      { durationSeconds: 1500, coordinates: straight },
    ]).map((choice) => choice.text), ['Fastest · 23 min', 'Twisty · 29 min · +6 min', 'Alternative · 25 min · +2 min']);
    // Only one route: just the fastest.
    assert.deepEqual(routeChoices([{ durationSeconds: 600, coordinates: straight }]), [{ index: 0, label: 'Fastest', text: 'Fastest · 10 min' }]);
    // The fastest is itself the twisty one: no separate Twisty label, and
    // under a minute longer says no extra time.
    assert.deepEqual(routeChoices([
      { durationSeconds: 1740, coordinates: zigzag },
      { durationSeconds: 1720, coordinates: zigzag },
    ]).map((choice) => choice.text), ['Alternative · 29 min', 'Fastest · 29 min']);
    assert.deepEqual(routeChoices([]), []);
  });

  it('says how much today\'s traffic adds, from two minutes up', () => {
    assert.equal(routeTrafficDelayText(1800, 1200), '+10 min traffic');
    assert.equal(routeTrafficDelayText(1800, 1750), '');
    assert.equal(routeTrafficDelayText(1800, null), '');
    assert.equal(routeTrafficDelayText(1800, Number.NaN), '');
  });
});
