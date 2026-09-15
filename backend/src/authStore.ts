import { createHash, randomBytes } from 'node:crypto';
import { generateRideCode } from '@rider-comms/shared';

export interface GuestSession { riderId: string; token: string; }

export class AuthStore {
  private riderByTokenDigest = new Map<string, string>();
  private issuedRiderIds = new Set<string>();
  private digest(token: string): string { return createHash('sha256').update(token).digest('hex'); }
  createGuest(): GuestSession {
    let riderId: string;
    do { riderId = `rider_${generateRideCode(8).toLowerCase()}`; } while (this.issuedRiderIds.has(riderId));
    const token = randomBytes(32).toString('base64url');
    this.issuedRiderIds.add(riderId);
    this.riderByTokenDigest.set(this.digest(token), riderId);
    return { riderId, token };
  }
  hasRider(riderId: string): boolean { return this.issuedRiderIds.has(riderId); }
  riderForToken(token: string): string | undefined { return token ? this.riderByTokenDigest.get(this.digest(token)) : undefined; }
  createTestSession(riderId: string): GuestSession {
    const token = randomBytes(32).toString('base64url');
    this.issuedRiderIds.add(riderId);
    this.riderByTokenDigest.set(this.digest(token), riderId);
    return { riderId, token };
  }
}
