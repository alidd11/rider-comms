/**
 * Offline research-only Valhalla route acceptance runner. Runs the one-shot
 * valhalla_service executable against a pinned local graph, with no HTTP
 * service, rider GPS, Google data, or legal-access claims.
 *
 * node scripts/verify-local-valhalla-routes.mjs --validate /abs/suite.json
 * node scripts/verify-local-valhalla-routes.mjs --run /abs/suite.json
 */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, lstatSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { draftMultiVehicleRoute, validateResearchGraphSnapshot } from '../map-lab/multi-vehicle-routing.mjs';
import { fromValhallaTrip } from '../map-lab/route-adapters.mjs';
import { assertDirectoryOnlyGraphConfig, assertNoUnhashedCompressedTile } from './local-map-graph-isolation.mjs';

export const LOCAL_ROUTE_ACCEPTANCE_RELEASED = false;
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9-]{1,49}$/;
const MAX_SUITE_BYTES = 65536;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_CASES = 12;
const MAX_TILES = 200000;
const MAX_SNAP_METERS = 1500;

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exactFields(value, names) {
  if (!record(value) || Object.keys(value).some(k => !names.includes(k))
      || names.some(k => !Object.hasOwn(value, k))) throw new Error('Unknown or missing route-suite fields');
}
function regularFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Expected regular, non-symlink file');
  return stat;
}
function directory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Expected directory, not a symlink');
}
function absPath(input) {
  if (typeof input !== 'string' || !isAbsolute(input) || input.includes('\0')) {
    throw new Error('An absolute local path is required');
  }
  return resolve(input);
}
function readSmallJson(path, limit) {
  if (regularFile(path).size > limit) throw new RangeError('Oversized local JSON input');
  return JSON.parse(readFileSync(path, 'utf8'));
}
async function sha256(path) {
  regularFile(path);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function sha(value) { if (typeof value !== 'string' || !SHA.test(value)) throw new Error('Invalid SHA-256'); }
function haversineMeters(a, b) {
  const r = Math.PI / 180;
  const lat1 = a[1] * r;
  const lat2 = b[1] * r;
  const dLat = (b[1] - a[1]) * r;
  const dLon = (b[0] - a[0]) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(s)));
}
function listTiles(root) {
  const tiles = [];
  function visit(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (tiles.length >= MAX_TILES) throw new RangeError('Graph tile limit exceeded');
      if (item.isSymbolicLink()) throw new Error('Symlink found in routing graph');
      assertNoUnhashedCompressedTile(item.name);
      const path = join(dir, item.name);
      if (item.isDirectory()) visit(path);
      else if (!item.isFile()) throw new Error('Unsupported graph entry');
      else if (path.endsWith('.gph')) tiles.push({ path, relativePath: relative(root, path).replaceAll('\\', '/') });
    }
  }
  directory(root);
  visit(root);
  if (!tiles.length) throw new Error('No Valhalla .gph tiles found');
  tiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'en'));
  return tiles;
}

