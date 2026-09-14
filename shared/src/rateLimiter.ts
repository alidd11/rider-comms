/**
 * A minimal sliding-window rate limiter. Used to throttle ride-code join
 * attempts (Section 13 of the spec — a ride code is a de facto password,
 * so brute-forcing it needs to be slow and noisy, not free) and can double
 * up for other abuse-prone actions like public-channel join attempts from
 * a brand-new account.
 *
 * In-memory only — fine for a single backend instance / prototype. A real
 * multi-instance deployment needs this backed by something shared (Redis)
 * so limits are enforced across instances, not per-instance.
 */
export class SlidingWindowRateLimiter {
  private hits = new Map<string, number[]>();
  private readonly maxHits: number;
  private readonly windowMs: number;

  constructor(maxHits: number, windowMs: number) {
    this.maxHits = maxHits;
    this.windowMs = windowMs;
  }

  /**
   * Returns true if this attempt is allowed and records it; returns false
   * (without counting it as a "successful" attempt) if the key has already
   * hit the limit within the current window.
   */
  tryConsume(key: string, now = Date.now()): boolean {
    const windowStart = now - this.windowMs;
    const existing = (this.hits.get(key) ?? []).filter((t) => t > windowStart);

    if (existing.length >= this.maxHits) {
      this.hits.set(key, existing);
      return false;
    }

    existing.push(now);
    this.hits.set(key, existing);
    return true;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}
