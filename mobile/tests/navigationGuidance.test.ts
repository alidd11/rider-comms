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
import { fasterRouteAnnouncement, fasterRouteSavingSeconds, navigationEtaShareText, routeAheadPath, stopsOnTheWay, routeChoices, routeTrafficDelayText, routeTwistiness, routeIndexForStyle, routeShareText, routeStyleAvoidsMotorways, routeTrafficNote } from '@rider-comms/shared';

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
    // The button shows the time big, with a short tag under it.
    assert.deepEqual(routeChoices([
      { durationSeconds: 1380, coordinates: straight },
      { durationSeconds: 1740, coordinates: zigzag },
      { durationSeconds: 1500, coordinates: straight },
    ]).map((choice) => [choice.time, choice.tag]), [['23 min', 'Fastest'], ['29 min', 'Twisty · +6 min'], ['25 min', '+2 min']]);
    // Only one route: just the fastest.
    assert.deepEqual(routeChoices([{ durationSeconds: 600, coordinates: straight }]), [{ index: 0, label: 'Fastest', text: 'Fastest · 10 min', time: '10 min', tag: 'Fastest' }]);
    // The fastest is itself the twisty one: no separate Twisty label, and
    // under a minute longer says no extra time.
    assert.deepEqual(routeChoices([
      { durationSeconds: 1740, coordinates: zigzag },
      { durationSeconds: 1720, coordinates: zigzag },
    ]).map((choice) => choice.text), ['Alternative · 29 min', 'Fastest · 29 min']);
    assert.equal(routeChoices([{ durationSeconds: 1740, coordinates: zigzag }, { durationSeconds: 1720, coordinates: zigzag }])[0]!.tag, 'Alternative');
    assert.deepEqual(routeChoices([]), []);
  });

  it('says how much today\'s traffic adds, from two minutes up', () => {
    assert.equal(routeTrafficDelayText(1800, 1200), '+10 min traffic');
    assert.equal(routeTrafficDelayText(1800, 1750), '');
    assert.equal(routeTrafficDelayText(1800, null), '');
    assert.equal(routeTrafficDelayText(1800, Number.NaN), '');
  });

  it('switches to a faster route only when it saves 3 minutes and a tenth of the trip', () => {
    assert.equal(fasterRouteSavingSeconds(1800, 1400), 400);
    assert.equal(fasterRouteSavingSeconds(1800, 1650), 0);
    // Two hours left: a tenth is 12 minutes, so 10 minutes saved isn't enough.
    assert.equal(fasterRouteSavingSeconds(7200, 6600), 0);
    assert.equal(fasterRouteSavingSeconds(7200, 6400), 800);
    assert.equal(fasterRouteSavingSeconds(600, 0), 0);
    assert.equal(fasterRouteSavingSeconds(Number.NaN, 100), 0);
    assert.equal(fasterRouteAnnouncement(360), 'Faster route found. Saves 6 min.');
  });

  it('sends only the rest of the route, thinned, to search along', () => {
    const line = Array.from({ length: 500 }, (_, i) => ({ lat: 51.5 + i * 0.0005, lon: -0.1 }));
    const ahead = routeAheadPath(line, { lat: 51.55, lon: -0.1001 });
    assert.equal(ahead.length, 200);
    assert.deepEqual(ahead[0], { lat: 51.55, lon: -0.1001 });
    assert.deepEqual(ahead.at(-1), line.at(-1));
    assert.equal(routeAheadPath(line.slice(0, 5), line[4]!).length, 0);
    assert.equal(routeAheadPath([], line[0]!).length, 0);
    assert.equal(routeAheadPath(line.slice(0, 5), line[0]!).length, 5);
  });

  it('orders stops on the way by what they add', () => {
    const stops = stopsOnTheWay([{ id: 'a', travelSeconds: 1500 }, { id: 'b' }, { id: 'c', travelSeconds: 1230 }, { id: 'd', travelSeconds: 1000 }], 1200);
    assert.deepEqual(stops.map((stop) => [stop.place.id, stop.text]), [['d', 'On the way'], ['c', 'On the way'], ['a', '+5 min'], ['b', '']]);
    assert.deepEqual(stopsOnTheWay([{ id: 'a', travelSeconds: 10 }], null).map((stop) => stop.text), ['']);
  });
});

describe('navigationEtaShareText', () => {
  it('names the place, the arrival time and what is left', () => {
    assert.equal(
      navigationEtaShareText('Box Hill', '4:35 pm', 12_400, 'mi'),
      'On my way to Box Hill. Arriving about 4:35 pm, 7.7 mi to go. Sent from Rider Comms.',
    );
    assert.equal(
      navigationEtaShareText('  ', '16:35', 900, 'km'),
      'On my way to my destination. Arriving about 16:35, 900 m to go. Sent from Rider Comms.',
    );
  });
});

it('riding styles: which way to show first, and whether to keep off motorways', () => {
  const straight = Array.from({ length: 40 }, (_, i) => ({ lat: 51.5 + i * 0.001, lon: -0.1 }));
  const zigzag = Array.from({ length: 40 }, (_, i) => ({ lat: 51.5 + i * 0.001, lon: -0.1 + (i % 2) * 0.0008 }));
  const routes = [{ durationSeconds: 1500, coordinates: straight }, { durationSeconds: 1800, coordinates: zigzag }, { durationSeconds: 1380, coordinates: straight }];
  assert.equal(routeIndexForStyle(routes, 'fastest'), 2);
  assert.equal(routeIndexForStyle(routes, 'no_motorways'), 2);
  assert.equal(routeIndexForStyle(routes, 'twisty'), 1);
  assert.equal(routeIndexForStyle([], 'twisty'), 0);
  assert.equal(routeStyleAvoidsMotorways('fastest', false), false);
  assert.equal(routeStyleAvoidsMotorways('fastest', true), true);
  assert.equal(routeStyleAvoidsMotorways('twisty', false), true);
  assert.equal(routeStyleAvoidsMotorways('no_motorways', false), true);
});

it('the traffic note under the chosen route, and what Share sends', () => {
  assert.equal(routeTrafficNote(1800, 1320, true), 'Fastest despite +8 min of traffic');
  assert.equal(routeTrafficNote(1800, 1320, false), '+8 min of traffic');
  assert.equal(routeTrafficNote(1800, 1750, true), 'Fastest route, usual traffic');
  assert.equal(routeTrafficNote(1800, 1750, false), 'Usual traffic');
  assert.equal(routeTrafficNote(1800, undefined, true), 'Fastest route');
  assert.equal(routeTrafficNote(1800, null, false), '');
  assert.equal(routeShareText('Home', '7:25 PM', 17_700, 'mi', 'A41'), 'Heading to Home via A41: 11 mi, arriving about 7:25 PM. Sent from Rider Comms.');
  assert.equal(routeShareText(' ', '19:25', 900, 'km', ''), 'Heading to my destination: 900 m, arriving about 19:25. Sent from Rider Comms.');
});
