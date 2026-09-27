import { renderHook } from '@testing-library/react-native';
import type { HazardReport } from '@rider-comms/shared';
import { remainingDistanceOnPathMeters, type InAppNavigationRoute, type RouteCoordinate } from '../../src/api/directions';
import { navigationManeuverAction } from '../../src/navigationGuidance';
import { NAV_GPS_STALE_NOTICE } from '../../src/navigationGpsHealth';
import { useNavigationSummary } from '../../src/screens/useNavigationSummary';

function point(lat: number, lon: number): RouteCoordinate {
  return { lat, lon };
}

const STEP_0_COORDS = [point(0, 0), point(0, 0.001), point(0, 0.002)];
const STEP_1_COORDS = [point(0, 0.002), point(0, 0.0035), point(0, 0.005)];
const STEP_2_COORDS = [point(0, 0.005)];

const ROUTE: InAppNavigationRoute = {
  coordinates: [...STEP_0_COORDS, ...STEP_1_COORDS.slice(1)],
  distanceMeters: 500,
  durationSeconds: 75,
  steps: [
    {
      instruction: 'Turn right onto Main St',
      maneuver: 'turn-right',
      distanceMeters: 200,
      durationSeconds: 30,
      start: STEP_0_COORDS[0]!,
      end: STEP_0_COORDS[2]!,
      coordinates: STEP_0_COORDS,
    },
    {
      instruction: 'Continue onto Elm St',
      maneuver: 'straight',
      distanceMeters: 300,
      durationSeconds: 45,
      start: STEP_1_COORDS[0]!,
      end: STEP_1_COORDS[2]!,
      coordinates: STEP_1_COORDS,
    },
    {
      instruction: 'Arrive at destination',
      maneuver: 'arrive',
      distanceMeters: 0,
      durationSeconds: 0,
      start: STEP_2_COORDS[0]!,
      end: STEP_2_COORDS[0]!,
      coordinates: STEP_2_COORDS,
    },
  ],
};

const DESTINATION = { lat: 0, lon: 0.005, label: 'Home' };

function hazard(id: string, lat: number, lon: number): HazardReport {
  return {
    id,
    type: 'accident',
    lat,
    lon,
    reportedBy: 'rider-1',
    createdAt: 0,
    expiresAt: Number.MAX_SAFE_INTEGER,
    confirmations: 1,
    denials: 0,
  };
}

test('reports the current/upcoming/following steps and rolls up the remaining distance and time', async () => {
  const currentLocation = STEP_0_COORDS[0]!;
  const { result } = await renderHook(() => useNavigationSummary(
    ROUTE, 0, DESTINATION, currentLocation, null, [], null,
  ));

  const expectedDistanceToStepEnd = remainingDistanceOnPathMeters(currentLocation, STEP_0_COORDS);
  const expectedRatio = Math.max(0, Math.min(1, expectedDistanceToStepEnd / ROUTE.steps[0]!.distanceMeters));

  expect(result.current.currentNavigationStep).toBe(ROUTE.steps[0]);
  expect(result.current.upcomingNavigationStep).toBe(ROUTE.steps[1]);
  expect(result.current.followingNavigationStep).toBe(ROUTE.steps[2]);
  expect(result.current.navigationGuidanceInstruction).toBe('Continue onto Elm St');
  expect(result.current.navigationGlanceAction).toBe(navigationManeuverAction('straight'));
  expect(result.current.distanceToCurrentStepEnd).toBeCloseTo(expectedDistanceToStepEnd);
  expect(result.current.remainingNavigationMeters).toBeCloseTo(expectedDistanceToStepEnd + 300 + 0);
  expect(result.current.remainingNavigationSeconds).toBeCloseTo(30 * expectedRatio + 45 + 0);
});

test('falls back to an arrival instruction naming the destination on the final step', async () => {
  const currentLocation = STEP_2_COORDS[0]!;
  const { result } = await renderHook(() => useNavigationSummary(
    ROUTE, 2, DESTINATION, currentLocation, null, [], null,
  ));

  expect(result.current.upcomingNavigationStep).toBeNull();
  expect(result.current.followingNavigationStep).toBeNull();
  expect(result.current.navigationGuidanceInstruction).toBe('Arrive at Home');
  expect(result.current.navigationGlanceAction).toBe(navigationManeuverAction('arrive'));
  expect(result.current.remainingNavigationMeters).toBe(0);
  expect(result.current.remainingNavigationSeconds).toBe(0);
});

test('falls back to a generic destination label when none is given, and zeroes everything with no active route', async () => {
  const { result } = await renderHook(() => useNavigationSummary(
    null, 0, null, null, null, [], null,
  ));

  expect(result.current.currentNavigationStep).toBeNull();
  expect(result.current.navigationGuidanceInstruction).toBe('Arrive at destination');
  expect(result.current.navigationGlanceAction).toBe(navigationManeuverAction('arrive'));
  expect(result.current.distanceToCurrentStepEnd).toBe(0);
  expect(result.current.remainingNavigationMeters).toBe(0);
  expect(result.current.remainingNavigationSeconds).toBe(0);
  expect(result.current.navigationRoadAlerts).toEqual([]);
});

test('surfaces a hazard sitting on the remaining route ahead', async () => {
  const currentLocation = STEP_0_COORDS[0]!;
  const hazardOnRoute = hazard('h1', STEP_1_COORDS[1]!.lat, STEP_1_COORDS[1]!.lon);
  const { result } = await renderHook(() => useNavigationSummary(
    ROUTE, 0, DESTINATION, currentLocation, null, [hazardOnRoute], 5,
  ));

  expect(result.current.navigationRoadAlerts.map((alert) => alert.hazard.id)).toContain('h1');
});

test('suppresses road alerts while a GPS health notice is showing', async () => {
  const currentLocation = STEP_0_COORDS[0]!;
  const hazardOnRoute = hazard('h1', STEP_1_COORDS[1]!.lat, STEP_1_COORDS[1]!.lon);
  const { result } = await renderHook(() => useNavigationSummary(
    ROUTE, 0, DESTINATION, currentLocation, NAV_GPS_STALE_NOTICE, [hazardOnRoute], 5,
  ));

  expect(result.current.navigationRoadAlerts).toEqual([]);
});
