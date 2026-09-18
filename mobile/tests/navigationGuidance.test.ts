import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatNavigationDistance, maneuverIcon } from '../src/navigationGuidance.ts';

describe('navigation guidance presentation', () => {
  it('formats metric and imperial distances consistently for navigation', () => {
    assert.equal(formatNavigationDistance(75, 'km'), '80 m');
    assert.equal(formatNavigationDistance(1600, 'km'), '1.6 km');
    assert.equal(formatNavigationDistance(75, 'mi'), '250 ft');
    assert.equal(formatNavigationDistance(1609.344, 'mi'), '1.0 mi');
  });

  it('maps Google maneuver values to directional native icons', () => {
    assert.equal(maneuverIcon('turn-left'), 'arrow-back');
    assert.equal(maneuverIcon('turn-right'), 'arrow-forward');
    assert.equal(maneuverIcon('uturn-left'), 'return-up-back');
    assert.equal(maneuverIcon('uturn-right'), 'return-up-forward');
    assert.equal(maneuverIcon('merge'), 'git-merge-outline');
    assert.equal(maneuverIcon(undefined), 'arrow-up');
    assert.equal(maneuverIcon('straight'), 'arrow-up');
  });
});
