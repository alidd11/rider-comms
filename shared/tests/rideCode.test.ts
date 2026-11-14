import { describe, it } from 'node:test';
import { expect } from './testUtils.ts';
import {
  codeEntropyBits,
  createRideCodeRecord,
  generateRideCode,
  isRideCodeExpired,
  normalizeRegroupLabel,
  regroupAnnouncement,
  isRideBatteryLow,
  rideBatteryAnnouncements,
  rideDropAnnouncements,
  rideMemberLastSeenAgo,
  rideSummary,
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

describe('dropped rider announcements', () => {
  const now = 1_000_000;
  const names = { sam: 'Sam', jo: 'Jo' };
  it('announces a rider seen live once their position stops for two minutes, then once when it returns', () => {
    let step = rideDropAnnouncements({}, [{ riderId: 'sam', updatedAt: now }], names, now);
    expect(step.announcements).toEqual([]);
    expect(step.state).toEqual({ sam: 'fresh' });
    // Quiet while merely late.
    step = rideDropAnnouncements(step.state, [{ riderId: 'sam', updatedAt: now }], names, now + 60_000);
    expect(step.announcements).toEqual([]);
    step = rideDropAnnouncements(step.state, [{ riderId: 'sam', updatedAt: now }], names, now + 120_000);
    expect(step.announcements).toEqual(['Sam’s position hasn’t updated for 2 minutes.']);
    // Said once per drop.
    step = rideDropAnnouncements(step.state, [{ riderId: 'sam', updatedAt: now }], names, now + 180_000);
    expect(step.announcements).toEqual([]);
    step = rideDropAnnouncements(step.state, [{ riderId: 'sam', updatedAt: now + 200_000 }], names, now + 205_000);
    expect(step.announcements).toEqual(['Sam’s position is updating again.']);
    expect(step.state).toEqual({ sam: 'fresh' });
  });
  it('stays quiet for a rider never seen live, one who stopped sharing, or a bad timestamp', () => {
    const stale = rideDropAnnouncements({}, [{ riderId: 'jo', updatedAt: now - 300_000 }], names, now);
    expect(stale.announcements).toEqual([]);
    expect(stale.state).toEqual({});
    const left = rideDropAnnouncements({ jo: 'fresh' }, [], names, now);
    expect(left.announcements).toEqual([]);
    expect(left.state).toEqual({});
    const odd = rideDropAnnouncements({ jo: 'fresh' }, [{ riderId: 'jo', updatedAt: Number.NaN }], names, now);
    expect(odd.announcements).toEqual([]);
    expect(odd.state).toEqual({ jo: 'fresh' });
  });
  it('names an unknown rider plainly', () => {
    const step = rideDropAnnouncements({ x: 'fresh' }, [{ riderId: 'x', updatedAt: now - 130_000 }], {}, now);
    expect(step.announcements).toEqual(['A rider’s position hasn’t updated for 2 minutes.']);
  });
});

describe('ride summary', () => {
  it('reads the length, the group and the distance', () => {
    expect(rideSummary(102 * 60_000, 4, 61_472, 'mi')).toBe('1 h 42 min · 4 riders · 38.2 mi');
    expect(rideSummary(120 * 60_000, 2, 12_345, 'km')).toBe('2 h · 2 riders · 12.3 km');
    expect(rideSummary(25 * 60_000, 1, null, 'mi')).toBe('25 min · Just you');
  });
  it('leaves out a distance too small to mean anything and copes with odd input', () => {
    expect(rideSummary(20_000, 3, 50, 'mi')).toBe('Under a minute · 3 riders');
    expect(rideSummary(Number.NaN, 2, Number.NaN, 'km')).toBe('Under a minute · 2 riders');
  });
});

describe('low battery announcements', () => {
  it('reports battery low at 15% or under, only when not charging', () => {
    expect(isRideBatteryLow(0.15, false)).toBe(true);
    expect(isRideBatteryLow(0.05, false)).toBe(true);
    expect(isRideBatteryLow(0.16, false)).toBe(false);
    expect(isRideBatteryLow(0.05, true)).toBe(false);
    // Unknown levels (-1 on simulators, missing on some browsers).
    expect(isRideBatteryLow(-1, false)).toBe(false);
    expect(isRideBatteryLow(null, false)).toBe(false);
    expect(isRideBatteryLow(undefined, false)).toBe(false);
  });
  it('says it once per rider, and again if they run low after charging', () => {
    const names = { sam: 'Sam' };
    let step = rideBatteryAnnouncements({}, [{ riderId: 'sam' }, { riderId: 'x', batteryLow: true }], names);
    expect(step.announcements).toEqual(['A rider’s phone battery is low.']);
    step = rideBatteryAnnouncements(step.state, [{ riderId: 'sam', batteryLow: true }, { riderId: 'x', batteryLow: true }], names);
    expect(step.announcements).toEqual(['Sam’s phone battery is low.']);
    step = rideBatteryAnnouncements(step.state, [{ riderId: 'sam', batteryLow: true }], names);
    expect(step.announcements).toEqual([]);
    step = rideBatteryAnnouncements(step.state, [{ riderId: 'sam' }], names);
    expect(step.state).toEqual({});
    step = rideBatteryAnnouncements(step.state, [{ riderId: 'sam', batteryLow: true }], names);
    expect(step.announcements).toEqual(['Sam’s phone battery is low.']);
  });
});
