import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { navigationManeuverKind } from '../src/navigationManeuver.ts';

const pwaApp = readFileSync(new URL('../../docs/app.js', import.meta.url), 'utf8');
const pwaShell = readFileSync(new URL('../../docs/index.html', import.meta.url), 'utf8');

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
    assert.equal(navigationManeuverKind('ferry'), 'ferry');
    assert.equal(navigationManeuverKind('ferry-train'), 'ferry');
  });

  it('falls back safely to straight guidance', () => {
    assert.equal(navigationManeuverKind('straight'), 'straight');
    assert.equal(navigationManeuverKind(undefined), 'straight');
    assert.equal(navigationManeuverKind('name-change'), 'straight');
  });

  it('keeps ferry maneuver artwork available in both clients', () => {
    assert.match(pwaApp, /ferry: 'i-nav-ferry'/);
    assert.match(pwaApp, /'ferry-train': 'i-nav-ferry'/);
    assert.match(pwaShell, /id="i-nav-ferry"/);
  });
});
