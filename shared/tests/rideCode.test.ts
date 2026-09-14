import { describe, it } from 'node:test';
import { expect } from './testUtils.ts';
import {
  codeEntropyBits,
  createRideCodeRecord,
  generateRideCode,
  isRideCodeExpired,
} from '../src/rideCode.ts';

describe('generateRideCode', () => {
  it('generates a code of the requested length', () => {
    expect(generateRideCode(6)).toHaveLength(6);
    expect(generateRideCode(8)).toHaveLength(8);
  });

  it('never includes ambiguous characters (0/O, 1/I/L)', () => {
    const codes = Array.from({ length: 500 }, () => generateRideCode(6));
    const combined = codes.join('');
    for (const ambiguous of ['0', 'O', '1', 'I', 'L']) {
      expect(combined).not.toContain(ambiguous);
    }
  });

  it('generates distinct codes across many calls (sanity check, not a proof)', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateRideCode(6)));
    // With ~30 bits of entropy, collisions in 1000 draws should be extremely rare.
    expect(codes.size).toBeGreaterThan(990);
  });
});

describe('codeEntropyBits', () => {
  it('reports at least 25 bits for the default 6-character code (brute-force resistance sanity check)', () => {
    expect(codeEntropyBits(6)).toBeGreaterThan(25);
  });

  it('increases with code length', () => {
    expect(codeEntropyBits(8)).toBeGreaterThan(codeEntropyBits(6));
  });
});

describe('ride code expiration', () => {
  it('is not expired immediately after creation', () => {
    const record = createRideCodeRecord('ride-1');
    expect(isRideCodeExpired(record)).toBe(false);
  });

  it('is expired once the TTL has passed', () => {
    const record = createRideCodeRecord('ride-1', 1000); // 1 second TTL
    expect(isRideCodeExpired(record, record.createdAt + 1001)).toBe(true);
  });

  it('is not expired one millisecond before the TTL', () => {
    const record = createRideCodeRecord('ride-1', 1000);
    expect(isRideCodeExpired(record, record.createdAt + 999)).toBe(false);
  });
});
