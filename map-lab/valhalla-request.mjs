// Offline, unshipped research helper. This module has no HTTP client, API
// endpoint, map marker access or connection to the live navigation engine.
// A Valhalla request draft is NOT proof of UK motorcycling road legality.
export const VALHALLA_MOTORCYCLE_ROUTING_ENABLED = false;

const VEHICLE_COSTING = Object.freeze({
  motorcycle_large: 'motorcycle',
  motorcycle_small: 'motorcycle',
  scooter: 'motor_scooter',
});
const ALLOWED_KEYS = new Set([
  'vehicleCategory', 'coordinates', 'scooterTopSpeedKph',
  'avoidHighways', 'avoidTolls', 'avoidFerries',
]);
export const MAX_RESEARCH_ROUTE_LOCATIONS = 8;

/**
 * Build a strictly bounded, network-free Valhalla JSON request.
 * Coordinates are Rider Comms' [longitude, latitude] order. The research
 * output uses Valhalla's {lat, lon} order and never handles Google geometry.
 *
 * 'scooter' covers both mopeds and larger scooters in Rider Comms. Do not
 * silently assume Valhalla's 45 km/h motor_scooter default. An explicit
 * verified top speed is required before producing even a research draft.
 *
 * Avoid preferences are soft cost preferences, NOT a guarantee that a road,
 * toll or ferry is absent. This result MUST NOT be handed to navigation.
 */
export function draftValhallaMotorcycleRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Routing research input must be a plain object');
  }
  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(key)) throw new Error('Unsupported research routing field: ' + key);
  }
  const { vehicleCategory, coordinates, scooterTopSpeedKph, avoidHighways = false,
    avoidTolls = false, avoidFerries = false } = input;
  if (!Object.hasOwn(VEHICLE_COSTING, vehicleCategory)) {
    throw new Error('Only explicit motorcycle and scooter categories are supported');
  }
  for (const flag of [avoidHighways, avoidTolls, avoidFerries]) {
    if (typeof flag !== 'boolean') throw new TypeError('Avoid preferences must be booleans');
  }
  if (!Array.isArray(coordinates) || coordinates.length < 2
      || coordinates.length > MAX_RESEARCH_ROUTE_LOCATIONS) {
    throw new RangeError('Research route must have between 2 and 8 coordinates');
  }
  const locations = coordinates.map((point) => {
    if (!Array.isArray(point) || point.length !== 2
        || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
        || point[0] < -180 || point[0] > 180
        || point[1] < -90 || point[1] > 90) {
      throw new RangeError('Coordinate must be a finite [longitude, latitude] pair');
    }
    return { lat: point[1], lon: point[0] };
  });
  if (locations.every((location) => location.lat === locations[0].lat
      && location.lon === locations[0].lon)) {
    throw new RangeError('Research route needs distinct locations');
  }

  const costing = VEHICLE_COSTING[vehicleCategory];
  const options = { use_trails: 0 };
  if (costing === 'motor_scooter') {
    if (!Number.isFinite(scooterTopSpeedKph)
        || scooterTopSpeedKph < 20 || scooterTopSpeedKph > 120) {
      throw new RangeError('Scooter top speed must be explicitly confirmed (20–120 km/h)');
    }
    delete options.use_trails; // Scooter costing has no motorcycle use_trails option.
    options.top_speed = scooterTopSpeedKph;
  } else if (scooterTopSpeedKph !== undefined) {
    throw new Error('Scooter-specific speed cannot be supplied for motorcycles');
  }
  if (avoidHighways) options.use_highways = 0;
  if (avoidTolls) options.use_tolls = 0;
  if (avoidFerries) options.use_ferry = 0;

  return {
    request: {
      locations,
      costing,
      costing_options: { [costing]: options },
    },
    assurance: {
      dataProvider: 'openstreetmap',
      engine: 'valhalla',
      networkRequestMade: false,
      legalRoadAccessVerified: false,
      tollExemptionVerified: false,
      trafficAvailable: false,
      navigationReady: false,
    },
  };
}
