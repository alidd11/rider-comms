// Offline research: ensure the hashed directory is the only graph/traffic source.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const inactive = value => value === undefined || value === '';

export function assertDirectoryOnlyGraphConfig(config, tileDir) {
  if (!record(config) || !record(config.mjolnir) || config.mjolnir.tile_dir !== tileDir) {
    throw new Error('Valhalla config does not target isolated output tile directory');
  }
  for (const key of ['tile_extract', 'tile_url', 'tile_url_user_pw', 'traffic_extract', 'incident_dir', 'incident_log']) {
    if (!inactive(config.mjolnir[key])) throw new Error('Unverified alternate Valhalla source: ' + key);
  }
  if (config.additional_data !== undefined && (!record(config.additional_data)
    || !inactive(config.additional_data.elevation_url) || !inactive(config.additional_data.elevation_url_user_pw))) {
    throw new Error('Unverified remote Valhalla elevation source');
  }
}

export function assertNoUnhashedCompressedTile(name) {
  if (/\.gph\.gz$/i.test(name)) throw new Error('Unhashed compressed graph tile: ' + name);
}
