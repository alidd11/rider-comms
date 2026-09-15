import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HazardStore } from '../src/hazardStore.ts';

describe('HazardStore', () => {
  it('creates a report and finds it nearby', () => {
    const store = new HazardStore();
    const report = store.create('police', 40.0, -74.0, 'rider-1');
    assert.equal(report.type, 'police');
    assert.equal(report.reportedBy, 'rider-1');
    assert.equal(report.confirmations, 0);
    assert.equal(report.denials, 0);
    const found = store.nearby(40.0, -74.0, report.createdAt);
    assert.equal(found.length, 1);
    assert.equal(found[0].id, report.id);
  });

  it('does not surface reports far outside the geo-bucket neighborhood', () => {
    const store = new HazardStore();
    store.create('hazard', 40.0, -74.0, 'rider-1');
    const found = store.nearby(10.0, 100.0, Date.now());
    assert.equal(found.length, 0);
  });

  it('confirm and deny move the vote counts, ignoring a repeat vote from the same rider', () => {
    const store = new HazardStore();
    const report = store.create('accident', 40.0, -74.0, 'rider-1');
    assert.deepEqual(store.confirm(report.id, 'rider-2'), { ok: true });
    assert.deepEqual(store.confirm(report.id, 'rider-2'), { ok: true }); // duplicate, no double count
    assert.deepEqual(store.deny(report.id, 'rider-3'), { ok: true });
    const [current] = store.nearby(40.0, -74.0, report.createdAt);
    assert.equal(current.confirmations, 1);
    assert.equal(current.denials, 1);
  });

  it('returns not_found when voting on a nonexistent report', () => {
    const store = new HazardStore();
    assert.deepEqual(store.confirm('missing', 'rider-1'), { ok: false, reason: 'not_found' });
    assert.deepEqual(store.deny('missing', 'rider-1'), { ok: false, reason: 'not_found' });
  });

  it('hides a report once net denials cross the threshold, even before its TTL', () => {
    const store = new HazardStore();
    const report = store.create('road_closure', 40.0, -74.0, 'rider-1');
    store.deny(report.id, 'a');
    store.deny(report.id, 'b');
    store.deny(report.id, 'c');
    const found = store.nearby(40.0, -74.0, report.createdAt);
    assert.equal(found.length, 0);
  });

  it('excludes an expired report from nearby results', () => {
    const store = new HazardStore();
    const report = store.create('camera', 40.0, -74.0, 'rider-1');
    const found = store.nearby(40.0, -74.0, report.expiresAt + 1);
    assert.equal(found.length, 0);
  });

  it('lets only the reporter remove their own report', () => {
    const store = new HazardStore();
    const report = store.create('hazard', 40.0, -74.0, 'rider-1');
    assert.equal(store.remove(report.id, 'rider-2'), false);
    assert.equal(store.remove(report.id, 'rider-1'), true);
    assert.equal(store.get(report.id), undefined);
  });

  it('removes a rider deleting their account from all their reports', () => {
    const store = new HazardStore();
    const report = store.create('hazard', 40.0, -74.0, 'rider-1');
    store.deleteRider('rider-1');
    assert.equal(store.get(report.id), undefined);
  });
});
