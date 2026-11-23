import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildLocalMapGraph, verifyLocalGraphInput, LOCAL_MAP_GRAPH_RELEASED } from './build-local-map-graph.mjs';

const sha = (v) => createHash('sha256').update(v).digest('hex');
const root = mkdtempSync(join(tmpdir(), 'rider-graph-test-'));
const pbfPath = join(root, 'london.osm.pbf');
const configPath = join(root, 'mock-config');
const builderPath = join(root, 'mock-builder');
// The fake PBF and tools exercise integrity/command wiring only. They are
// deliberately NOT a real OpenStreetMap extract or production Valhalla graph.
const pbfData = Buffer.from('SYNTHETIC OSM PBF PLACEHOLDER; NOT GEOGRAPHY');
writeFileSync(pbfPath, pbfData);
writeFileSync(configPath, [
  '#!/usr/bin/env node',
  "const arg = process.argv.indexOf('--mjolnir-tile-dir');",
  'if(arg < 0) process.exit(2);',
  'process.stdout.write(JSON.stringify({mjolnir:{tile_dir:process.argv[arg+1]}}));',
].join('\n') + '\n', { mode: 0o755 });
writeFileSync(builderPath, [
  '#!/usr/bin/env node',
  "const fs=require('fs'),path=require('path');",
  "const index=process.argv.indexOf('-c');",
  "if(index<0||!process.argv[index+2]?.endsWith('.osm.pbf')) process.exit(3);",
  "const config=JSON.parse(fs.readFileSync(process.argv[index+1],'utf8'));",
  "fs.mkdirSync(path.join(config.mjolnir.tile_dir,'0','123'),{recursive:true});",
  "fs.writeFileSync(path.join(config.mjolnir.tile_dir,'0','123','001.gph'),'MOCK TILE ONLY');",
].join('\n') + '\n', { mode: 0o755 });
const configData = readFileSync(configPath);
const builderData = readFileSync(builderPath);
const base = {
  pbf: { path:pbfPath,
    sourceUrl:'https://download.geofabrik.de/europe/great-britain/england/greater-london-260101.osm.pbf',
    sha256:sha(pbfData), downloadedAtUtc:'2026-01-02T00:00:00Z', license:'ODbL-1.0' },
  tools: { version:'3.6.3',
    config:{path:configPath,sha256:sha(configData)},
    buildTiles:{path:builderPath,sha256:sha(builderData)} },
  region:{name:'Greater London', bounds:[-0.52,51.26,0.34,51.71]},
  profileRevision:'uk-car-motorcycle-1', outputDir:join(root,'output'),
};
assert.equal(LOCAL_MAP_GRAPH_RELEASED,false);
const plan=verifyLocalGraphInput(base);
assert.equal(plan.networkRequestMade,false);
assert.equal(plan.navigationReady,false);
assert.equal(plan.source.sha256,sha(pbfData));
for (const input of [
  null, {}, {...base, extra:true},
  {...base, pbf:{...base.pbf,sha256:'0'.repeat(64)}},
  {...base, pbf:{...base.pbf,license:'none'}},
  {...base, pbf:{...base.pbf,sourceUrl:'https://evil.test/london.osm.pbf'}},
  {...base, pbf:{...base.pbf,sourceUrl:'http://download.geofabrik.de/uk.osm.pbf'}},
  {...base, pbf:{...base.pbf,downloadedAtUtc:'2026-02-30T00:00:00Z'}},
  {...base, tools:{...base.tools,version:'../../bad'}},
  {...base, tools:{...base.tools,buildTiles:{...base.tools.buildTiles,sha256:'a'.repeat(64)}}},
  {...base, region:{name:'UK',bounds:[0,0,0,1]}},
  {...base, outputDir:pbfPath},
  {...base, outputDir:join(root,'missing-parent','result')},
  {...base, outputDir:'relative/output'},
]) assert.throws(()=>verifyLocalGraphInput(input));
const link = join(root,'pbf-link.osm.pbf');
symlinkSync(pbfPath,link);
assert.throws(()=>verifyLocalGraphInput({...base,pbf:{...base.pbf,path:link}}), /non-symlink/);
// The fixture mocks graph generation; the genuine execution still requires a
// verified local OSM PBF and checksum-pinned Valhalla binaries.
const result=buildLocalMapGraph(base);
assert.equal(result.schemaVersion,1);
assert.equal(result.graph.engine,'valhalla');
assert.equal(result.graph.sourceSha256,sha(pbfData));
assert.equal(result.buildEvidence.tiles,1);
assert.equal(result.buildEvidence.binariesChecksumVerified,true);
assert.equal(result.buildEvidence.routingResponseVerified,false);
assert.equal(result.buildEvidence.legalRoadAccessVerified,false);
assert.equal(result.buildEvidence.navigationReady,false);
assert.match(result.graph.buildSha256,/^[a-f0-9]{64}$/);
assert.deepEqual(JSON.parse(readFileSync(join(base.outputDir,'graph-manifest.json'),'utf8')),result);
assert.throws(()=>buildLocalMapGraph(base),/already exists/);
const cli=join(resolve(import.meta.dirname),'build-local-map-graph.mjs');
const cliConfig=join(root,'invalid.json');
writeFileSync(cliConfig,JSON.stringify({...base, outputDir:join(root,'output-new'),
  tools:{...base.tools,config:{...base.tools.config,sha256:'0'.repeat(64)}}}));
assert.throws(()=>execFileSync(process.execPath,[cli,'--plan',cliConfig],{stdio:'pipe'}));
// Guard against any production import and hidden network/paid-service wiring.
for (const src of ['../docs/app.js','../docs/map-beta/preview.mjs','../mobile/src/screens/SettingsScreen.tsx']) {
  const content=readFileSync(new URL(src,import.meta.url),'utf8');
  assert.doesNotMatch(content,/buildLocalMapGraph|verifyLocalGraphInput/);
}
console.log('Maps local graph pipeline: pinned offline inputs, bounded tool invocation and synthetic build evidence validated.');
