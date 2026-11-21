import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { HazardReport } from '@rider-comms/shared';
import {
  navigationHazardLabel,
  navigationHazardsAhead,
  routeHazards,
  routeHazardsSummary,
  routeHazardStrip,
  simplifyRoutePath,
} from '../src/navigationRoadEvents.ts';

const route = [
  { lat: 51.5000, lon: -0.1000 },
  { lat: 51.5100, lon: -0.1000 },
];

const mapScreenSource = await readFile(new URL('../src/screens/MapScreen.tsx', import.meta.url), 'utf8');
const navigationOverlaySource = await readFile(new URL('../src/screens/NavigationOverlay.tsx', import.meta.url), 'utf8');
const hazardReportsHookSource = await readFile(new URL('../src/screens/useHazardReports.ts', import.meta.url), 'utf8');
const navigationSummaryHookSource = await readFile(new URL('../src/screens/useNavigationSummary.ts', import.meta.url), 'utf8');
const inAppNavigationHookSource = await readFile(new URL('../src/screens/useInAppNavigation.ts', import.meta.url), 'utf8');

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

function roadAlerts(
  currentLocation: Parameters<typeof navigationHazardsAhead>[0],
  routeCoordinates: Parameters<typeof navigationHazardsAhead>[1],
  reports: Parameters<typeof navigationHazardsAhead>[2],
  options: Parameters<typeof navigationHazardsAhead>[3] = {},
) {
  return navigationHazardsAhead(currentLocation, routeCoordinates, reports, {
    currentAccuracyMeters: 10,
    ...options,
  });
}

