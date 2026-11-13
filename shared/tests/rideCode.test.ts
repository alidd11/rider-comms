import { describe, it } from 'node:test';
import { expect } from './testUtils.ts';
import {
  codeEntropyBits,
  createRideCodeRecord,
  generateRideCode,
  isRideCodeExpired,
  normalizeRegroupLabel,
  regroupAnnouncement,
  rideMemberLastSeenAgo,
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

describe('regroup labels', () => {
  it('are one trimmed line of at most 80 characters, or empty', () => {
    expect(normalizeRegroupLabel('  Esso,\n  A1 ')).toBe('Esso, A1');
    expect(normalizeRegroupLabel('x'.repeat(100))).toHaveLength(80);
    expect(normalizeRegroupLabel(undefined)).toBe('');
    expect(normalizeRegroupLabel(42)).toBe('');
  });
});

describe('ride member last seen', () => {
  it('is null while updates arrive, then says how long ago in seconds or minutes', () => {
    const now = 1_000_000;
    expect(rideMemberLastSeenAgo(now - 5_000, now)).toBe(null);
    expect(rideMemberLastSeenAgo(now - 20_000, now)).toBe(null);
    expect(rideMemberLastSeenAgo(now - 45_000, now)).toBe('40 s ago');
    expect(rideMemberLastSeenAgo(now - 60_000, now)).toBe('1 min ago');
    expect(rideMemberLastSeenAgo(now - 9.5 * 60_000, now)).toBe('9 min ago');
    expect(rideMemberLastSeenAgo(Number.NaN, now)).toBe(null);
  });
});

describe('regroup announcement', () => {
  const esso = { lat: 51.6, lon: -0.2, label: 'Esso, A1', setAt: 1 };
  it('speaks a new or moved point to members only', () => {
    expect(regroupAnnouncement(null, esso, false)).toBe('Regroup at Esso, A1.');
    expect(regroupAnnouncement(esso, { ...esso, setAt: 2, label: '' }, false)).toBe('Regroup point set. It’s on your map.');
    expect(regroupAnnouncement(null, esso, true)).toBe(null);
  });
  it('stays quiet for an unchanged, cleared or already-known point', () => {
    expect(regroupAnnouncement(esso, esso, false)).toBe(null);
    expect(regroupAnnouncement(esso, null, false)).toBe(null);
    expect(regroupAnnouncement(undefined, esso, false)).toBe(null);
  });
});
