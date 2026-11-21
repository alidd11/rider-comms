/**
 * Unreleased, offline-only adapter between a Rider Comms vehicle selection
 * and the coarse charging-rule vehicle classes.
 *
 * A category selected in Settings is NEVER evidence of emission compliance,
 * toll exemption, permitted road use, engine registration or verified weight.
 * Do not use a vehicle choice to mark any charging scheme as free of charge.
 */
import type { VehicleCategory } from '@rider-comms/shared';
import type { ChargeVehicleClass } from './chargingRules.ts';
import {
  summarizeRouteChargePassages,
  type RouteChargePassage,
  type RouteChargeSummary,
} from './routeChargeSummary.ts';

const CHARGE_CLASS_BY_VEHICLE: Readonly<Record<VehicleCategory, ChargeVehicleClass>> = Object.freeze({
  motorcycle_large: 'motorcycle',
  motorcycle_small: 'motorcycle',
  scooter: 'motorcycle',
  car: 'car',
  van: 'van',
});

export interface RiderVehicleClassification {
  selection: VehicleCategory;
  chargeClass: ChargeVehicleClass;
  /** A user-selected vehicle is never sufficient to verify road-charge eligibility. */
  officialEligibilityVerified: false;
}

/** Unrecognised or absent vehicle selection fails closed, never defaults to a motorcycle. */
export function classifyRiderVehicleForCharging(selection: unknown): RiderVehicleClassification | null {
  if (typeof selection !== 'string'
    || !Object.hasOwn(CHARGE_CLASS_BY_VEHICLE, selection)) return null;
  const vehicleCategory = selection as VehicleCategory;
  return {
    selection: vehicleCategory,
    chargeClass: CHARGE_CLASS_BY_VEHICLE[vehicleCategory],
    officialEligibilityVerified: false,
  };
}

export type RiderChargePreview =
  | {
      status: 'unknown_vehicle';
      classification: null;
      summary: null;
      requiresOfficialVehicleCheck: true;
    }
  | {
      status: 'advisory_only';
      classification: RiderVehicleClassification;
      summary: RouteChargeSummary;
      requiresOfficialVehicleCheck: true;
    };

/**
 * Demonstrates how a future caller can use existing route observations with
 * a validated rider selection. Never connected to live routing, Google APIs,
 * toll quotes, or the user's self-declared exemption toggles.
 */
export function previewRiderChargeExposure(
  vehicleSelection: unknown,
  passageEvidence: readonly RouteChargePassage[],
): RiderChargePreview {
  const classification = classifyRiderVehicleForCharging(vehicleSelection);
  if (!classification) {
    return {
      status: 'unknown_vehicle', classification: null, summary: null,
      requiresOfficialVehicleCheck: true,
    };
  }
  return {
    status: 'advisory_only', classification,
    summary: summarizeRouteChargePassages(classification.chargeClass, passageEvidence),
    requiresOfficialVehicleCheck: true,
  };
}
