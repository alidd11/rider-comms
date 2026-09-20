import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  combineNavigationCameraPaths,
  navigationCameraProfile,
  navigationViewportBias,
  stabilizeNavigationHeading,
} from '../src/navigationCamera.ts';

describe('adaptive navigation camera', () => {
  it('shows progressively more road as speed rises', () => {
    const stopped = navigationCameraProfile({ speedMps: 0 });
    const city = navigationCameraProfile({ speedMps: 10 });
    const fast = navigationCameraProfile({ speedMps: 27 });

    assert.ok(stopped.zoom > city.zoom && city.zoom > fast.zoom);
    assert.ok(stopped.lookAheadMeters < city.lookAheadMeters && city.lookAheadMeters < fast.lookAheadMeters);
    assert.ok(stopped.centreAheadMeters < city.centreAheadMeters && city.centreAheadMeters < fast.centreAheadMeters);
  });

  it('uses the normal city profile when GPS speed is unavailable', () => {
    assert.deepEqual(
      navigationCameraProfile({ speedMps: null }),
      { zoom: 18.4, pitch: 60, lookAheadMeters: 165, centreAheadMeters: 70 },
    );
  });

  it('pulls back and flattens for an approaching complex junction', () => {
    const ordinary = navigationCameraProfile({ speedMps: 10, maneuverDistanceMeters: 90, maneuver: 'turn-right' });
    const roundabout = navigationCameraProfile({ speedMps: 10, maneuverDistanceMeters: 90, maneuver: 'roundabout-right' });

    assert.ok(roundabout.zoom < ordinary.zoom);
    assert.ok(roundabout.pitch < ordinary.pitch);
    assert.ok(roundabout.lookAheadMeters > ordinary.lookAheadMeters);
  });

  it('biases the rider lower when navigation chrome reduces useful viewport', () => {
    const clear = navigationViewportBias(844, 0, 0);
    const obscured = navigationViewportBias(844, 180, 120);
    assert.equal(clear, 1);
    assert.ok(obscured > clear);
  });

  it('holds heading while stopped and smooths across north without a long rotation', () => {
    assert.equal(stabilizeNavigationHeading(42, 210, 0.4), 42);
    const smoothed = stabilizeNavigationHeading(350, 10, 10);
    assert.ok(smoothed > 350 || smoothed < 20);
    assert.ok(smoothed > 350 && smoothed < 360);
  });

  it('joins current and upcoming route geometry without duplicate junction points', () => {
    assert.deepEqual(
      combineNavigationCameraPaths(
        [{ lat: 51.5, lon: -0.1 }, { lat: 51.501, lon: -0.1 }],
        [{ lat: 51.501, lon: -0.1 }, { lat: 51.501, lon: -0.098 }],
      ),
      [
        { lat: 51.5, lon: -0.1 },
        { lat: 51.501, lon: -0.1 },
        { lat: 51.501, lon: -0.098 },
      ],
    );
  });
});
