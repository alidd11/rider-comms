import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertDirectoryOnlyGraphConfig, assertNoUnhashedCompressedTile } from './local-map-graph-isolation.mjs';
const dir = '/local/graph/valhalla_tiles';
const config = { mjolnir: { tile_dir: dir, tile_extract: '', traffic_extract: '' } };
test('directory only accepted', () => assert.doesNotThrow(() => assertDirectoryOnlyGraphConfig(config, dir)));
for (const key of ['tile_extract', 'tile_url', 'tile_url_user_pw', 'traffic_extract', 'incident_dir', 'incident_log']) {
  test(`reject alternate ${key}`, () => assert.throws(() => assertDirectoryOnlyGraphConfig({ mjolnir: { ...config.mjolnir, [key]: '/unverified/source' } }, dir), /alternate/));
}
test('reject remote elevation', () => assert.throws(() => assertDirectoryOnlyGraphConfig({ ...config, additional_data: { elevation_url: 'https://example.test/' } }, dir), /remote/));
test('reject wrong directory', () => assert.throws(() => assertDirectoryOnlyGraphConfig(config, '/other'), /isolated/));
test('reject malformed config', () => assert.throws(() => assertDirectoryOnlyGraphConfig(null, dir), /isolated/));
test('reject null alternate source', () => assert.throws(() => assertDirectoryOnlyGraphConfig({ mjolnir: { ...config.mjolnir, tile_extract: null } }, dir), /alternate/));
test('reject compressed untracked tiles', () => { assert.throws(() => assertNoUnhashedCompressedTile('001.gph.gz'), /compressed/); assert.throws(() => assertNoUnhashedCompressedTile('001.GPH.GZ'), /compressed/); assert.doesNotThrow(() => assertNoUnhashedCompressedTile('001.gph')); });
