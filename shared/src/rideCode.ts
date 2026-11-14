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

/** Riders already announced as on a low battery. */
export type RideBatteryState = Readonly<Record<string, true>>;

/** A phone at or under this charge, and not charging, reports battery low. */
export const RIDE_BATTERY_LOW_LEVEL = 0.15;

/** Whether this phone should tell the group its battery is low. */
export function isRideBatteryLow(level: number | null | undefined, charging: boolean): boolean {
  return !charging && typeof level === 'number' && level >= 0 && level <= RIDE_BATTERY_LOW_LEVEL;
}

/**
 * What the group hears when another rider's phone battery runs low, so a
 * rider who then stops updating has an explanation. Said once per rider;
 * if they charge up and run low again, it's said again.
 */
export function rideBatteryAnnouncements(
  previous: RideBatteryState,
  locations: ReadonlyArray<{ riderId: string; batteryLow?: boolean }>,
  names: Readonly<Record<string, string>>,
): { state: RideBatteryState; announcements: string[] } {
  const state: Record<string, true> = {};
  const announcements: string[] = [];
  for (const { riderId, batteryLow } of locations) {
    if (!batteryLow) continue;
    if (!previous[riderId]) announcements.push(`${names[riderId] || 'A rider'}’s phone battery is low.`);
    state[riderId] = true;
  }
  return { state, announcements };
}

/**
 * The line a rider sees when their ride ends: how long it lasted, how many
 * rode, and how far this rider went when their position was shared
 * ("1 h 42 min · 4 riders · 38.2 mi"). Distance under 0.1 of a unit, or not
 * measured, is left out rather than shown as nothing.
 */
export function rideSummary(
  durationMs: number,
  riders: number,
  distanceMeters: number | null,
  unit: 'mi' | 'km',
): string {
  const minutes = Math.max(0, Math.round((Number.isFinite(durationMs) ? durationMs : 0) / 60_000));
  const duration = minutes < 1
    ? 'Under a minute'
    : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  const parts = [duration, riders > 1 ? `${riders} riders` : 'Just you'];
  const distance = distanceMeters != null && Number.isFinite(distanceMeters)
    ? distanceMeters / (unit === 'km' ? 1000 : 1609.344)
    : 0;
  if (distance >= 0.1) parts.push(`${distance.toFixed(1)} ${unit}`);
  return parts.join(' · ');
}

/** A finished ride, kept on the rider's device for "Recent rides". */
export interface RideHistoryEntry {
  endedAt: number;
  durationMs: number;
  riders: number;
  distanceMeters: number | null;
}

/** How many finished rides "Recent rides" keeps. */
export const RIDE_HISTORY_MAX = 10;

/** Rides shorter than this (a ride started and ended by mistake) aren't kept. */
export const RIDE_HISTORY_MIN_MS = 60_000;

/** The device key for a rider's recent rides (both apps). */
export function rideHistoryStorageKey(riderId: string): string {
  return `riderComms.rideHistory.${riderId}`;
}

/** Reads saved recent rides, newest first, dropping anything malformed. */
export function parseRideHistory(raw: string | null | undefined): RideHistoryEntry[] {
  let value: unknown;
  try { value = JSON.parse(raw ?? '[]'); } catch { return []; }
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is RideHistoryEntry => Boolean(entry) && typeof entry === 'object'
      && Number.isFinite(entry.endedAt)
      && Number.isFinite(entry.durationMs) && entry.durationMs >= 0
      && Number.isInteger(entry.riders) && entry.riders >= 1
      && (entry.distanceMeters === null || (Number.isFinite(entry.distanceMeters) && entry.distanceMeters >= 0)))
    .map(({ endedAt, durationMs, riders, distanceMeters }) => ({ endedAt, durationMs, riders, distanceMeters }))
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, RIDE_HISTORY_MAX);
}

/** Adds a finished ride to the front, keeping the newest RIDE_HISTORY_MAX.
 * A ride under a minute is left out. */
export function withRideHistoryEntry(history: readonly RideHistoryEntry[], entry: RideHistoryEntry): RideHistoryEntry[] {
  if (!(entry.durationMs >= RIDE_HISTORY_MIN_MS)) return [...history];
  return [entry, ...history].slice(0, RIDE_HISTORY_MAX);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One "Recent rides" row in the device's local time:
 * "Today · 1 h 42 min · 4 riders · 38.2 mi", "Yesterday · …" or "Sat 14 Nov · …". */
export function rideHistoryLine(entry: RideHistoryEntry, unit: 'mi' | 'km', now: number): string {
  const ended = new Date(entry.endedAt);
  const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const daysAgo = Math.round((dayStart(new Date(now)) - dayStart(ended)) / 86_400_000);
  const day = daysAgo === 0 ? 'Today'
    : daysAgo === 1 ? 'Yesterday'
      : `${WEEKDAYS[ended.getDay()]} ${ended.getDate()} ${MONTHS[ended.getMonth()]}`;
  return `${day} · ${rideSummary(entry.durationMs, entry.riders, entry.distanceMeters, unit)}`;
}
