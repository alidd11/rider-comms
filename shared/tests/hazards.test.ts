import { describe, it } from 'node:test';
import { expect } from './testUtils.ts';
import { isExpired, shouldHide, ttlMsForType } from '../src/hazards.ts';
import type { HazardReport } from '../src/hazards.ts';

function makeReport(overrides: Partial<HazardReport> = {}): HazardReport {
  return {
    id: 'r1',
    type: 'accident',
    lat: 40,
    lon: -70,
    reportedBy: 'rider-1',
    createdAt: 0,
    expiresAt: 1000,
    confirmations: 0,
    denials: 0,
    ...overrides,
  };
}

describe('ttlMsForType', () => {
  it('expires fast-moving checkpoint types (police, camera) fastest', () => {
    expect(ttlMsForType('police')).toBe(ttlMsForType('camera'));
    expect(ttlMsForType('police')).toBeLessThan(ttlMsForType('accident'));
  });

  it('gives road_closure the longest window since closures persist for hours', () => {
    expect(ttlMsForType('road_closure')).toBeGreaterThan(ttlMsForType('accident'));
  });

  it('treats hidden_police and police_checkpoint as fast-moving, same as police/camera', () => {
    expect(ttlMsForType('hidden_police')).toBe(ttlMsForType('police'));
    expect(ttlMsForType('police_checkpoint')).toBe(ttlMsForType('police'));
  });

  it('keeps accident reports between fast-moving reports and closures', () => {
    expect(ttlMsForType('accident')).toBeGreaterThan(ttlMsForType('police'));
    expect(ttlMsForType('accident')).toBeLessThan(ttlMsForType('road_closure'));
  });
});

describe('isExpired', () => {
  it('is not expired strictly before expiresAt', () => {
    const report = makeReport({ expiresAt: 1000 });
    expect(isExpired(report, 999)).toBe(false);
  });

  it('is expired exactly at expiresAt (boundary is inclusive)', () => {
    const report = makeReport({ expiresAt: 1000 });
    expect(isExpired(report, 1000)).toBe(true);
  });

  it('is expired well after expiresAt', () => {
    const report = makeReport({ expiresAt: 1000 });
    expect(isExpired(report, 5000)).toBe(true);
  });
});

describe('shouldHide', () => {
  it('stays visible when net denials are just under the threshold', () => {
    const report = makeReport({ confirmations: 0, denials: 2 });
    expect(shouldHide(report)).toBe(false);
  });

  it('hides once net denials reach the threshold', () => {
    const report = makeReport({ confirmations: 0, denials: 3 });
    expect(shouldHide(report)).toBe(true);
  });

  it('hides once net denials exceed the threshold', () => {
    const report = makeReport({ confirmations: 1, denials: 5 });
    expect(shouldHide(report)).toBe(true);
  });

  it('confirmations offset denials so an actively confirmed report stays visible', () => {
    const report = makeReport({ confirmations: 5, denials: 5 });
    expect(shouldHide(report)).toBe(false);
  });
});
