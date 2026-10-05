import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  combineNavigationCameraPaths,
  navigationCameraAltitudeMeters,
  navigationCameraProfile,
  navigationCentreAheadMeters,
  offsetAlongHeading,
  stabilizeNavigationHeading,
} from '../src/navigationCamera.ts';

describe('adaptive navigation camera', () => {
  it('shows progressively more road as speed rises', () => {
    const stopped = navigationCameraProfile({ speedMps: 0 });
    const city = navigationCameraProfile({ speedMps: 10 });
    const fast = navigationCameraProfile({ speedMps: 27 });

    assert.ok(stopped.zoom > city.zoom && city.zoom > fast.zoom);
    assert.ok(stopped.lookAheadMeters < city.lookAheadMeters && city.lookAheadMeters < fast.lookAheadMeters);
  });

  it('uses the normal city profile when GPS speed is unavailable', () => {
    assert.deepEqual(
      navigationCameraProfile({ speedMps: null }),
      { zoom: 18.4, pitch: 60, lookAheadMeters: 165 },
    );
  });

  it('pulls back and flattens for an approaching complex junction', () => {
    const ordinary = navigationCameraProfile({ speedMps: 10, maneuverDistanceMeters: 90, maneuver: 'turn-right' });
    const roundabout = navigationCameraProfile({ speedMps: 10, maneuverDistanceMeters: 90, maneuver: 'roundabout-right' });

    assert.ok(roundabout.zoom < ordinary.zoom);
    assert.ok(roundabout.pitch < ordinary.pitch);
    assert.ok(roundabout.lookAheadMeters > ordinary.lookAheadMeters);
  });

  it('keeps the rider in the clear map between the banner and the trip summary', () => {
    // The layout from a rider's screenshot: an iPhone 15 Pro Max map with a
    // tall banner (route notice showing) and the trip summary at the bottom.
    // The old fixed-metre offset put the marker under the summary.
    const viewportHeight = 932;
    const topOcclusion = 269;
    const bottomOcclusion = 117;
    const zoom = 18.9;
    const pitch = 50.4;
    const ahead = navigationCentreAheadMeters({ viewportHeight, topOcclusion, bottomOcclusion, zoom, pitch, latitude: 51.5 });

    // Project the rider back onto the screen with the same camera model
    // and check where they land.
    const metresPerPoint = (156_543.033_92 * Math.cos((51.5 * Math.PI) / 180)) / 2 ** zoom;
    const groundOffset = ahead / metresPerPoint;
    const cameraDistance = viewportHeight * 1.5;
    const tilt = (pitch * Math.PI) / 180;
    const riderY = viewportHeight / 2
      + (cameraDistance * groundOffset * Math.cos(tilt)) / (cameraDistance - groundOffset * Math.sin(tilt));
    const visibleBottom = viewportHeight - bottomOcclusion;
    assert.ok(riderY > topOcclusion + 100, `rider at ${riderY} is too close to the banner`);
    assert.ok(riderY < visibleBottom - 100, `rider at ${riderY} is too close to the trip summary`);
    assert.ok(Math.abs(riderY - (topOcclusion + (visibleBottom - topOcclusion) * 0.7)) < 0.5);
    assert.ok(ahead > 0 && ahead < 60, `centre ${ahead} m ahead`);
  });

  it('centres on the rider when nothing covers the map and the view is flat', () => {
    const ahead = navigationCentreAheadMeters({ viewportHeight: 800, topOcclusion: 0, bottomOcclusion: 0, zoom: 18, pitch: 0, latitude: 0 });
    // 0.7 of the way down an uncovered 800pt map is 160pt below centre.
    const metresPerPoint = 156_543.033_92 / 2 ** 18;
    assert.ok(Math.abs(ahead - 160 * metresPerPoint) < 1e-9);
  });

  it('pulls the centre back behind the rider when the banner covers most of the top', () => {
    const ahead = navigationCentreAheadMeters({ viewportHeight: 800, topOcclusion: 560, bottomOcclusion: 0, zoom: 18, pitch: 50, latitude: 51 });
    assert.ok(ahead > 0);
    const behind = navigationCentreAheadMeters({ viewportHeight: 800, topOcclusion: 0, bottomOcclusion: 600, zoom: 18, pitch: 50, latitude: 51 });
    assert.ok(behind < 0, 'a tall bottom stack puts the rider above the centre');
  });

  it('falls back to the whole map when almost none of it is clear', () => {
    const squeezed = navigationCentreAheadMeters({ viewportHeight: 390, topOcclusion: 200, bottomOcclusion: 150, zoom: 18, pitch: 50, latitude: 51 });
    const open = navigationCentreAheadMeters({ viewportHeight: 390, topOcclusion: 0, bottomOcclusion: 0, zoom: 18, pitch: 50, latitude: 51 });
    assert.equal(squeezed, open);
    assert.equal(navigationCentreAheadMeters({ viewportHeight: 0, topOcclusion: 0, bottomOcclusion: 0, zoom: 18, pitch: 50, latitude: 51 }), 0);
  });

  it('gives Apple Maps an altitude that tracks zoom and pitch', () => {
    const base = { viewportHeight: 844, latitude: 51.5 };
    const close = navigationCameraAltitudeMeters({ ...base, zoom: 18.8, pitch: 0 });
    const far = navigationCameraAltitudeMeters({ ...base, zoom: 17.8, pitch: 0 });
    assert.ok(Math.abs(far / close - 2) < 1e-9, 'one zoom level doubles the altitude');
    // Street level for a phone: a few hundred metres up.
    assert.ok(close > 100 && close < 400, `altitude ${close}`);
    const pitched = navigationCameraAltitudeMeters({ ...base, zoom: 18.8, pitch: 60 });
    assert.ok(Math.abs(pitched / close - 0.5) < 1e-9);
  });

  it('offsets along a heading by the requested distance', () => {
    const north = offsetAlongHeading(51.5, -0.1, 0, 100);
    assert.ok(Math.abs((north.lat - 51.5) * 111_320 - 100) < 1e-6);
    assert.equal(north.lng, -0.1);
    const east = offsetAlongHeading(51.5, -0.1, 90, 100);
    assert.ok(Math.abs((east.lng + 0.1) * 111_320 * Math.cos((51.5 * Math.PI) / 180) - 100) < 1e-6);
    assert.ok(Math.abs(east.lat - 51.5) < 1e-12);
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
