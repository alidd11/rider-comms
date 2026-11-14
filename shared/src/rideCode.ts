// Excludes 0/O, 1/I/L — ambiguous when read aloud or handwritten on a gas-station napkin.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DEFAULT_CODE_LENGTH = 6;
/** A code lapses after 12 hours without ride activity (the backend slides it forward while the ride is in use). */
export const RIDE_CODE_IDLE_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = RIDE_CODE_IDLE_TTL_MS;

/**
 * Uses the Web Crypto API (crypto.getRandomValues) rather than Node's
 * crypto.randomInt so this module stays portable to React Native's
 * Hermes engine and browsers, not just Node — shared/ has no
 * runtime-specific dependencies.
 */
function randomIndex(max: number): number {
  const range = 256 - (256 % max);
  const bytes = new Uint8Array(1);
  let value: number;
  do {
    globalThis.crypto.getRandomValues(bytes);
    value = bytes[0];
  } while (value >= range);
  return value % max;
}

export function generateRideCode(length = DEFAULT_CODE_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[randomIndex(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Bits of entropy for a code of this length over this alphabet. Section 13
 * of the spec flags that a ride code is effectively a password to a live
 * voice room — this exists so brute-force resistance is a number you can
 * check, not a guess. 6 chars over the 31-symbol alphabet is about 29.7 bits
 * (~887 million combinations); paired with join-attempt rate limiting
 * (see rateLimiter.ts) that's solid for a consumer product.
 */
export function codeEntropyBits(length = DEFAULT_CODE_LENGTH): number {
  return Math.log2(CODE_ALPHABET.length) * length;
}

export interface RideCodeRecord {
  code: string;
  rideId: string;
  createdAt: number;
  expiresAt: number;
}

export function createRideCodeRecord(
  rideId: string,
  ttlMs = DEFAULT_TTL_MS
): RideCodeRecord {
  const createdAt = Date.now();
  return {
    code: generateRideCode(),
    rideId,
    createdAt,
    expiresAt: createdAt + ttlMs,
  };
}

export function isRideCodeExpired(
  record: RideCodeRecord,
  now = Date.now()
): boolean {
  return now >= record.expiresAt;
}

/** Where the host has asked the group to meet up, e.g. a petrol station. */
export interface RegroupPoint {
  lat: number;
  lon: number;
  /** The place's name, or empty for a point dropped on the map. */
  label: string;
  setAt: number;
}

export const REGROUP_LABEL_MAX_LENGTH = 80;

/** A regroup label as stored: one line, trimmed, at most 80 characters. */
export function normalizeRegroupLabel(label: unknown): string {
  if (typeof label !== 'string') return '';
  return label.replace(/\s+/g, ' ').trim().slice(0, REGROUP_LABEL_MAX_LENGTH);
}

/** A member's ride position counts as live while updates keep arriving (two
 * 10 s location ticks); after that it is where they were last seen. */
export const RIDE_LOCATION_FRESH_MS = 20_000;

/**
 * How long ago a member's position was last updated, for the map ("2 min
 * ago"), or null while it is live. The server keeps a last-seen position for
 * 10 minutes, and only while the member is still sharing.
 */
export function rideMemberLastSeenAgo(updatedAt: number, now: number): string | null {
  const age = now - updatedAt;
  if (!Number.isFinite(age) || age <= RIDE_LOCATION_FRESH_MS) return null;
  if (age < 60_000) return `${Math.floor(age / 10_000) * 10} s ago`;
  return `${Math.floor(age / 60_000)} min ago`;
}

/**
 * What a member hears when the host sets or moves the regroup point, or null
 * when there's nothing new to say: no point, the host's own change, or a
 * point that was already there when the app learned about the ride
 * (`previous` undefined means "not known yet").
 */
export function regroupAnnouncement(
  previous: RegroupPoint | null | undefined,
  next: RegroupPoint | null | undefined,
  isHost: boolean,
): string | null {
  if (isHost || !next || previous === undefined) return null;
  if (previous && previous.setAt === next.setAt) return null;
  return next.label ? `Regroup at ${next.label}.` : 'Regroup point set. It’s on your map.';
}

/** After this long without a position update, the group hears that a rider
 * has dropped off (lost signal, flat battery, a crash). */
export const RIDE_DROPPED_ALERT_MS = 120_000;

/** Per rider: last heard live ('fresh'), or already announced as dropped. */
export type RideDropState = Readonly<Record<string, 'fresh' | 'dropped'>>;

/**
 * What the group hears as other riders' positions stop or start updating.
 * Only a rider seen live in this session is announced, once per drop, and
 * again when their position comes back. A rider who stops sharing leaves
 * `locations` altogether and is not announced: that was their choice.
 */
export function rideDropAnnouncements(
  previous: RideDropState,
  locations: ReadonlyArray<{ riderId: string; updatedAt: number }>,
  names: Readonly<Record<string, string>>,
  now: number,
): { state: RideDropState; announcements: string[] } {
  const state: Record<string, 'fresh' | 'dropped'> = {};
  const announcements: string[] = [];
  for (const { riderId, updatedAt } of locations) {
    const age = now - updatedAt;
    const was = previous[riderId];
    const name = names[riderId] || 'A rider';
    if (Number.isFinite(age) && age <= RIDE_LOCATION_FRESH_MS) {
      if (was === 'dropped') announcements.push(`${name}’s position is updating again.`);
      state[riderId] = 'fresh';
    } else if (was === 'fresh' && Number.isFinite(age) && age >= RIDE_DROPPED_ALERT_MS) {
      announcements.push(`${name}’s position hasn’t updated for 2 minutes.`);
      state[riderId] = 'dropped';
    } else if (was) {
      state[riderId] = was;
    }
  }
  return { state, announcements };
}
