import { randomUUID } from 'node:crypto';
import type { FriendRequest, FriendSummary } from '@rider-comms/shared';
import type { ProfileStore } from './profileStore.ts';

export type CreateFriendRequestResult =
  | { ok: true; request: FriendRequest }
  | { ok: false; error: 'invalid' | 'already_friends' | 'request_exists'; message?: string };

export type ResolveRequestResult =
  | { ok: true; request: FriendRequest }
  | { ok: false; error: 'not_found' };

/**
 * Friend requests + the resulting friendships. Friendships are stored as a
 * symmetric adjacency map (both directions added/removed together) since
 * there's no directionality to "being friends" once accepted — only the
 * pending *request* has a from/to direction.
 */
export class FriendStore {
  private requests = new Map<string, FriendRequest>();
  private friendsOf = new Map<string, Set<string>>();

  private profileStore: ProfileStore;

  constructor(profileStore: ProfileStore) {
    this.profileStore = profileStore;
  }

  private areFriends(a: string, b: string): boolean {
    return this.friendsOf.get(a)?.has(b) ?? false;
  }

  private findPendingBetween(a: string, b: string): FriendRequest | undefined {
    for (const req of this.requests.values()) {
      if (req.status !== 'pending') continue;
      const matches =
        (req.fromRiderId === a && req.toRiderId === b) ||
        (req.fromRiderId === b && req.toRiderId === a);
      if (matches) return req;
    }
    return undefined;
  }

  createRequest(fromRiderId: string, toRiderId: string): CreateFriendRequestResult {
    if (this.areFriends(fromRiderId, toRiderId)) {
      return { ok: false, error: 'already_friends' };
    }
    if (this.findPendingBetween(fromRiderId, toRiderId)) {
      return { ok: false, error: 'request_exists' };
    }

    const request: FriendRequest = {
      id: randomUUID(),
      fromRiderId,
      toRiderId,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.requests.set(request.id, request);
    return { ok: true, request };
  }

  getRequest(requestId: string): FriendRequest | undefined {
    return this.requests.get(requestId);
  }

  getRequestsFor(riderId: string): { incoming: FriendRequest[]; outgoing: FriendRequest[] } {
    const incoming: FriendRequest[] = [];
    const outgoing: FriendRequest[] = [];
    for (const req of this.requests.values()) {
      if (req.status !== 'pending') continue;
      if (req.toRiderId === riderId) incoming.push(req);
      else if (req.fromRiderId === riderId) outgoing.push(req);
    }
    return { incoming, outgoing };
  }

  private addFriendship(a: string, b: string): void {
    if (!this.friendsOf.has(a)) this.friendsOf.set(a, new Set());
    if (!this.friendsOf.has(b)) this.friendsOf.set(b, new Set());
    this.friendsOf.get(a)!.add(b);
    this.friendsOf.get(b)!.add(a);
  }

  private summaryFor(riderId: string): FriendSummary {
    const profile = this.profileStore.getOrCreate(riderId);
    return {
      riderId,
      displayName: profile.displayName,
      handle: profile.handle,
      avatarId: profile.avatarId,
    };
  }

  /** Accepts a pending request. `friend` in the result describes the
   * *other* party from the perspective of whoever is accepting — i.e. the
   * request's fromRiderId, since toRiderId is the one accepting. */
  accept(requestId: string): (ResolveRequestResult & { friend?: FriendSummary }) {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'pending') {
      return { ok: false, error: 'not_found' };
    }
    request.status = 'accepted';
    this.addFriendship(request.fromRiderId, request.toRiderId);
    return { ok: true, request, friend: this.summaryFor(request.fromRiderId) };
  }

  decline(requestId: string): ResolveRequestResult {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'pending') {
      return { ok: false, error: 'not_found' };
    }
    request.status = 'declined';
    return { ok: true, request };
  }

  getFriends(riderId: string): FriendSummary[] {
    const ids = this.friendsOf.get(riderId);
    if (!ids) return [];
    return [...ids].map((id) => this.summaryFor(id));
  }

  removeFriend(riderId: string, friendId: string): void {
    this.friendsOf.get(riderId)?.delete(friendId);
    this.friendsOf.get(friendId)?.delete(riderId);
  }

  deleteRider(riderId: string): void {
    this.friendsOf.delete(riderId);
    for (const friends of this.friendsOf.values()) friends.delete(riderId);
    for (const [id, request] of this.requests) {
      if (request.fromRiderId === riderId || request.toRiderId === riderId) this.requests.delete(id);
    }
  }

  /** Exposed for the messages endpoint's friendship check. */
  isFriendOf(a: string, b: string): boolean {
    return this.areFriends(a, b);
  }
}
