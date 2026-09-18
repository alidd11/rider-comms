export const NAV_GPS_STALE_AFTER_MS = 12_000;
export const NAV_GPS_CHECK_INTERVAL_MS = 2_000;

export type NavigationGpsHealth = 'healthy' | 'stale' | 'unavailable' | 'permission-denied';

export const NAV_GPS_STALE_NOTICE = 'GPS signal lost. Keep following the route with caution.';
export const NAV_GPS_UNAVAILABLE_NOTICE = 'Live GPS tracking is unavailable. Keep following the route with caution.';
export const NAV_GPS_PERMISSION_NOTICE = 'Location access was removed. Navigation is paused until location access is restored.';

export function navigationGpsNotice(health: NavigationGpsHealth): string | null {
  switch (health) {
    case 'stale':
      return NAV_GPS_STALE_NOTICE;
    case 'unavailable':
      return NAV_GPS_UNAVAILABLE_NOTICE;
    case 'permission-denied':
      return NAV_GPS_PERMISSION_NOTICE;
    default:
      return null;
  }
}

export function isNavigationGpsNotice(value: string | null): boolean {
  return value === NAV_GPS_STALE_NOTICE
    || value === NAV_GPS_UNAVAILABLE_NOTICE
    || value === NAV_GPS_PERMISSION_NOTICE;
}

export class NavigationGpsTracker {
  private health: NavigationGpsHealth = 'healthy';
  private lastFixAt = 0;

  begin(now = Date.now()): void {
    this.health = 'healthy';
    this.lastFixAt = now;
  }

  reset(): void {
    this.health = 'healthy';
    this.lastFixAt = 0;
  }

  recordFix(now = Date.now()): boolean {
    const recovered = this.health !== 'healthy';
    this.health = 'healthy';
    this.lastFixAt = now;
    return recovered;
  }

  markUnavailable(permissionDenied = false): NavigationGpsHealth {
    this.health = permissionDenied ? 'permission-denied' : 'unavailable';
    return this.health;
  }

  stateAt(now = Date.now()): NavigationGpsHealth {
    if (this.health === 'healthy' && this.lastFixAt > 0 && now - this.lastFixAt > NAV_GPS_STALE_AFTER_MS) {
      this.health = 'stale';
    }
    return this.health;
  }
}