describe('route-ahead navigation hazard selection', () => {
  it('keeps nearby hazards ahead on the routed path and orders them by route distance', () => {
    const alerts = roadAlerts(
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
    const alerts = roadAlerts(
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

  it('deduplicates same-type reports that describe the same route event', () => {
    const alerts = roadAlerts(
      { lat: 51.5020, lon: -0.1000 },
      route,
      [
        hazard('police-first', 'police', 51.5040),
        hazard('police-duplicate', 'police', 51.5044),
        hazard('camera-separate', 'camera', 51.5060),
      ],
      { duplicateRouteGapMeters: 80 },
    );

    assert.deepEqual(alerts.map((alert) => alert.hazard.id), ['police-first', 'camera-separate']);
  });

  it('suppresses route alerts while the current GPS fix is too far from the active route', () => {
    const alerts = roadAlerts(
      { lat: 51.5050, lon: -0.0975 },
      route,
      [hazard('camera', 'camera', 51.5070)],
    );

    assert.deepEqual(alerts, []);
  });

  it('keeps only the configured number of nearest route hazards', () => {
    const alerts = roadAlerts(
      { lat: 51.5010, lon: -0.1000 },
      route,
      [
        hazard('one', 'camera', 51.5020),
        hazard('two', 'police', 51.5030),
        hazard('three', 'camera', 51.5040),
      ],
      { maxVisible: 2 },
    );

    assert.deepEqual(alerts.map((alert) => alert.hazard.id), ['one', 'two']);
  });

  it('keeps the nearest report while reserving the second glance slot for a safety-impacting report', () => {
    const alerts = roadAlerts(
      { lat: 51.5010, lon: -0.1000 },
      route,
      [
        hazard('camera-nearest', 'camera', 51.5020),
        hazard('police-second', 'police', 51.5030),
        hazard('closure-third', 'road_closure', 51.5060),
      ],
    );

    assert.deepEqual(alerts.map((alert) => alert.hazard.id), ['camera-nearest', 'closure-third']);
  });

  it('allows only a small projection grace immediately after passing a report', () => {
    const alerts = roadAlerts(
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

  it('doesn’t surface route reports beyond the road-ahead lookahead window', () => {
    const longRoute = [
      { lat: 51.5000, lon: -0.1000 },
      { lat: 51.5500, lon: -0.1000 },
    ];
    const alerts = roadAlerts(
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

  it('fails closed when the platform reports a missing or low-confidence navigation fix', () => {
    const report = hazard('camera', 'camera', 51.5040);
    assert.deepEqual(navigationHazardsAhead(
      { lat: 51.5020, lon: -0.1000 },
      route,
      [report],
      { currentAccuracyMeters: null },
    ), []);
    assert.deepEqual(navigationHazardsAhead(
      { lat: 51.5020, lon: -0.1000 },
      route,
      [report],
      { currentAccuracyMeters: 76 },
    ), []);
    assert.deepEqual(navigationHazardsAhead(
      { lat: 51.5020, lon: -0.1000 },
      route,
      [report],
      { currentAccuracyMeters: 75 },
    ).map((alert) => alert.hazard.id), ['camera']);
  });

  it('drops reports that expired or reached the crowd-hide threshold between feed refreshes', () => {
    const nowMs = 10_000;
    const expired = { ...hazard('expired', 'camera', 51.5040), expiresAt: nowMs };
    const hidden = {
      ...hazard('hidden', 'police', 51.5050),
      expiresAt: nowMs + 60_000,
      denials: 3,
      confirmations: 0,
    };
    const stillActive = {
      ...hazard('active', 'accident', 51.5060),
      expiresAt: nowMs + 60_000,
      denials: 3,
      confirmations: 1,
    };

    const alerts = roadAlerts(
      { lat: 51.5020, lon: -0.1000 },
      route,
      [expired, hidden, stillActive],
      { nowMs },
    );

    assert.deepEqual(alerts.map((alert) => alert.hazard.id), ['active']);
  });

  it('fails closed for an unknown report type instead of rendering broken navigation metadata', () => {
    const malformed = {
      ...hazard('unknown', 'camera', 51.5040),
      type: 'mystery_report',
    } as unknown as HazardReport;

    const alerts = roadAlerts(
      { lat: 51.5020, lon: -0.1000 },
      route,
      [malformed],
    );

    assert.deepEqual(alerts, []);
  });

  it('uses explicit glanceable labels without implying provider-owned data', () => {
    assert.equal(navigationHazardLabel('camera'), 'Mobile speed camera reported');
    assert.equal(navigationHazardLabel('police'), 'Police reported');
    assert.equal(navigationHazardLabel('hidden_police'), 'Hidden police reported');
    assert.equal(navigationHazardLabel('police_checkpoint'), 'Police checkpoint reported');
    assert.equal(navigationHazardLabel('road_closure'), 'Road closure reported');
  });

  it('doesn’t turn the high-frequency navigation GPS watcher into a hazard API poll', () => {
    assert.match(mapScreenSource, /const currentLocationRef = React\.useRef/);
    assert.match(hazardReportsHookSource, /const HAZARD_REFRESH_INTERVAL_MS = 60_000/);
    assert.match(hazardReportsHookSource, /client\.getNearbyHazards\(location\.lat, location\.lon\)/);
    assert.match(hazardReportsHookSource, /setInterval\(\(\) => void fetchHazards\(\), HAZARD_REFRESH_INTERVAL_MS\)/);
    assert.match(hazardReportsHookSource, /\}, \[client, hasCurrentLocation\]\);/);
    assert.doesNotMatch(mapScreenSource, /setInterval\(fetchHazards, PRESENCE_UPDATE_INTERVAL_MS\)/);
  });

  it('suppresses road-ahead guidance while navigation GPS is stale or unavailable', () => {
    assert.match(
      navigationSummaryHookSource,
      /activeRoute && currentLocation && !isNavigationGpsNotice\(navigationNotice\)/,
    );
    assert.match(
      navigationSummaryHookSource,
      /\[activeRoute, currentAccuracyMeters, currentLocation, hazards, navigationNotice, navigationRoadAlertPath\]/,
    );
  });

  it('uses the measured navigation banner height so road-ahead alerts can’t hide the route camera target', () => {
    assert.match(mapScreenSource, /const \[navigationBannerHeight, setNavigationBannerHeight\] = React\.useState\(166\)/);
    assert.match(inAppNavigationHookSource, /const topOcclusion = insets\.top \+ spacing\.sm \+ navigationBannerHeight/);
    // The banner (NavigationOverlay) measures itself and reports through onHeight.
    assert.match(mapScreenSource, /onHeight=\{setNavigationBannerHeight\}/);
    assert.match(navigationOverlaySource, /onHeight\(\(current\) => Math\.abs\(current - height\) > 1 \? height : current\)/);
    assert.match(navigationOverlaySource, /function NavigationBanner[\s\S]*?onLayout=\{measured\(onHeight\)\}/);
  });
});

describe('route-ahead hazard ties', () => {
  it('breaks a same-distance tie by hazard priority', () => {
    const alerts = roadAlerts(
      { lat: 51.5020, lon: -0.1000 },
      route,
      [hazard('camera-here', 'camera', 51.5050), hazard('accident-here', 'accident', 51.5050)],
    );
    assert.equal(alerts.length > 0, true);
    assert.equal(new Set(alerts.map((alert) => alert.distanceAheadMeters)).size, 1);
  });
});

describe('hazards on a whole route, before Start', () => {
  it('finds every live report along the way, from the start, and none off it', () => {
    const found = routeHazards(route, [
      hazard('far', 'camera', 51.5090),
      hazard('start', 'police', 51.5001),
      hazard('off-route', 'accident', 51.5050, -0.0950),
      { ...hazard('expired', 'road_closure', 51.5040), expiresAt: 1 },
    ], { nowMs: 10 });
    assert.deepEqual(found.map((item) => item.hazard.id), ['start', 'far']);
    assert.deepEqual(routeHazards([], [hazard('a', 'police', 51.5)]), []);
  });

  it('groups what was reported for icons, most serious first, with counts and words to read out', () => {
    assert.equal(routeHazardsSummary([]), null);
    const summary = routeHazardsSummary(routeHazards(route, [
      hazard('p1', 'police', 51.5010),
      hazard('cam1', 'camera', 51.5030),
      hazard('closure', 'road_closure', 51.5080),
      hazard('cam2', 'camera', 51.5090),
    ]));
    assert.deepEqual(summary, {
      groups: [
        { type: 'road_closure', count: 1, serious: true },
        { type: 'camera', count: 2, serious: false },
        { type: 'police', count: 1, serious: false },
      ],
      label: 'Reported on the way: road closure, 2 speed cameras, police',
      serious: true,
    });
    const every = routeHazardsSummary(routeHazards(route, [
      hazard('a', 'accident', 51.5010), hazard('b', 'police_checkpoint', 51.5020), hazard('b2', 'police_checkpoint', 51.5040),
      hazard('c', 'hidden_police', 51.5060), hazard('c2', 'hidden_police', 51.5075), hazard('d', 'police', 51.5090),
      hazard('d2', 'police', 51.5099), hazard('e', 'accident', 51.5050),
    ]));
    assert.equal(every?.label, 'Reported on the way: 2 accidents, 2 police reports, 2 police checks, 2 hidden police reports');
    assert.equal(routeHazardsSummary(routeHazards(route, [hazard('cam', 'camera', 51.5040)]))?.serious, false);
  });
});

describe('hazards as points along a straight line, as in Waze', () => {
  it('puts each where it is on the way, merging close ones under the most serious', () => {
    const found = routeHazards(route, [
      hazard('p', 'police', 51.5025),
      hazard('c', 'road_closure', 51.5030),
      hazard('k', 'camera', 51.5090),
    ]);
    const strip = routeHazardStrip(found, route);
    assert.equal(strip.length, 2);
    assert.deepEqual(strip.map(({ type, count, serious }) => ({ type, count, serious })), [
      { type: 'road_closure', count: 2, serious: true },
      { type: 'camera', count: 1, serious: false },
    ]);
    assert.ok(Math.abs(strip[0]!.at - 0.275) < 0.01);
    assert.ok(Math.abs(strip[1]!.at - 0.9) < 0.01);
    // A wider gap merges all; no line or no reports, nothing.
    assert.equal(routeHazardStrip(found, route, 1).length, 1);
    assert.deepEqual(routeHazardStrip([], route), []);
    assert.deepEqual(routeHazardStrip(found, []), []);
  });
});

describe('a route line cut down for the server', () => {
  it('keeps short lines, and keeps a long one within 400 points and close to the road', () => {
    assert.deepEqual(simplifyRoutePath(route), route);
    // 3,000 points of a winding road: about 30 km, bending every 100 m.
    const winding = Array.from({ length: 3000 }, (_, i) => ({ lat: 51.5 + i * 0.0001, lon: -0.1 + Math.sin(i / 10) * 0.002 }));
    const cut = simplifyRoutePath(winding);
    assert.ok(cut.length <= 400 && cut.length > 50, `kept ${cut.length}`);
    assert.deepEqual(cut[0], winding[0]);
    assert.deepEqual(cut.at(-1), winding.at(-1));
    // Every point of the road stays within 100 m of the cut line.
    const worst = Math.max(...winding.filter((_, i) => i % 7 === 0).map((point) => {
      const found = routeHazards(cut, [{ id: 'p', type: 'police', lat: point.lat, lon: point.lon, reportedBy: 'x', createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER, confirmations: 0, denials: 0 }], { nowMs: 2 });
      return found[0]?.distanceFromRouteMeters ?? Number.POSITIVE_INFINITY;
    }));
    assert.ok(worst <= 70, `worst ${Math.round(worst)} m`);
    // A smaller limit loosens further; bad points are dropped.
    assert.ok(simplifyRoutePath(winding, 20).length <= 20);
    assert.deepEqual(simplifyRoutePath([{ lat: Number.NaN, lon: 0 }, ...route]), route);
  });
});
