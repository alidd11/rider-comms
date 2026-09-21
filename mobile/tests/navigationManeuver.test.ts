import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { navigationManeuverKind } from '../src/navigationManeuver.ts';

describe('navigation maneuver visual categories', () => {
  it('preserves glanceable differences between turn strengths', () => {
    assert.equal(navigationManeuverKind('turn-slight-left'), 'slight-left');
    assert.equal(navigationManeuverKind('turn-left'), 'left');
    assert.equal(navigationManeuverKind('turn-sharp-left'), 'sharp-left');
    assert.equal(navigationManeuverKind('turn-slight-right'), 'slight-right');
    assert.equal(navigationManeuverKind('turn-right'), 'right');
    assert.equal(navigationManeuverKind('turn-sharp-right'), 'sharp-right');
  });

  it('keeps junction-specific maneuvers distinct instead of collapsing them into turn arrows', () => {
    assert.equal(navigationManeuverKind('merge'), 'merge');
    assert.equal(navigationManeuverKind('fork-left'), 'fork-left');
    assert.equal(navigationManeuverKind('fork-right'), 'fork-right');
    assert.equal(navigationManeuverKind('ramp-left'), 'ramp-left');
    assert.equal(navigationManeuverKind('roundabout-right'), 'roundabout-right');
    assert.equal(navigationManeuverKind('uturn-left'), 'uturn-left');
  });

  it('falls back safely to straight guidance', () => {
    assert.equal(navigationManeuverKind('straight'), 'straight');
    assert.equal(navigationManeuverKind(undefined), 'straight');
    assert.equal(navigationManeuverKind('name-change'), 'straight');
  });
});
