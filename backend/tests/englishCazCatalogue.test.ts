import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ENGLISH_CAZ_CATALOGUE, ENGLISH_CAZ_SOURCE, ENGLISH_CAZ_VEHICLE_CHECK,
  findEnglishCaz, isEnglishCazCatalogueCurrent } from '../src/englishCazCatalogue.ts';

describe('offline GOV.UK Clean Air Zone reference catalogue', () => {
  it('contains all seven government-listed zones, with their distinct classes', () => {
    assert.deepEqual(ENGLISH_CAZ_CATALOGUE.map(x => [x.id, x.cazClass]), [
      ['bath_caz', 'C'], ['birmingham_caz', 'D'], ['bradford_caz', 'C'],
      ['bristol_caz', 'D'], ['portsmouth_caz', 'B'], ['sheffield_caz', 'C'],
      ['tyneside_caz', 'C'],
    ]);
    assert.equal(new Set(ENGLISH_CAZ_CATALOGUE.map(x => x.id)).size, 7);
    assert.equal(ENGLISH_CAZ_SOURCE, 'https://www.gov.uk/guidance/driving-in-a-clean-air-zone');
    assert.equal(ENGLISH_CAZ_VEHICLE_CHECK, 'https://www.gov.uk/clean-air-zones');
    assert.equal(findEnglishCaz('bradford_caz')?.label, 'Bradford');
    assert.equal(findEnglishCaz('unknown'), undefined);
  });
  it('flags stale, future, and invalid source review dates', () => {
    assert.equal(isEnglishCazCatalogueCurrent('2026-11-21'), true);
    assert.equal(isEnglishCazCatalogueCurrent('2027-02-19'), true);
    assert.equal(isEnglishCazCatalogueCurrent('2027-02-20'), false);
    assert.equal(isEnglishCazCatalogueCurrent('2026-11-20'), false);
    assert.equal(isEnglishCazCatalogueCurrent('not-a-date'), false);
    assert.equal(isEnglishCazCatalogueCurrent('2026-02-30'), false);
  });
  it('keeps the catalogue immutable and does not infer a vehicle exemption', () => {
    assert.ok(Object.isFrozen(ENGLISH_CAZ_CATALOGUE));
    assert.ok(Object.isFrozen(ENGLISH_CAZ_CATALOGUE[0]));
    assert.equal('motorcyclesExempt' in ENGLISH_CAZ_CATALOGUE[1]!, false);
    assert.equal('pricePence' in ENGLISH_CAZ_CATALOGUE[1]!, false);
  });
});
