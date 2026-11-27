/**
 * Offline, opt-in research utility: build a local Valhalla tile graph from a
 * separately obtained OSM PBF. Never downloads data, serves HTTP or changes
 * the released Rider Comms map. No live rider locations are handled.
 *
 * Usage: node scripts/build-local-map-graph.mjs --plan local-graph.json
 *        node scripts/build-local-map-graph.mjs --build local-graph.json
 * The --build form requires existing checksum-pinned local Valhalla tools.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDirectoryOnlyGraphConfig, assertNoUnhashedCompressedTile } from './local-map-graph-isolation.mjs';

export const LOCAL_MAP_GRAPH_RELEASED = false;
const SHA = /^[a-f0-9]{64}$/;
const GEOfABRIK = /^https:\/\/download\.geofabrik\.de\/[a-z0-9/_-]+\.osm\.pbf$/;
const VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const MAX_CONFIG_SIZE = 16384;

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
function fields(v, expected) {
  if (!object(v) || Object.keys(v).some(k => !expected.includes(k))
    || expected.some(k => !Object.hasOwn(v, k))) throw new Error('Unexpected or missing graph build configuration fields');
}
function timestamp(value) {
  if (typeof value !== 'string' || !UTC.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value.replace(/Z$/, '.000Z');
}
function ensureRegular(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Expected a regular, non-symlink local file: ' + path);
  return stat;
}
function hashFile(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function safePath(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Paths must be absolute');
  return resolve(path);
}
function checkDigest(value) { if (typeof value !== 'string' || !SHA.test(value)) throw new Error('Expected SHA-256 hex checksum'); }

export function verifyLocalGraphInput(input) {
  fields(input, ['pbf', 'tools', 'region', 'profileRevision', 'outputDir']);
  fields(input.pbf, ['path', 'sourceUrl', 'sha256', 'downloadedAtUtc', 'license']);
  fields(input.tools, ['version', 'config', 'buildTiles']);
  fields(input.tools.config, ['path', 'sha256']);
  fields(input.tools.buildTiles, ['path', 'sha256']);
  fields(input.region, ['name', 'bounds']);
  if (!GEOfABRIK.test(input.pbf.sourceUrl)
      || input.pbf.license !== 'ODbL-1.0' || !timestamp(input.pbf.downloadedAtUtc)
      || !VERSION.test(input.tools.version ?? '') || !VERSION.test(input.profileRevision ?? '')
      || typeof input.region.name !== 'string' || !/^[a-zA-Z0-9 -]{2,64}$/.test(input.region.name)
      || !Array.isArray(input.region.bounds) || input.region.bounds.length !== 4
      || !input.region.bounds.every(Number.isFinite)
      || input.region.bounds[0] < -180 || input.region.bounds[2] > 180
      || input.region.bounds[1] < -90 || input.region.bounds[3] > 90
      || input.region.bounds[0] >= input.region.bounds[2]
      || input.region.bounds[1] >= input.region.bounds[3]) throw new Error('Invalid source metadata or region');
  checkDigest(input.pbf.sha256);
  checkDigest(input.tools.config.sha256);
  checkDigest(input.tools.buildTiles.sha256);
  const pbfPath = safePath(input.pbf.path);
  const configBin = safePath(input.tools.config.path);
  const buildBin = safePath(input.tools.buildTiles.path);
  const outputDir = safePath(input.outputDir);
  if ([pbfPath, configBin, buildBin].some(p => p === outputDir || p.startsWith(outputDir + '/'))) {
    throw new Error('Graph output must not contain any source or tool input');
  }
  for (const [path, checksum] of [
    [pbfPath, input.pbf.sha256], [configBin, input.tools.config.sha256],
    [buildBin, input.tools.buildTiles.sha256],
  ]) {
    ensureRegular(path);
    if (hashFile(path) !== checksum) throw new Error('Local graph input checksum mismatch: ' + path);
  }
  if (existsSync(outputDir)) throw new Error('Output directory already exists; never overwrite graphs');
  if (!existsSync(dirname(outputDir))) throw new Error('Output parent directory must already exist');
  return {
    pbfPath, configBin, buildBin, outputDir,
    source: { url: input.pbf.sourceUrl, sha256: input.pbf.sha256,
      downloadedAtUtc: input.pbf.downloadedAtUtc, license: 'ODbL-1.0' },
    tools: { version: input.tools.version,
      configSha256: input.tools.config.sha256,
      buildTilesSha256: input.tools.buildTiles.sha256 },
    profileRevision: input.profileRevision,
    region: { name: input.region.name, bounds: [...input.region.bounds] },
    networkRequestMade: false, navigationReady: false,
  };
}
function runTool(executable, args, outputDir, timeoutMs) {
  const result = spawnSync(executable, args, {
    cwd: outputDir, encoding: 'utf8', timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024, shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error('Local Valhalla graph tool failed: ' + (result.error?.code || result.status));
  }
  return result.stdout;
}
function graphTileHash(root) {
  const entries = [];
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Symlink in generated graph');
      assertNoUnhashedCompressedTile(entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.gph')) {
        entries.push({ path: relative(root, path).replaceAll('\\', '/'), sha256: hashFile(path) });
      } else if (!entry.isFile()) throw new Error('Unsupported generated graph entry');
    }
  }
  visit(root);
  entries.sort((a,b) => a.path.localeCompare(b.path, 'en'));
  if (!entries.length) throw new Error('Valhalla did not produce any graph .gph tiles');
  const digest = createHash('sha256');
  for (const entry of entries) digest.update(entry.path + '\0' + entry.sha256 + '\n');
  return { tiles: entries.length, tileContentSha256: digest.digest('hex') };
}
export function buildLocalMapGraph(input) {
  const plan = verifyLocalGraphInput(input);
  const tileDir = join(plan.outputDir, 'valhalla_tiles');
  mkdirSync(plan.outputDir);
  mkdirSync(tileDir);
  const configJson = runTool(plan.configBin, [
    '--mjolnir-tile-dir', tileDir,
    '--mjolnir-tile-extract', '',
    '--mjolnir-traffic-extract', '',
    '--mjolnir-timezone', join(tileDir, 'timezones.sqlite'),
    '--mjolnir-admin', join(tileDir, 'admins.sqlite'),
  ], plan.outputDir, 120000);
  if (configJson.length > MAX_CONFIG_SIZE * 64) throw new Error('Valhalla config too large');
  let config;
  try { config = JSON.parse(configJson); } catch { throw new Error('Invalid Valhalla config JSON'); }
  assertDirectoryOnlyGraphConfig(config, tileDir);
  const configPath = join(plan.outputDir, 'valhalla.json');
  writeFileSync(configPath, configJson, { flag:'wx', mode:0o600 });
  runTool(plan.buildBin, ['-c', configPath, plan.pbfPath], plan.outputDir, 30 * 60 * 1000);
  const graph = graphTileHash(tileDir);
  const configSha256 = hashFile(configPath);
  const graphBuildChecksum = createHash('sha256').update(JSON.stringify({
    sourceSha256: plan.source.sha256, valhallaVersion: plan.tools.version,
    configToolSha256: plan.tools.configSha256, buildToolSha256: plan.tools.buildTilesSha256,
    configSha256, profileRevision: plan.profileRevision,
    tileContentSha256: graph.tileContentSha256,
  })).digest('hex');
  const manifest = {
    schemaVersion: 1, source: plan.source,
    graph: { engine:'valhalla', version:plan.tools.version,
      profileRevision:plan.profileRevision, sourceSha256:plan.source.sha256,
      buildSha256:graphBuildChecksum },
    region: plan.region, buildEvidence: {
      ...graph, configSha256, configToolSha256:plan.tools.configSha256,
      buildToolSha256:plan.tools.buildTilesSha256,
      binariesChecksumVerified: true, pbfChecksumVerified: true,
      graphTilesPresent: true, routingResponseVerified:false,
      legalRoadAccessVerified:false, navigationReady:false,
    },
  };
  writeFileSync(join(plan.outputDir, 'graph-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
    flag:'wx', mode:0o600,
  });
  return manifest;
}

const self = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (self) {
  if (process.argv.length !== 4 || !['--plan','--build'].includes(process.argv[2])) {
    console.error('Usage: node scripts/build-local-map-graph.mjs --plan|--build /absolute/path/to/local-graph.json');
    process.exitCode = 2;
  } else {
    try {
      const path = safePath(process.argv[3]);
      ensureRegular(path);
      const input = JSON.parse(readFileSync(path, 'utf8'));
      const output = process.argv[2] === '--plan'
        ? verifyLocalGraphInput(input) : buildLocalMapGraph(input);
      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    } catch (error) {
      console.error('Local map graph validation/build failed: ' + error.message);
      process.exitCode = 1;
    }
  }
}
