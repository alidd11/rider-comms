// Excludes 0/O, 1/I/L — ambiguous when read aloud or handwritten on a gas-station napkin.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DEFAULT_CODE_LENGTH = 6;
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours idle expiry

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
 * check, not a guess. 6 chars over a 32-symbol alphabet is 30 bits
 * (~1 billion combinations); paired with join-attempt rate limiting
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
