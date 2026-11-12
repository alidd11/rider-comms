import type { VehicleCategory } from '@rider-comms/shared';

// Device preferences from Settings → Voice and sound and Vehicle details.
// The PWA keeps the same values in its local state (spokenDirections,
// vehicleCategory).

export const DEFAULT_SPOKEN_DIRECTIONS = true;
export function spokenDirectionsStorageKey(riderId: string): string {
  return `@rider-comms/settings/spoken-directions/${riderId}`;
}
export function parseSpokenDirections(value: string | null): boolean {
  return value === null ? DEFAULT_SPOKEN_DIRECTIONS : value !== 'false';
}

/** What the rider rides; curated routes are filtered to suit it. */
export type RiderVehicle = VehicleCategory;
export const DEFAULT_RIDER_VEHICLE: RiderVehicle = 'motorcycle_large';
export type RiderVehicleGroup = 'Motorcycles' | 'Cars and vans';
/** Every choice with its group, in Settings order (PWA: RIDER_VEHICLE_OPTIONS). */
export const RIDER_VEHICLE_OPTIONS: ReadonlyArray<readonly [RiderVehicle, string, RiderVehicleGroup]> = [
  ['motorcycle_large', 'Motorcycle', 'Motorcycles'],
  ['motorcycle_small', 'Small motorcycle (up to 125cc)', 'Motorcycles'],
  ['scooter', 'Scooter or moped', 'Motorcycles'],
  ['car', 'Car', 'Cars and vans'],
  ['van', 'Van or motorhome', 'Cars and vans'],
];
export const RIDER_VEHICLE_GROUPS: readonly RiderVehicleGroup[] = ['Motorcycles', 'Cars and vans'];
export function riderVehicleLabel(vehicle: RiderVehicle): string {
  return RIDER_VEHICLE_OPTIONS.find(([option]) => option === vehicle)?.[1] ?? '';
}
export function riderVehicleStorageKey(riderId: string): string {
  return `@rider-comms/settings/vehicle/${riderId}`;
}
export function parseRiderVehicle(value: string | null): RiderVehicle {
  return RIDER_VEHICLE_OPTIONS.some(([option]) => option === value) ? value as RiderVehicle : DEFAULT_RIDER_VEHICLE;
}
