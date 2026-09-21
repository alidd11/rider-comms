import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatNavigationDistance,
  formatNavigationSpeed,
  maneuverIcon,
  navigationManeuverAction,
  navigationPromptStageForDistance,
  navigationPromptText,
  navigationSpeedUnit,
} from '../src/navigationGuidance.ts';

describe('navigation guidance presentation', () => {
  it('formats metric and imperial distances consistently for navigation', () => {
    assert.equal(formatNavigationDistance(75, 'km'), '80 m');
    assert.equal(formatNavigationDistance(1600, 'km'), '1.6 km');
    assert.equal(formatNavigationDistance(75, 'mi'), '250 ft');
    assert.equal(formatNavigationDistance(1609.344, 'mi'), '1.0 mi');
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
    assert.equal(navigationManeuverAction('arrive'), 'Arrive');
  });

  it('stages advance turn prompts without repeating far-away instructions', () => {
    assert.equal(navigationPromptStageForDistance(800), 0);
    assert.equal(navigationPromptStageForDistance(500), 1);
    assert.equal(navigationPromptStageForDistance(150), 2);
    assert.equal(navigationPromptStageForDistance(40), 3);

    assert.equal(navigationPromptText('Turn left onto A1', 480, 'km', 1), 'In 480 m, Turn left onto A1');
    assert.equal(navigationPromptText('Turn left onto A1', 140, 'mi', 2), 'In 460 ft, Turn left onto A1');
    assert.equal(navigationPromptText('Turn left onto A1', 30, 'mi', 3), 'Turn left onto A1');
    assert.equal(navigationPromptText('Turn left onto A1', 800, 'mi', 0), '');
  });

  it('maps Google maneuver values to directional native icons', () => {
    assert.equal(maneuverIcon('turn-left'), 'arrow-back');
    assert.equal(maneuverIcon('turn-right'), 'arrow-forward');
    assert.equal(maneuverIcon('uturn-left'), 'return-up-back');
    assert.equal(maneuverIcon('uturn-right'), 'return-up-forward');
    assert.equal(maneuverIcon('merge'), 'git-merge-outline');
    assert.equal(maneuverIcon('roundabout-left'), 'sync');
    assert.equal(maneuverIcon('roundabout-right'), 'sync');
    assert.equal(maneuverIcon(undefined), 'arrow-up');
    assert.equal(maneuverIcon('straight'), 'arrow-up');
  });
});
