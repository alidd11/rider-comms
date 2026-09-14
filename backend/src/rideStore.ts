import { randomUUID } from 'node:crypto';
import {
  createRideCodeRecord,
  isRideCodeExpired,
  SlidingWindowRateLimiter,
} from '@rider-comms/shared';
import type { RideCodeRecord } from '@rider-comms/shared';

export interface Ride {
  id: string;
  createdBy: string;
  createdAt: number;
  memberIds: Set<string>;
}

export type JoinRideResult =
  | { ok: true; rideId: string }
  | { ok: false; reason: 'rate_limited' | 'invalid_or_expired' };

/**
 * Private ride groups (Section 5 of the spec): create a ride, get a code,
 * others join with it. Join attempts are rate-limited (Section 13 — a ride
 * code is effectively a password to a live voice room) and an invalid code
 * and an expired code return the identical response, so a guesser can't
 * use the response to tell a near-miss from a stale one.
 */
export class RideStore {
  private rides = new Map<string, Ride>();
  private codesByValue = new Map<string, RideCodeRecord>();
  private joinLimiter: SlidingWindowRateLimiter;

  constructor(maxJoinAttempts = 5, windowMs = 60_000) {
    this.joinLimiter = new SlidingWindowRateLimiter(maxJoinAttempts, windowMs);
  }

  createRide(creatorId: string): { ride: Ride; codeRecord: RideCodeRecord } {
    const id = randomUUID();
    const ride: Ride = {
      id,
      createdBy: creatorId,
      createdAt: Date.now(),
      memberIds: new Set([creatorId]),
    };
    this.rides.set(id, ride);

    const codeRecord = createRideCodeRecord(id);
    this.codesByValue.set(codeRecord.code, codeRecord);
    return { ride, codeRecord };
  }

  joinRide(code: string, riderId: string, rateLimitKey: string): JoinRideResult {
    if (!this.joinLimiter.tryConsume(rateLimitKey)) {
      return { ok: false, reason: 'rate_limited' };
    }

    const record = this.codesByValue.get(code.toUpperCase());
    if (!record || isRideCodeExpired(record)) {
      return { ok: false, reason: 'invalid_or_expired' };
    }

    const ride = this.rides.get(record.rideId);
    if (!ride) {
      return { ok: false, reason: 'invalid_or_expired' };
    }

    ride.memberIds.add(riderId);
    return { ok: true, rideId: ride.id };
  }

  getRide(rideId: string): Ride | undefined {
    return this.rides.get(rideId);
  }
}