/** Validate graph artifacts against the EXACT PBF/build identity; never prove road legality. */
export async function verifyLocalRouteEvidence(graphDir, binary) {
  const root = absPath(graphDir);
  directory(root);
  const manifest = readSmallJson(join(root, 'graph-manifest.json'), MAX_SUITE_BYTES);
  if (!record(manifest) || manifest.schemaVersion !== 1 || !record(manifest.buildEvidence)) {
    throw new Error('Unsupported routing graph evidence');
  }
  const snapshot = validateResearchGraphSnapshot({
    source: manifest.source, graph: manifest.graph, region: manifest.region,
  });
  const evidence = manifest.buildEvidence;
  for (const key of ['tileContentSha256', 'configSha256', 'configToolSha256',
    'buildToolSha256']) sha(evidence[key]);
  if (evidence.binariesChecksumVerified !== true || evidence.pbfChecksumVerified !== true
      || evidence.graphTilesPresent !== true || evidence.navigationReady !== false
      || evidence.legalRoadAccessVerified !== false || evidence.routingResponseVerified !== false) {
    throw new Error('Missing, inconsistent or prematurely released build evidence');
  }
  const configPath = join(root, 'valhalla.json');
  const tilesDir = join(root, 'valhalla_tiles');
  if (await sha256(configPath) !== evidence.configSha256) throw new Error('Valhalla config checksum mismatch');
  const config = readSmallJson(configPath, MAX_SUITE_BYTES);
  assertDirectoryOnlyGraphConfig(config, tilesDir);
  const tiles = listTiles(tilesDir);
  const digest = createHash('sha256');
  for (const tile of tiles) digest.update(tile.relativePath + '\0' + await sha256(tile.path) + '\n');
  const tileContentSha256 = digest.digest('hex');
  if (tiles.length !== evidence.tiles || tileContentSha256 !== evidence.tileContentSha256) {
    throw new Error('Routing graph tiles have changed after the build');
  }
  const graphBuildSha256 = createHash('sha256').update(JSON.stringify({
    sourceSha256: snapshot.source.sha256, valhallaVersion: snapshot.graph.version,
    configToolSha256: evidence.configToolSha256,
    buildToolSha256: evidence.buildToolSha256,
    configSha256: evidence.configSha256,
    profileRevision: snapshot.graph.profileRevision,
    tileContentSha256,
  })).digest('hex');
  if (graphBuildSha256 !== snapshot.graph.buildSha256) {
    throw new Error('Graph build fingerprint does not match its source/tools/tiles');
  }
  exactFields(binary, ['path', 'sha256']);
  sha(binary.sha256);
  const servicePath = absPath(binary.path);
  if (await sha256(servicePath) !== binary.sha256) {
    throw new Error('Valhalla one-shot executable does not match its pinned hash');
  }
  return { snapshot, configPath, servicePath, graphSha256: graphBuildSha256,
    tileCount: tiles.length, graphArtifactsHashVerified: true,
    pbfSourceBytesPresentAndVerified: false, legalRoadAccessVerified: false,
    navigationReady: false };
}

function checkCase(scenario, graph) {
  if (!record(scenario)) throw new TypeError('Route case must be an object');
  const fields = ['id', 'vehicleCategory', 'coordinates', 'scooterTopSpeedKph',
    'avoidHighways', 'avoidTolls', 'avoidFerries'];
  if (Object.keys(scenario).some(key => !fields.includes(key))) {
    throw new Error('Unsupported route case metadata');
  }
  if (!ID.test(scenario.id ?? '')) throw new Error('Route case ID must be non-identifying');
  const { id, ...input } = scenario;
  const draft = draftMultiVehicleRoute({ ...input, graphSnapshot: {
    source: graph.source, graph: graph.graph, region: graph.region,
  } });
  const bounds = graph.region.bounds;
  for (const [lon, lat] of scenario.coordinates) {
    if (lon < bounds[0] || lon > bounds[2] || lat < bounds[1] || lat > bounds[3]) {
      throw new Error('Route case lies outside the declared graph coverage bounds');
    }
  }
  return { id, vehicleCategory: scenario.vehicleCategory,
    request: draft.request, points: scenario.coordinates.map(point => [...point]) };
}

/** Validate a test specification and its pinned graph before any routing command. */
export async function validateLocalRouteSuite(input) {
  exactFields(input, ['schemaVersion', 'graphDir', 'service', 'cases']);
  if (input.schemaVersion !== 1 || !Array.isArray(input.cases)
      || input.cases.length < 4 || input.cases.length > MAX_CASES) {
    throw new Error('Expected 4–12 route cases in schema v1');
  }
  const evidence = await verifyLocalRouteEvidence(input.graphDir, input.service);
  const cases = input.cases.map(item => checkCase(item, evidence.snapshot));
  if (new Set(cases.map(item => item.id)).size !== cases.length) throw new Error('Duplicate route case identifiers');
  const categories = new Set(cases.map(item => item.vehicleCategory));
  if (!['car', 'moped', 'scooter'].every(category => categories.has(category))
      || !['motorcycle_large', 'motorcycle_small'].some(category => categories.has(category))) {
    throw new Error('Require car, motorcycle, moped and scooter route coverage');
  }
  return { evidence, cases };
}

