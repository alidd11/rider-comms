export const DEFAULT_RIDE_SAFE_ENABLED = true;

export function rideSafeStorageKey(riderId: string): string {
  return `@rider-comms/settings/ride-safe/${riderId}`;
}

export function parseRideSafeEnabled(value: string | null): boolean {
  return value === null ? DEFAULT_RIDE_SAFE_ENABLED : value !== 'false';
}
