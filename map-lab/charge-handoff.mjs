// Offline research-only Maps → Tolls identity handoff (schema v1).
// Produces NO charge observations, road matching, entitlement, quote or route verdict.
import { validateResearchGraphSnapshot, VEHICLE_PROFILES } from './multi-vehicle-routing.mjs';

export const MAPS_CHARGE_HANDOFF_RELEASED = false;
const ROUTE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const CHARGE_CLASS = Object.freeze({
  car: 'car',
  motorcycle_small: 'motorcycle',
  motorcycle_large: 'motorcycle',
});
const KEYS = new Set(['routeId', 'revision', 'vehicleCategory', 'graphSnapshot']);
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/**
 * Build a versioned *identity only* for the unreleased Tolls snapshot checker.
 * A declared graph checksum is not proof that graph bytes or road traversals
 * are authentic. Motorcycle categorisation is likewise NOT vehicle eligibility.
 * Moped/scooter charge classification is unresolved: fail closed, never coerce.
 */
export function draftMapsChargeIdentity(input) {
  if (!record(input) || Object.keys(input).some(key => !KEYS.has(key))) {
    throw new TypeError('Unsupported Maps-to-Tolls research input');
  }
  if (typeof input.routeId !== 'string' || !ROUTE_TOKEN.test(input.routeId)
    || !Number.isSafeInteger(input.revision) || input.revision < 0) {
    throw new TypeError('Stable route identity and nonnegative revision required');
  }
  if (!Object.hasOwn(VEHICLE_PROFILES, input.vehicleCategory)) {
    throw new TypeError('Explicit supported route vehicle category required');
  }
  const snapshot = validateResearchGraphSnapshot(input.graphSnapshot);
  // The charging checker accepts a narrower profile token than the Maps graph
  // metadata. Do not emit a handoff which it would reject.
  if (!ROUTE_TOKEN.test(snapshot.graph.profileRevision)) {
    throw new TypeError('Incompatible routing profile revision token');
  }
  const assurance = {
    graphSourceBytesVerified: false,
    graphBuildBytesVerified: false,
    chargeRoadCorrespondenceVerified: false,
    vehicleEligibilityVerified: false,
    routeCoverageComplete: false,
    chargingRulesVerified: false,
    tollFreeRouteVerified: false,
    productionApproved: false,
    navigationReady: false,
  };
  const vehicleClass = CHARGE_CLASS[input.vehicleCategory];
  if (!vehicleClass) {
    return { status: 'needs_scheme_specific_vehicle_review', identity: null, assurance };
  }
  return {
    status: 'research_identity_only',
    identity: {
      schemaVersion: 1,
      routeId: input.routeId,
      revision: input.revision,
      graphBuildSha256: snapshot.graph.buildSha256,
      profileRevision: snapshot.graph.profileRevision,
      vehicleClass,
    },
    assurance,
  };
}
