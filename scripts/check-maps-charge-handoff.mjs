import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAPS_CHARGE_HANDOFF_RELEASED, draftMapsChargeIdentity } from '../map-lab/charge-handoff.mjs';

const hash = (character) => character.repeat(64);
const graphSnapshot = {
  source: {
    url: 'https://download.geofabrik.de/europe/great-britain/england/greater-london-260101.osm.pbf',
    sha256: hash('a'), downloadedAtUtc: '2026-01-02T00:00:00Z', license: 'ODbL-1.0',
  },
  graph: {
    engine: 'valhalla', version: '3.6.0', profileRevision: 'uk-research-1',
    buildSha256: hash('b'), sourceSha256: hash('a'),
  },
  region: { name: 'Greater London', bounds: [-0.52, 51.26, 0.34, 51.71] },
};
const input = { routeId: 'synthetic-route-1', revision: 4, vehicleCategory: 'motorcycle_small', graphSnapshot };
assert.equal(MAPS_CHARGE_HANDOFF_RELEASED, false);
const result = draftMapsChargeIdentity(input);
assert.equal(result.status, 'research_identity_only');
assert.deepEqual(result.identity, {
  schemaVersion: 1, routeId: 'synthetic-route-1', revision: 4,
  graphBuildSha256: hash('b'), profileRevision: 'uk-research-1',
  vehicleClass: 'motorcycle',
});
for (const value of Object.values(result.assurance)) assert.equal(value, false);
for (const category of ['car', 'motorcycle_large']) {
  const variant = draftMapsChargeIdentity({ ...input, vehicleCategory: category });
  assert.equal(variant.identity.vehicleClass, category === 'car' ? 'car' : 'motorcycle');
}
for (const category of ['moped', 'scooter']) {
  const withheld = draftMapsChargeIdentity({ ...input, vehicleCategory: category });
  assert.equal(withheld.status, 'needs_scheme_specific_vehicle_review');
  assert.equal(withheld.identity, null);
  assert.equal(withheld.assurance.tollFreeRouteVerified, false);
}
const graphChanged = draftMapsChargeIdentity({ ...input,
  graphSnapshot: { ...graphSnapshot, graph: { ...graphSnapshot.graph, buildSha256: hash('c') } },
});
assert.equal(graphChanged.identity.graphBuildSha256, hash('c'));
assert.equal(result.identity.graphBuildSha256, hash('b'), 'Handoff must snapshot its graph identity');
for (const invalid of [
  null, [], {}, { ...input, routeId: '' }, { ...input, routeId: 'pii email@example.com' },
  { ...input, revision: -1 }, { ...input, revision: 1.5 },
  { ...input, vehicleCategory: 'truck' }, { ...input, vehicleCategory: undefined },
  { ...input, traffic: true }, { ...input, entitlement: 'verified' },
  { ...input, graphSnapshot: { ...graphSnapshot, graph: { ...graphSnapshot.graph,
    profileRevision: 'unsupported+profile' } } },
  { ...input, graphSnapshot: { ...graphSnapshot, source: { ...graphSnapshot.source,
    sha256: hash('c') } } },
]) assert.throws(() => draftMapsChargeIdentity(invalid));
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
for (const path of ['../docs/app.js', '../docs/map-beta/preview.mjs',
  '../mobile/src/screens/SettingsScreen.tsx']) {
  assert.doesNotMatch(read(path), /draftMapsChargeIdentity|charge-handoff\.mjs/);
}
console.log('Maps-to-Tolls v1 research identity only; unresolved vehicles and real-world evidence fail closed.');
