import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MULTI_VEHICLE_ROUTING_RELEASED, VEHICLE_PROFILES,
  validateResearchGraphSnapshot, draftMultiVehicleRoute,
} from '../map-lab/multi-vehicle-routing.mjs';

const sha = (letter) => letter.repeat(64);
const snapshot = {
  source: { url: 'https://download.geofabrik.de/europe/great-britain/england/greater-london-260101.osm.pbf',
    sha256: sha('a'), downloadedAtUtc: '2026-01-02T00:00:00Z', license: 'ODbL-1.0' },
  graph: { engine: 'valhalla', version: '3.6.0', profileRevision: 'uk-research-1',
    buildSha256: sha('b'), sourceSha256: sha('a') },
  region: { name: 'Greater London', bounds: [-0.52, 51.26, 0.34, 51.71] },
};
const points = [[-0.1276, 51.5072], [-0.115, 51.51]];
const base = { vehicleCategory: 'car', coordinates: points, graphSnapshot: snapshot };
assert.equal(MULTI_VEHICLE_ROUTING_RELEASED, false);
assert.deepEqual(VEHICLE_PROFILES, {car:'auto',motorcycle_small:'motorcycle',
  motorcycle_large:'motorcycle',moped:'motor_scooter',scooter:'motor_scooter'});
assert.equal(validateResearchGraphSnapshot(snapshot).manifestValidated, true);
assert.equal(validateResearchGraphSnapshot(snapshot).builtGraphVerified, false);
const car = draftMultiVehicleRoute({ ...base, avoidHighways:true, avoidTolls:true, avoidFerries:true });
assert.deepEqual(car.request, { locations:[{lat:51.5072,lon:-0.1276},{lat:51.51,lon:-0.115}],
  costing:'auto', costing_options:{auto:{use_highways:0,use_tolls:0,use_ferry:0}} });
for(const category of ['motorcycle_small','motorcycle_large']) {
  const result = draftMultiVehicleRoute({...base, vehicleCategory:category});
  assert.equal(result.request.costing,'motorcycle');
  assert.deepEqual(result.request.costing_options.motorcycle,{use_trails:0});
}
for(const category of ['moped','scooter']) {
  const result = draftMultiVehicleRoute({...base,vehicleCategory:category,scooterTopSpeedKph:45,avoidHighways:true});
  assert.equal(result.request.costing,'motor_scooter');
  assert.deepEqual(result.request.costing_options.motor_scooter,{top_speed:45,use_highways:0});
  assert.equal(result.assurance.motorwayEligibilityVerified,false);
}
for (const key of ['networkRequestMade','downloadedPbfVerified','builtGraphVerified',
  'legalRoadAccessVerified','motorwayEligibilityVerified','tollExemptionVerified',
  'chargeFreeRouteVerified','laneAccessVerified','trafficAvailable','navigationReady',
  'avoidPreferencesAreHardRestrictions']) assert.equal(car.assurance[key],false,key);
points[0][0] = 10;
assert.equal(car.request.locations[0].lon,-0.1276,'Inputs must be copied');
snapshot.graph.buildSha256 = sha('c');
assert.equal(car.graph.graph.buildSha256,sha('b'),'Graph input must be copied');
const inputs = [
  null, [], {}, {...base,vehicleCategory:'truck'}, {...base,vehicleCategory:undefined},
  {...base,googlePlaceId:'abc'}, {...base,traffic:true}, {...base,tollExemption:true},
  {...base,avoidTolls:0}, {...base,avoidHighways:'false'}, {...base,avoidFerries:null},
  {...base,scooterTopSpeedKph:100}, {...base,coordinates:[]},
  {...base,coordinates:[[-181,51],[0,0]]}, {...base,coordinates:[[0,91],[0,0]]},
  {...base,coordinates:[[0,0],[0,0]]}, {...base,coordinates:[[0,0,0],[1,1]]},
  {...base,coordinates:[[NaN,0],[1,1]]}, {...base,coordinates:Array.from({length:9},()=>[0,0])},
  {...base,vehicleCategory:'moped'}, {...base,vehicleCategory:'scooter'},
  {...base,vehicleCategory:'moped',scooterTopSpeedKph:19},
  {...base,vehicleCategory:'scooter',scooterTopSpeedKph:'45'},
  {...base,vehicleCategory:'motorcycle_small',scooterTopSpeedKph:45},
];
for(const input of inputs) assert.throws(()=>draftMultiVehicleRoute(input));
const invalidSnapshots = [
  null, {}, {...snapshot,unexpected:true},
  {...snapshot,source:{...snapshot.source,sha256:'wrong'}},
  {...snapshot,source:{...snapshot.source,url:'http://download.geofabrik.de/uk.osm.pbf'}},
  {...snapshot,source:{...snapshot.source,url:'https://evil.com/uk.osm.pbf'}},
  {...snapshot,source:{...snapshot.source,url:'https://download.geofabrik.de/uk-latest.osm.pbf?token=x'}},
  {...snapshot,source:{...snapshot.source,downloadedAtUtc:'2026-02-30T00:00:00Z'}},
  {...snapshot,source:{...snapshot.source,license:'Unknown'}},
  {...snapshot,graph:{...snapshot.graph,engine:'google'}},
  {...snapshot,graph:{...snapshot.graph,sourceSha256:sha('d')}},
  {...snapshot,graph:{...snapshot.graph,buildSha256:null}},
  {...snapshot,graph:{...snapshot.graph,profileRevision:' ' }},
  {...snapshot,region:{...snapshot.region,bounds:[0,1,0,2]}},
  {...snapshot,region:{...snapshot.region,bounds:[-181,1,0,2]}},
];
for(const bad of invalidSnapshots) assert.throws(()=>validateResearchGraphSnapshot(bad));
// Research boundary must never be wired into a released surface or static beta.
const read=(name)=>readFileSync(new URL(name,import.meta.url),'utf8');
for (const path of ['../docs/app.js','../docs/map-beta/index.html',
  '../docs/map-beta/preview.mjs','../mobile/src/screens/SettingsScreen.tsx']) {
  assert.doesNotMatch(read(path), /draftMultiVehicleRoute|validateResearchGraphSnapshot/);
}
console.log('Maps: offline car/motorcycle/moped/scooter research contracts and graph identity validated.');
