import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateLocalRouteSuite, runLocalRouteSuite, LOCAL_ROUTE_ACCEPTANCE_RELEASED } from './verify-local-valhalla-routes.mjs';

// SYNTHETIC: hash-linked route checker tests, never an actual Valhalla graph.
const hash = (data) => createHash('sha256').update(data).digest('hex');
const root = mkdtempSync(join(tmpdir(), 'rider-valhalla-route-test-'));
const graphDir = join(root, 'graph');
const tiles = join(graphDir, 'valhalla_tiles');
mkdirSync(join(tiles, '0', '123'), { recursive: true });
const tilePath = join(tiles, '0', '123', '001.gph');
const tileContents = 'SYNTHETIC GRAPH TILE; NO ROADS';
writeFileSync(tilePath, tileContents);
const tileHash = hash(`0/123/001.gph\0${hash(tileContents)}\n`);
const configPath = join(graphDir, 'valhalla.json');
writeFileSync(configPath, JSON.stringify({ mjolnir: { tile_dir: tiles } }));
const configHash = hash(readFileSync(configPath));
const pbfHash = hash('SYNTHETIC, NOT A PBF');
const configToolHash = hash('SYNTHETIC CONFIG TOOL');
const buildToolHash = hash('SYNTHETIC BUILD TOOL');
const version = '3.6.0';
const profileRevision = 'uk-research-1';
const graphHash = hash(JSON.stringify({ sourceSha256: pbfHash, valhallaVersion: version,
  configToolSha256: configToolHash, buildToolSha256: buildToolHash,
  configSha256: configHash, profileRevision, tileContentSha256: tileHash }));
const manifest = {
  schemaVersion: 1,
  source: { url: 'https://download.geofabrik.de/europe/united-kingdom/england/greater-london/greater-london-261122.osm.pbf',
    sha256: pbfHash, downloadedAtUtc: '2026-11-23T10:00:00Z', license: 'ODbL-1.0' },
  graph: { engine: 'valhalla', version, profileRevision, sourceSha256: pbfHash, buildSha256: graphHash },
  region: { name: 'Greater London', bounds: [-0.52, 51.26, 0.34, 51.71] },
  buildEvidence: { tiles: 1, tileContentSha256: tileHash, configSha256: configHash,
    configToolSha256: configToolHash, buildToolSha256: buildToolHash,
    binariesChecksumVerified: true, pbfChecksumVerified: true,
    graphTilesPresent: true, routingResponseVerified: false,
    legalRoadAccessVerified: false, navigationReady: false },
};
const manifestPath = join(graphDir, 'graph-manifest.json');
writeFileSync(manifestPath, JSON.stringify(manifest));
const servicePath = join(root, 'mock-valhalla-service');
writeFileSync(servicePath, `#!/usr/bin/env node
// Fake one-shot service. Emit parseable polyline6 but never represent real roads.
const req=JSON.parse(process.argv[4]||'null');
if (process.argv[2]==null||process.argv[3]!=='route'||!req||!Array.isArray(req.locations)) process.exit(7);
if (!['auto','motorcycle','motor_scooter'].includes(req.costing)) process.exit(8);
const type=req.costing;const opts=req.costing_options?.[type]||{};
if (type==='motor_scooter' && !Number.isFinite(opts.top_speed)) process.exit(9);
function encDelta(n){let x=n<0?-n*2-1:n*2;let s='';while(x>=32){s+=String.fromCharCode((32+(x%32))+63);x=Math.floor(x/32);}return s+String.fromCharCode(x+63);}
let lat=0,lon=0,shape='';for(const p of req.locations){const nextLat=Math.round(p.lat*1e6),nextLon=Math.round(p.lon*1e6);shape+=encDelta(nextLat-lat)+encDelta(nextLon-lon);lat=nextLat;lon=nextLon;}
process.stdout.write(JSON.stringify({trip:{status:0,units:'kilometers',summary:{length:1.3,time:180},legs:[{shape}]}}));
`, { mode: 0o755 });
const cases = [
  { id: 'car-central', vehicleCategory: 'car', coordinates: [[-0.1276,51.5072],[-0.12,51.51]], avoidHighways: true },
  { id: 'motorcycle-central', vehicleCategory: 'motorcycle_large', coordinates: [[-0.13,51.51],[-0.118,51.515]] },
  { id: 'moped-central', vehicleCategory: 'moped', scooterTopSpeedKph:45, coordinates: [[-0.12,51.52],[-0.11,51.525]], avoidHighways:true },
  { id: 'scooter-central', vehicleCategory: 'scooter', scooterTopSpeedKph:65, coordinates: [[-0.11,51.525],[-0.10,51.53]] },
];
const suite = { schemaVersion:1, graphDir, service:{path:servicePath,sha256:hash(readFileSync(servicePath))},cases };
assert.equal(LOCAL_ROUTE_ACCEPTANCE_RELEASED, false);
async function rejected(value, message) { await assert.rejects(() => validateLocalRouteSuite(value), message); }
const valid = await validateLocalRouteSuite(suite);
assert.equal(valid.evidence.graphSha256, graphHash);
assert.equal(valid.evidence.tileCount, 1);
assert.deepEqual(valid.cases.map(c => c.request.costing), ['auto','motorcycle','motor_scooter','motor_scooter']);
const result = await runLocalRouteSuite(suite);
assert.equal(result.routeCount, 4);
assert.equal(result.navigationReady, false);
assert.equal(result.legalRoadAccessVerified, false);
assert.equal(result.executableAuthenticityVerified, false);
assert.ok(result.results.every(r => r.routeResponseShapeVerified && !r.navigationReady
  && !r.roadRestrictionComplianceVerified && !r.laneAccessVerified && !r.tollExemptionVerified));
