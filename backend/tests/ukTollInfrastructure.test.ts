import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ENGLISH_TOLL_INFRASTRUCTURE, PARLIAMENT_TOLL_INVENTORY_ANSWER_DATE,
  PARLIAMENT_TOLL_INVENTORY_SOURCE, findEnglishTollInfrastructure,
  isEnglishTollInventoryFresh } from '../src/ukTollInfrastructure.ts';

describe('2026 DfT toll-infrastructure research catalogue (not live routing)', () => {
  it('records all 20 independently listed English infrastructure groups', () => {
    assert.equal(ENGLISH_TOLL_INFRASTRUCTURE.length, 20);
    assert.equal(new Set(ENGLISH_TOLL_INFRASTRUCTURE.map(item => item.id)).size, 20);
    assert.equal(PARLIAMENT_TOLL_INVENTORY_ANSWER_DATE, '2026-07-08');
    assert.match(PARLIAMENT_TOLL_INVENTORY_SOURCE, /^https:\/\/questions-statements\.parliament\.uk\//);
    assert.deepEqual(ENGLISH_TOLL_INFRASTRUCTURE.map(item => item.id), [
      'm6_toll', 'aldwark_bridge', 'batheaston_bridge', 'blackwall_silvertown',
      'cartford_bridge', 'clifton_suspension_bridge', 'dartford_crossing',
      'dunham_bridge', 'eling_bridge', 'humber_bridge', 'itchen_bridge',
      'kingsland_bridge', 'mersey_gateway_silver_jubilee', 'mersey_tunnels',
      'rixton_warburton_bridge', 'swinford_bridge', 'tamar_bridge',
      'tyne_tunnels', 'whitchurch_bridge', 'whitney_on_wye_bridge',
    ]);
  });
  it('distinguishes a zoned motorway journey from crossings and capped bridges', () => {
    assert.equal(findEnglishTollInfrastructure('m6_toll')?.assessmentModel, 'journey_zones');
    assert.equal(findEnglishTollInfrastructure('m6_toll')?.kind, 'motorway');
    assert.equal(findEnglishTollInfrastructure('dartford_crossing')?.kind, 'motorway_crossing');
    assert.equal(findEnglishTollInfrastructure('tamar_bridge')?.assessmentModel, 'directional_passage');
    assert.equal(findEnglishTollInfrastructure('rixton_warburton_bridge')?.assessmentModel, 'daily_passage_cap');
    assert.equal(findEnglishTollInfrastructure('humber_bridge')?.assessmentModel, 'per_passage');
    assert.equal(findEnglishTollInfrastructure('mersey_tunnels')?.assessmentModel, 'operator_review_required');
  });
  it('never implies official vehicle classification, road verification, prices or a free route', () => {
    assert.ok(Object.isFrozen(ENGLISH_TOLL_INFRASTRUCTURE));
    for (const entry of ENGLISH_TOLL_INFRASTRUCTURE) {
      assert.ok(Object.isFrozen(entry));
      assert.equal(entry.requiresVehicleClassificationReview, true);
      assert.equal(entry.requiresRoadEvidenceReview, true);
      assert.equal('pricePence' in entry, false);
      assert.equal('exemptMotorcycles' in entry, false);
      assert.equal('confirmedCrossing' in entry, false);
      if (entry.operatorUrl) assert.match(entry.operatorUrl, /^https:\/\//);
    }
  });
  it('does not describe an old England-only list as current UK-wide coverage', () => {
    assert.equal(isEnglishTollInventoryFresh('2026-07-08'), true);
    assert.equal(isEnglishTollInventoryFresh('2026-10-06'), true);
    assert.equal(isEnglishTollInventoryFresh('2026-10-07'), false);
    assert.equal(isEnglishTollInventoryFresh('2026-11-21'), false);
    assert.equal(isEnglishTollInventoryFresh('2026-02-30'), false);
    assert.equal(isEnglishTollInventoryFresh('invalid'), false);
    assert.equal(ENGLISH_TOLL_INFRASTRUCTURE.some(road => road.id === 'unknown_welsh_toll'), false);
  });
  it('fails closed for unknown IDs, null values and inherited object properties', () => {
    for (const invalid of [null, undefined, '', 'm42_toll', '__proto__',
      'constructor', {}, ['m6_toll'], 42]) assert.equal(findEnglishTollInfrastructure(invalid), null);
  });
});
