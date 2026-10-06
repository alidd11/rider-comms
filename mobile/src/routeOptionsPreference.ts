/** Rider route options, kept on the device like the navigation provider. */
export interface RouteAvoidance {
  highways: boolean;
  tolls: boolean;
}

export const DEFAULT_ROUTE_AVOIDANCE: RouteAvoidance = { highways: false, tolls: false };

export function routeAvoidanceStorageKey(riderId: string): string {
  return `@rider-comms/settings/route-avoidance/${riderId}`;
}

export function parseRouteAvoidance(value: string | null): RouteAvoidance {
  if (!value) return DEFAULT_ROUTE_AVOIDANCE;
  try {
    const parsed = JSON.parse(value) as { highways?: unknown; tolls?: unknown };
    return { highways: parsed?.highways === true, tolls: parsed?.tolls === true };
  } catch {
    return DEFAULT_ROUTE_AVOIDANCE;
  }
}