assert.ok(result.results.every(r => r.pointCount === 2 && r.distanceMeters === 1300 && r.durationSeconds === 180));
const suitePath = join(root, 'suite.json');
writeFileSync(suitePath, JSON.stringify(suite));
const cli = new URL('./verify-local-valhalla-routes.mjs', import.meta.url).pathname;
assert.equal(JSON.parse(execFileSync(process.execPath,[cli,'--validate',suitePath],{encoding:'utf8'})).caseCount,4);
assert.equal(JSON.parse(execFileSync(process.execPath,[cli,'--run',suitePath],{encoding:'utf8'})).routeCount,4);
for(const bad of [
  {...suite, extra:1}, {...suite,schemaVersion:2}, {...suite,service:{...suite.service,sha256:'b'.repeat(64)}},
  {...suite,cases:cases.slice(0,3)},
  {...suite,cases:[...cases.slice(0,3),cases[0]]},
  {...suite,cases:[...cases.slice(0,3),{...cases[3],id:'moped-central'}]},
  {...suite,cases:[...cases.slice(0,3),{...cases[3],vehicleCategory:'truck'}]},
  {...suite,cases:[...cases.slice(0,3),{...cases[3],traffic:true}]},
  {...suite,cases:[...cases.slice(0,3),{...cases[3],coordinates:[[-0.13,51.51],[-1.00,52.00]]}]},
  {...suite,cases:[...cases.slice(0,3),{...cases[3],scooterTopSpeedKph:undefined}]},
  {...suite,cases:[...cases.slice(0,3),{...cases[3],id:'Private home'}]},
]) await rejected(bad);
const originalManifest = readFileSync(manifestPath);
const tamper = async (mutate) => {
  const value=JSON.parse(originalManifest);
  mutate(value);
  writeFileSync(manifestPath, JSON.stringify(value));
  await rejected(suite);
  writeFileSync(manifestPath, originalManifest);
};
await tamper(v=>{v.graph.sourceSha256='c'.repeat(64)});
await tamper(v=>{v.graph.buildSha256='d'.repeat(64)});
await tamper(v=>{v.buildEvidence.tiles=2});
await tamper(v=>{v.buildEvidence.navigationReady=true});
await tamper(v=>{v.region.bounds=[-0.52,51.26,0.34,0.34]});
writeFileSync(tilePath,'CORRUPTED TILE');
await rejected(suite);
writeFileSync(tilePath,tileContents);
writeFileSync(configPath,'{}');
await rejected(suite);
writeFileSync(configPath,JSON.stringify({ mjolnir: { tile_dir: tiles } }));
const link=join(tiles,'0','123','002.gph');
symlinkSync(tilePath, link);
await rejected(suite);
rmSync(link);
// Bad route data must not masquerade as a valid route even from a pinned executable.
const failing = join(root,'mock-valhalla-failing');
writeFileSync(failing,'#!/usr/bin/env node\nprocess.stdout.write("not-json");\n', {mode:0o755});
await assert.rejects(()=>runLocalRouteSuite({...suite,service:{path:failing,sha256:hash(readFileSync(failing))}}));
const mismatch=join(root,'mock-valhalla-mismatch');
writeFileSync(mismatch,'#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({trip:{status:0,units:"kilometers",summary:{length:1,time:100},legs:[{shape:"_p~iF~ps|U_ulLnnqC"}]}}));\n',{mode:0o755});
await assert.rejects(()=>runLocalRouteSuite({...suite,service:{path:mismatch,sha256:hash(readFileSync(mismatch))}}));
for(const surface of ['../docs/app.js','../docs/map-beta/preview.mjs','../mobile/src/screens/SettingsScreen.tsx']) {
  const data=readFileSync(new URL(surface,import.meta.url),'utf8');
  assert.doesNotMatch(data,/runLocalRouteSuite|verifyLocalRouteEvidence/);
}
console.log('Maps: offline pinned graph + car/motorcycle/moped/scooter route evidence accepted; no legal/nav release claims.');
