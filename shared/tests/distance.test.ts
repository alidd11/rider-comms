import { describe, it } from 'node:test';
import { expect } from './testUtils.ts';
import { haversineMiles } from '../src/distance.ts';

describe('haversineMiles', () => {
  it('returns 0 for the same point', () => {
    expect(haversineMiles({ lat: 40.0, lon: -105.0 }, { lat: 40.0, lon: -105.0 })).toBe(0);
  });

  it('matches the known NYC -> LA distance within a reasonable tolerance', () => {
    const nyc = { lat: 40.7128, lon: -74.006 };
    const la = { lat: 34.0522, lon: -118.2437 };
    const distance = haversineMiles(nyc, la);
    // Real great-circle distance is ~2445 miles.
    expect(distance).toBeGreaterThan(2400);
    expect(distance).toBeLessThan(2500);
  });

  it('is symmetric', () => {
    const a = { lat: 51.5074, lon: -0.1278 };
    const b = { lat: 48.8566, lon: 2.3522 };
    expect(haversineMiles(a, b)).toBeCloseTo(haversineMiles(b, a), 6);
  });

  it('gives a small distance for two nearby points (~1 mile apart)', () => {
    // ~1 mile north
    const a = { lat: 40.0, lon: -105.0 };
    const b = { lat: 40.0145, lon: -105.0 };
    const distance = haversineMiles(a, b);
    expect(distance).toBeGreaterThan(0.9);
    expect(distance).toBeLessThan(1.1);
  });
});
