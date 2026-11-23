// Offline-only research contract. Never import this into released navigation.
// Request drafts cannot establish legal road access, motorway eligibility,
// charge exemptions, reliable ETA, or navigable routes.
import { draftValhallaMotorcycleRequest } from './valhalla-request.mjs';

export const MULTI_VEHICLE_ROUTING_RELEASED = false;
export const VEHICLE_PROFILES = Object.freeze({
  car: 'auto',
  motorcycle_small: 'motorcycle',
  motorcycle_large: 'motorcycle',
  moped: 'motor_scooter',
  scooter: 'motor_scooter',
});

const SHA = /^[a-f0-9]{64}$/;
const VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/;
const INPUT_FIELDS = new Set([
  'vehicleCategory', 'coordinates', 'scooterTopSpeedKph',
  'avoidHighways', 'avoidTolls', 'avoidFerries', 'graphSnapshot',
]);

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function ownKeysOnly(object, keys) {
  if (!record(object)) throw new TypeError('Expected a plain record');
  for (const key of Object.keys(object)) {
    if (!keys.includes(key)) throw new TypeError('Unexpected field: ' + key);
  }
}
function utc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value.replace(/Z$/, '.000Z');
}

/**
 * Validate declared PBF/graph build identities, NOT that the bytes are genuine.
 * A graph rebuild requires a new checksum and invalidates prior traversals.
 */
export function validateResearchGraphSnapshot(input) {
  ownKeysOnly(input, ['source', 'graph', 'region']);
  const { source, graph, region } = input;
  ownKeysOnly(source, ['url', 'sha256', 'downloadedAtUtc', 'license']);
  ownKeysOnly(graph, ['engine', 'version', 'buildSha256', 'sourceSha256', 'profileRevision']);
  ownKeysOnly(region, ['name', 'bounds']);
  if (typeof source.url !== 'string'
    || !/^https:\/\/download\.geofabrik\.de\/[a-z0-9/_-]+\.osm\.pbf$/.test(source.url)
    || !SHA.test(source.sha256) || !utc(source.downloadedAtUtc)
    || source.license !== 'ODbL-1.0'
    || graph.engine !== 'valhalla' || !VERSION.test(graph.version ?? '')
    || !VERSION.test(graph.profileRevision ?? '')
    || !SHA.test(graph.buildSha256 ?? '')
    || graph.sourceSha256 !== source.sha256
    || typeof region.name !== 'string' || !/^[a-zA-Z0-9 -]{2,64}$/.test(region.name)
    || !Array.isArray(region.bounds) || region.bounds.length !== 4
    || !region.bounds.every(Number.isFinite)
    || region.bounds[0] < -180 || region.bounds[2] > 180
    || region.bounds[1] < -90 || region.bounds[3] > 90
    || region.bounds[0] >= region.bounds[2] || region.bounds[1] >= region.bounds[3]) {
    throw new Error('Invalid or mismatched regional graph source manifest');
  }
  return {
    source: { url: source.url, sha256: source.sha256,
      downloadedAtUtc: source.downloadedAtUtc, license: source.license },
    graph: { engine: 'valhalla', version: graph.version,
      buildSha256: graph.buildSha256, sourceSha256: source.sha256,
      profileRevision: graph.profileRevision },
    region: { name: region.name, bounds: [...region.bounds] },
    manifestValidated: true,
    downloadedPbfVerified: false,
    builtGraphVerified: false,
  };
}

/** Offline draft for car, motorcycle, moped or scooter. No service calls. */
export function draftMultiVehicleRoute(input) {
  if (!record(input)) throw new TypeError('Routing input must be a plain record');
  for (const key of Object.keys(input)) {
    if (!INPUT_FIELDS.has(key)) throw new Error('Unsupported routing field: ' + key);
  }
  const { vehicleCategory, coordinates, scooterTopSpeedKph,
    avoidHighways = false, avoidTolls = false, avoidFerries = false,
    graphSnapshot } = input;
  if (!Object.hasOwn(VEHICLE_PROFILES, vehicleCategory)) {
    throw new Error('Explicit supported vehicle category required');
  }
  for (const option of [avoidHighways, avoidTolls, avoidFerries]) {
    if (typeof option !== 'boolean') throw new TypeError('Avoid preferences must be booleans');
  }
  const graph = validateResearchGraphSnapshot(graphSnapshot);
  let request;
  if (vehicleCategory === 'car') {
    if (scooterTopSpeedKph !== undefined) throw new Error('Car must not have scooter speed');
    if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 8) {
      throw new RangeError('Route must have 2–8 coordinates');
    }
    const locations = coordinates.map((point) => {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)
        || point[0] < -180 || point[0] > 180 || point[1] < -90 || point[1] > 90) {
        throw new RangeError('Invalid WGS84 coordinate');
      }
      return { lat: point[1], lon: point[0] };
    });
    if (locations.every((v) => v.lat === locations[0].lat && v.lon === locations[0].lon)) {
      throw new RangeError('Route needs distinct locations');
    }
    const options = {};
    if (avoidHighways) options.use_highways = 0;
    if (avoidTolls) options.use_tolls = 0;
    if (avoidFerries) options.use_ferry = 0;
    request = { locations, costing: 'auto', costing_options: { auto: options } };
  } else {
    const mappedCategory = vehicleCategory === 'moped' ? 'scooter' : vehicleCategory;
    const draft = draftValhallaMotorcycleRequest({
      vehicleCategory: mappedCategory, coordinates, scooterTopSpeedKph,
      avoidHighways, avoidTolls, avoidFerries,
    });
    request = draft.request;
  }
  return {
    vehicleCategory,
    request,
    graph,
    assurance: {
      source: 'openstreetmap', engine: 'valhalla',
      networkRequestMade: false, downloadedPbfVerified: false,
      builtGraphVerified: false, legalRoadAccessVerified: false,
      motorwayEligibilityVerified: false, tollExemptionVerified: false,
      chargeFreeRouteVerified: false, laneAccessVerified: false,
      trafficAvailable: false, navigationReady: false,
      avoidPreferencesAreHardRestrictions: false,
    },
  };
}
