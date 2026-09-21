import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { HazardReport } from '@rider-comms/shared';
import {
  navigationHazardLabel,
  navigationHazardsAhead,
} from '../src/navigationRoadEvents.ts';

const route = [
  { lat: 51.5000, lon: -0.1000 },
  { lat: 51.5100, lon: -0.1000 },
];

const mapScreenSource = await readFile(new URL('../src/screens/MapScreen.tsx', import.meta.url), 'utf8');

function hazard(
  id: string,
  type: HazardReport['type'],
  lat: number,
  lon = -0.1000,
): HazardReport {
  return {
    id,
    type,
    lat,
    lon,
    reportedBy: 'rider-test',
    createdAt: 1,
    expiresAt: Number.MAX_SAFE_INTEGER,
    confirmations: 0,
    denials: 0,
  };
}

describe('route-ahead navigation hazard selection', () => {
  it('keeps nearby hazards ahead on the routed path and orders them by route distance', () => {
    const alerts = navigationHazardsAhead(
      { lat: 51.5020, lon: -0.1000 },
      route,
      [
        hazard('far-camera', 'camera', 51.5070),
        hazard('near-police', 'police', 51.5040),
      ],
    );

    assert.deepEqual(alerts.map((alert) => alert.hazard.id), ['near-police', 'far-camera']);
    assert.ok(alerts[0]!.distanceAheadMeters > 150 && alerts[0]!.distanceAheadMeters < 300);
    assert.ok(alerts[1]!.distanceAheadMeters > alerts[0]!.distanceAheadMeters);
  });

  it('rejects hazards behind the rider and hazards on nearby parallel roads outside the route corridor', () => {
    const alerts = navigationHazardsAhead(
      { lat: 51.5050, lon: -0.1000 },
      route,
      [
        hazard('behind', 'camera', 51.5020),
        hazard('parallel-road', 'police', 51.5070, -0.0988),
        hazard('ahead', 'accident', 51.5080),
      ],
    );

    assert.deepEqual(alerts.map((alert) => alert.hazard.id), ['ahead']);
  });

  it('suppresses route alerts while the current GPS fix is too far from the active route', () => {
    const alerts = navigationHazardsAhead(
      { lat: 51.5050, lon: -0.0975 },
      route,
      [hazard('camera', 'camera', 51.5070)],
    );

    assert.deepEqual(alerts, []);
  });

  it('keeps only the configured number of nearest route hazards', () => {
    const alerts = navigationHazardsAhead(
      { lat: 51.5010, lon: -0.1000 },
      route,
      [
        hazard('one', 'camera', 51.5020),
        hazard('two', 'police', 51.5030),
        hazard('three', 'hazard', 51.5040),
      ],
      { maxVisible: 2 },
    );

    assert.deepEqual(alerts.map((alert) => alert.hazard.id), ['one', 'two']);
  });

  it('allows only a small projection grace immediately after passing a report', () => {
    const alerts = navigationHazardsAhead(
      { lat: 51.5050, lon: -0.1000 },
      route,
      [
        hazard('projection-grace', 'camera', 51.50485),
        hazard('already-passed', 'police', 51.5045),
      ],
    );

    assert.deepEqual(alerts.map((alert) => alert.hazard.id), ['projection-grace']);
    assert.equal(alerts[0]!.distanceAheadMeters, 0);
  });

  it('does not surface route reports beyond the road-ahead lookahead window', () => {
    const longRoute = [
      { lat: 51.5000, lon: -0.1000 },
      { lat: 51.5500, lon: -0.1000 },
    ];
    const alerts = navigationHazardsAhead(
      { lat: 51.5000, lon: -0.1000 },
      longRoute,
      [
        hazard('within-window', 'road_closure', 51.5260),
        hazard('too-far', 'accident', 51.5310),
      ],
    );

    assert.deepEqual(alerts.map((alert) => alert.hazard.id), ['within-window']);
    assert.ok(alerts[0]!.distanceAheadMeters < 3_000);
  });

  it('uses explicit glanceable labels without implying provider-owned data', () => {
    assert.equal(navigationHazardLabel('camera'), 'Speed camera reported');
    assert.equal(navigationHazardLabel('police'), 'Police reported');
    assert.equal(navigationHazardLabel('road_closure'), 'Road closure reported');
  });

  it('does not turn the high-frequency navigation GPS watcher into a hazard API poll', () => {
    assert.match(mapScreenSource, /const HAZARD_REFRESH_INTERVAL_MS = 60_000/);
    assert.match(mapScreenSource, /const currentLocationRef = React\.useRef/);
    assert.match(mapScreenSource, /client\.getNearbyHazards\(location\.lat, location\.lon\)/);
    assert.match(mapScreenSource, /setInterval\(\(\) => void fetchHazards\(\), HAZARD_REFRESH_INTERVAL_MS\)/);
    assert.match(mapScreenSource, /\}, \[client, hasCurrentLocation\]\);/);
    assert.doesNotMatch(mapScreenSource, /setInterval\(fetchHazards, PRESENCE_UPDATE_INTERVAL_MS\)/);
  });

  it('measures the real navigation banner so road-ahead alerts cannot hide the route camera target', () => {
    assert.match(mapScreenSource, /navigationBannerHeightRef = React\.useRef\(136\)/);
    assert.match(mapScreenSource, /const topOcclusion = insets\.top \+ spacing\.sm \+ navigationBannerHeightRef\.current/);
    assert.match(mapScreenSource, /navigationBannerHeightRef\.current = Math\.ceil\(event\.nativeEvent\.layout\.height\)/);
  });
});
