import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseChargeInstant } from '../src/chargeInstant.ts';

describe('strict offset-bearing charging instants (future-only)', () => {
  it('preserves real instants, explicit offsets, milliseconds and leap days', () => {
    for (const value of [
      '2026-11-22T10:00:00Z',
      '2026-11-22T11:00:00+01:00',
      '2026-11-22T10:00:00.123Z',
      '2026-11-22T10:00:00.5Z',
      '2026-11-22T10:00:00.12+00:00',
      '2026-11-22T00:00:00+14:00',
      '2028-02-29T23:59:59-14:00',
      '2026-11-22T23:30:00-01:00',
    ]) assert.equal(parseChargeInstant(value), Date.parse(value), value);
    assert.equal(parseChargeInstant('2026-11-22T11:00:00+01:00'),
      parseChargeInstant('2026-11-22T10:00:00Z'));
  });
  it('never silently rolls midnight, invalid clock fields or false calendar dates', () => {
    for (const value of [
      '2026-02-30T00:00:00Z',
      '2027-02-29T00:00:00Z',
      '2026-13-01T00:00:00Z',
      '2026-11-22T24:00:00Z',
      '2026-11-22T23:60:00Z',
      '2026-11-22T23:59:60Z',
      '2026-11-22T25:00:00Z',
    ]) assert.equal(parseChargeInstant(value), null, value);
  });
  it('requires an explicit, valid UTC offset and strict timestamp syntax', () => {
    for (const value of [
      '2026-11-22T10:00:00',
      '2026-11-22',
      '2026-11-22T10:00Z',
      '2026-11-22T10:00:00+14:01',
      '2026-11-22T10:00:00-14:01',
      '2026-11-22T10:00:00+15:00',
      '2026-11-22T10:00:00+99:00',
      '2026-11-22T10:00:00+00:99',
      '2026-11-22T10:00:00.1234Z',
      '',
    ]) assert.equal(parseChargeInstant(value), null, value);
    for (const value of [null, 0, 42, {}, []])
      assert.equal(parseChargeInstant(value), null);
  });
});
