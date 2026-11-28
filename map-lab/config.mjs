// Research-only Rider Comms Maps configuration. Nothing imports this in the live app.
export const RIDER_MAPS_RELEASED = false;
export const MAP_STYLE_URLS = Object.freeze({
  day: 'https://tiles.openfreemap.org/styles/bright',
  night: 'https://tiles.openfreemap.org/styles/dark',
});
export const DEMO_CAMERA = Object.freeze({ longitude: -0.1276, latitude: 51.5072, zoom: 12.5 });

// Provider checks are deliberately strict: Google Directions, Routes and Places
// API content must not be rendered on an OpenStreetMap/MapLibre basemap.
const OPEN_MAP_DATA_PROVIDERS = Object.freeze(['none', 'rider-owned', 'open-data']);
export function assertMapDataCompatibility({ surface, directions, places }) {
  if (surface !== 'open' && surface !== 'google') {
    throw new Error('Unknown map surface');
  }
  for (const provider of [directions, places]) {
    if (typeof provider !== 'string' || !provider) {
      throw new Error('Map data provider must be explicit');
    }
    if (surface === 'open' && !OPEN_MAP_DATA_PROVIDERS.includes(provider)) {
      throw new Error('This data provider is not approved for an open map');
    }
  }
  return true;
}

export function openMapStyle(mode) {
  if (!Object.hasOwn(MAP_STYLE_URLS, mode)) throw new Error('Unknown map style');
  return MAP_STYLE_URLS[mode];
}
