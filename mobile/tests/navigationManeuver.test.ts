import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { navigationManeuverKind } from '../src/navigationManeuver.ts';
import { MATERIAL_NAVIGATION_PATHS } from '../src/components/materialNavigationPaths.ts';

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


describe('Google Material Symbols Rounded PWA/native asset parity', () => {
  const classes = [
    ['straight', 'straight'],
    ['turn-slight-left', 'slight-left'],
    ['turn-left', 'left'],
    ['turn-sharp-left', 'sharp-left'],
    ['uturn-left', 'uturn-left'],
    ['turn-slight-right', 'slight-right'],
    ['turn-right', 'right'],
    ['turn-sharp-right', 'sharp-right'],
    ['uturn-right', 'uturn-right'],
    ['merge', 'merge'],
    ['fork-left', 'fork-left'],
    ['fork-right', 'fork-right'],
    ['ramp-left', 'ramp-left'],
    ['ramp-right', 'ramp-right'],
    ['roundabout-left', 'roundabout-left'],
    ['roundabout-right', 'roundabout-right'],
    ['ferry', 'ferry'],
    ['arrive', 'arrive'],
  ] as const;

  it('uses the same offline SVG paths for every supported manoeuvre in both clients', () => {
    for (const [maneuver, kind] of classes) {
      assert.equal(navigationManeuverKind(maneuver), kind);
      const expected = `<symbol id="i-nav-${kind}" viewBox="0 -960 960 960"><path style="fill:currentColor;stroke:none" d="${MATERIAL_NAVIGATION_PATHS[kind]}"/></symbol>`;
      assert.ok(pwaShell.includes(expected), `PWA/native Google Material Symbols path mismatch: ${kind}`);
    }
    assert.equal(navigationManeuverKind('ferry-train'), 'ferry');
  });

  it('keeps slight, ordinary and sharp turns visually distinct', () => {
    for (const side of ['left', 'right'] as const) {
      const paths = [MATERIAL_NAVIGATION_PATHS[`slight-${side}`], MATERIAL_NAVIGATION_PATHS[side], MATERIAL_NAVIGATION_PATHS[`sharp-${side}`]];
      assert.equal(new Set(paths).size, paths.length);
    }
  });
});