/** Run pinned Valhalla locally and verify route geometry/metrics only. */
export async function runLocalRouteSuite(input) {
  const { evidence, cases } = await validateLocalRouteSuite(input);
  const results = [];
  for (const scenario of cases) {
    const run = spawnSync(evidence.servicePath, [evidence.configPath, 'route', JSON.stringify(scenario.request)], {
      shell: false, encoding: 'utf8', timeout: 60000, maxBuffer: MAX_RESPONSE_BYTES,
    });
    if (run.error || run.status !== 0 || !run.stdout || run.stdout.length > MAX_RESPONSE_BYTES) {
      throw new Error('Offline route command failed for ' + scenario.id + ' (not a road-access verdict)');
    }
    let response;
    try { response = JSON.parse(run.stdout); } catch { throw new Error('Invalid Valhalla JSON route for ' + scenario.id); }
    const feature = fromValhallaTrip(response);
    const shape = feature.geometry.coordinates;
    const endpoints = [scenario.points[0], scenario.points.at(-1)];
    if (haversineMeters(endpoints[0], shape[0]) > MAX_SNAP_METERS
        || haversineMeters(endpoints[1], shape.at(-1)) > MAX_SNAP_METERS) {
      throw new Error('Route does not match the expected origin/destination for ' + scenario.id);
    }
    results.push({ caseId: scenario.id, vehicleCategory: scenario.vehicleCategory,
      costing: scenario.request.costing,
      pointCount: shape.length,
      distanceMeters: feature.properties.distanceMeters,
      durationSeconds: feature.properties.durationSeconds,
      declaredSource: 'openstreetmap', sourcePbfBytesReverified: false,
      graphBuildSha256: evidence.graphSha256, routeResponseShapeVerified: true,
      routeExecutableAuthenticityVerified: false, roadRestrictionComplianceVerified: false,
      motorwayEligibilityVerified: false, laneAccessVerified: false,
      tollExemptionVerified: false, trafficAvailable: false, navigationReady: false });
  }
  return { schemaVersion: 1, routeCount: results.length,
    graphBuildSha256: evidence.graphSha256, graphArtifactsHashVerified: true,
    pinnedLocalExecutableUsed: true, executableAuthenticityVerified: false,
    legalRoadAccessVerified: false,
    navigationReady: false, results };
}

const entrypoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (entrypoint) {
  if (process.argv.length !== 4 || !['--validate', '--run'].includes(process.argv[2])) {
    console.error('Usage: node scripts/verify-local-valhalla-routes.mjs --validate|--run /absolute/path/to/route-suite.json');
    process.exitCode = 2;
  } else {
    try {
      const suite = readSmallJson(absPath(process.argv[3]), MAX_SUITE_BYTES);
      const result = process.argv[2] === '--validate'
        ? await validateLocalRouteSuite(suite)
        : await runLocalRouteSuite(suite);
      if (process.argv[2] === '--validate') {
        console.log(JSON.stringify({ schemaVersion: 1,
          graphBuildSha256: result.evidence.graphSha256, caseCount: result.cases.length,
          categories: result.cases.map(c => c.vehicleCategory),
          graphArtifactsHashVerified: true, routingResponseVerified: false,
          legalRoadAccessVerified: false, navigationReady: false }, null, 2));
      } else console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('Offline Valhalla route validation failed: ' + error.message);
      process.exitCode = 1;
    }
  }
}
