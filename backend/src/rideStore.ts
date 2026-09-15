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

export type RideActionResult =
  | { ok: true; ride: Ride }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'not_member' };

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
  private riderJoinLimiter: SlidingWindowRateLimiter;
  private ipJoinLimiter: SlidingWindowRateLimiter;

  constructor(maxJoinAttempts = 5, windowMs = 60_000) {
    this.riderJoinLimiter = new SlidingWindowRateLimiter(maxJoinAttempts, windowMs);
    this.ipJoinLimiter = new SlidingWindowRateLimiter(maxJoinAttempts * 4, windowMs);
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

    let codeRecord = createRideCodeRecord(id);
    while (this.codesByValue.has(codeRecord.code)) codeRecord = createRideCodeRecord(id);
    this.codesByValue.set(codeRecord.code, codeRecord);
    return { ride, codeRecord };
  }

  joinRide(code: string, riderId: string, rateLimitKey: string): JoinRideResult {
    if (!this.riderJoinLimiter.tryConsume(riderId) || !this.ipJoinLimiter.tryConsume(rateLimitKey)) {
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

  getRideForMember(rideId: string, riderId: string): RideActionResult {
    const ride = this.rides.get(rideId);
    if (!ride) return { ok: false, reason: 'not_found' };
    if (!ride.memberIds.has(riderId)) return { ok: false, reason: 'not_member' };
    return { ok: true, ride };
  }

  leaveRide(rideId: string, riderId: string): RideActionResult {
    const result = this.getRideForMember(rideId, riderId);
    if (!result.ok) return result;
    if (result.ride.createdBy === riderId) return { ok: false, reason: 'forbidden' };
    result.ride.memberIds.delete(riderId);
    return result;
  }

  removeMember(rideId: string, actorId: string, memberId: string): RideActionResult {
    const ride = this.rides.get(rideId);
    if (!ride) return { ok: false, reason: 'not_found' };
    if (ride.createdBy !== actorId || memberId === actorId) return { ok: false, reason: 'forbidden' };
    ride.memberIds.delete(memberId);
    return { ok: true, ride };
  }

  endRide(rideId: string, actorId: string): RideActionResult {
    const ride = this.rides.get(rideId);
    if (!ride) return { ok: false, reason: 'not_found' };
    if (ride.createdBy !== actorId) return { ok: false, reason: 'forbidden' };
    this.rides.delete(rideId);
    for (const [code, record] of this.codesByValue) if (record.rideId === rideId) this.codesByValue.delete(code);
    return { ok: true, ride };
  }
}
