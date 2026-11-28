import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CHARGE_REVIEW_AGE_DAYS,
  reviewChargeEvidenceFreshness,
} from '../src/chargeSourceFreshness.ts';

const screen = (type: Parameters<typeof reviewChargeEvidenceFreshness>[0],
  checkedAt: unknown, travelAt = '2026-11-22T10:00:00Z') =>
  reviewChargeEvidenceFreshness(type, checkedAt, travelAt);

describe('future-only charge/entitlement/geometry review freshness', () => {
  it('uses conservative, nonconfigurable per-subject review maximums', () => {
    assert.deepEqual(MAX_CHARGE_REVIEW_AGE_DAYS,
      { rule: 30, tariff: 7, entitlement: 7, geometry: 30 });
    assert.ok(Object.isFrozen(MAX_CHARGE_REVIEW_AGE_DAYS));
    for (const type of ['rule','tariff','entitlement','geometry'] as const)
      assert.equal(screen(type, '2026-11-21T10:00:00Z').status, 'fresh');
  });
  it('accepts the exact rule/geometry boundary but refuses the next millisecond', () => {
    for (const type of ['rule', 'geometry'] as const) {
      assert.equal(screen(type, '2026-10-23T10:00:00Z').status, 'fresh');
      assert.equal(screen(type, '2026-10-23T09:59:59.999Z').status, 'review_stale');
    }
  });
  it('requires a fresher check for monetary tariffs and verified exemptions', () => {
    for (const type of ['tariff', 'entitlement'] as const) {
      assert.equal(screen(type, '2026-11-15T10:00:00Z').status, 'fresh');
      assert.equal(screen(type, '2026-11-15T09:59:59.999Z').status, 'review_stale');
    }
  });
  it('rejects future review instants and invalid/calendrical source timestamps', () => {
    assert.equal(screen('rule','2026-11-22T10:00:01Z').status, 'review_after_passage');
    assert.equal(screen('rule','2026-11-22T10:00:00Z').status, 'fresh');
    for (const bad of ['',null,123,{},'2026-02-30T00:00:00Z',
      '2026-11-22T12:00:00','2026-11-22','2026-11-22T12:00:00+14:01',
      '2026-11-22T10:00:00+99:00',
      '2026-11-22T24:00:00Z','2026-11-22T23:60:00Z',
      '2026-11-22T10:00:60Z','2026-11-22T10:00:00+14:30']) {
      assert.equal(screen('rule',bad).status, 'invalid_timestamp');
    }
    assert.equal(screen('rule', '2026-11-21T10:00:00Z','2026-02-30T10:00:00Z').status,'invalid_timestamp');
    assert.equal(screen('rule', '2026-11-21T10:00:00Z','bad').status,'invalid_timestamp');
    assert.equal(screen('rule','2026-11-21T10:00:00Z',
      '2026-11-22T24:00:00Z').status, 'invalid_timestamp');
  });
  it('correctly handles BST offsets, the leap day and a genuine cross-midnight interval', () => {
    assert.equal(screen('entitlement','2026-11-21T11:00:00+01:00').status, 'fresh');
    assert.equal(screen('rule', '2028-02-29T10:00:00Z', '2028-03-01T10:00:00Z').status, 'fresh');
    assert.equal(screen('tariff','2026-11-21T23:30:00Z',
      '2026-11-22T00:30:00Z').status,'fresh');
  });
  it('cannot be bypassed by fabricated review categories', () => {
    assert.equal(screen('__proto__' as 'rule','2026-11-21T10:00:00Z').status,'invalid_timestamp');
    assert.equal(screen('fake' as 'rule','2026-11-21T10:00:00Z').status,'invalid_timestamp');
  });
});
