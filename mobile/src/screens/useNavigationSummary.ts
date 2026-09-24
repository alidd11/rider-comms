import * as React from 'react';
import type { HazardReport } from '@rider-comms/shared';
import { remainingDistanceOnPathMeters, type InAppNavigationRoute } from '../api/directions';
import type { NavigationTarget } from '../navigationLinks';
import { combineNavigationCameraPaths } from '../navigationCamera';
import { navigationManeuverAction } from '../navigationGuidance';
import { isNavigationGpsNotice } from '../navigationGpsHealth';
import { navigationHazardsAhead, type NavigationRouteHazard } from '../navigationRoadEvents';

export interface NavigationSummary {
  currentNavigationStep: InAppNavigationRoute['steps'][number] | null;
  upcomingNavigationStep: InAppNavigationRoute['steps'][number] | null;
  followingNavigationStep: InAppNavigationRoute['steps'][number] | null;
  navigationRoadAlerts: NavigationRouteHazard[];
  navigationGuidanceInstruction: string;
  navigationGlanceAction: string;
  distanceToCurrentStepEnd: number;
  remainingNavigationMeters: number;
  remainingNavigationSeconds: number;
}

/**
 * Pure derived state for the active in-app navigation step: which step is
 * current/upcoming/following, road-ahead hazard alerts along the remaining
 * route, and the rolled-up remaining distance/time for the summary bar.
 * No side effects, refs or imperative map calls -- everything here is a
 * plain computation from its inputs.
 */
export function useNavigationSummary(
  activeRoute: InAppNavigationRoute | null,
  navigationStepIndex: number,
  navigationDestination: NavigationTarget | null,
  currentLocation: { lat: number; lon: number } | null,
  navigationNotice: string | null,
  hazards: HazardReport[],
  currentAccuracyMeters: number | null,
): NavigationSummary {
  const currentNavigationStep = activeRoute?.steps[navigationStepIndex] ?? null;
  const upcomingNavigationStep = activeRoute?.steps[navigationStepIndex + 1] ?? null;
  const followingNavigationStep = activeRoute?.steps[navigationStepIndex + 2] ?? null;

  const navigationRoadAlertPath = React.useMemo(
    () => activeRoute
      ? combineNavigationCameraPaths(...activeRoute.steps.slice(navigationStepIndex).map((step) => step.coordinates))
      : [],
    [activeRoute, navigationStepIndex],
  );
  const navigationRoadAlerts = React.useMemo(
    () => activeRoute && currentLocation && !isNavigationGpsNotice(navigationNotice)
      ? navigationHazardsAhead(currentLocation, navigationRoadAlertPath, hazards, {
          currentAccuracyMeters,
        })
      : [],
    [activeRoute, currentAccuracyMeters, currentLocation, hazards, navigationNotice, navigationRoadAlertPath],
  );

  const navigationGuidanceInstruction = upcomingNavigationStep?.instruction
    ?? `Arrive at ${navigationDestination?.label ?? 'destination'}`;
  const navigationGlanceAction = navigationManeuverAction(upcomingNavigationStep?.maneuver ?? 'arrive');
  const distanceToCurrentStepEnd = currentNavigationStep && currentLocation
    ? remainingDistanceOnPathMeters(currentLocation, currentNavigationStep.coordinates)
    : currentNavigationStep?.distanceMeters ?? 0;
  const laterNavigationSteps = activeRoute?.steps.slice(navigationStepIndex + 1) ?? [];
  const remainingNavigationMeters = currentNavigationStep
    ? distanceToCurrentStepEnd + laterNavigationSteps.reduce((sum, step) => sum + step.distanceMeters, 0)
    : 0;
  const currentStepTimeRatio = currentNavigationStep?.distanceMeters
    ? Math.max(0, Math.min(1, distanceToCurrentStepEnd / currentNavigationStep.distanceMeters))
    : 0;
  const remainingNavigationSeconds = currentNavigationStep
    ? currentNavigationStep.durationSeconds * currentStepTimeRatio
      + laterNavigationSteps.reduce((sum, step) => sum + step.durationSeconds, 0)
    : 0;

  return {
    currentNavigationStep,
    upcomingNavigationStep,
    followingNavigationStep,
    navigationRoadAlerts,
    navigationGuidanceInstruction,
    navigationGlanceAction,
    distanceToCurrentStepEnd,
    remainingNavigationMeters,
    remainingNavigationSeconds,
  };
}
