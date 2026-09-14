/**
 * Thin HTTP client for the rider-comms backend. Deliberately framework-free
 * (just `fetch`) so it has no dependency on React Native being installed —
 * it can be unit-tested with Node's test runner alone (see tests/client.test.ts),
 * which is more than the rest of this mobile scaffold can claim in this
 * sandbox.
 */
import type {
  DirectMessage,
  FriendRequest,
  FriendSummary,
  Hideout,
  ProfileUpdate,
  RiderProfile,
} from '@rider-comms/shared';

export interface CreateRideResponse {
  rideId: string;
  code: string;
  expiresAt: number;
}

export interface JoinRideResponse {
  rideId: string;
}

export interface PresenceResponse {
  inZoneWith: string[];
  transitions: Array<{ a: string; b: string; type: 'entered' | 'left' }>;
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`API error ${status}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

export class RiderCommsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new ApiError(res.status, json);
    }
    return json as T;
  }

  private postJson<T>(path: string, body: unknown): Promise<T> {
    return this.request('POST', path, body);
  }

  private getJson<T>(path: string): Promise<T> {
    return this.request('GET', path);
  }

  createRide(riderId: string): Promise<CreateRideResponse> {
    return this.postJson('/rides', { riderId });
  }

  joinRide(code: string, riderId: string): Promise<JoinRideResponse> {
    return this.postJson('/rides/join', { code, riderId });
  }

  updatePresence(
    riderId: string,
    lat: number,
    lon: number,
    radiusMiles: number
  ): Promise<PresenceResponse> {
    return this.postJson('/presence', { riderId, lat, lon, radiusMiles });
  }

  // ---- Profile: this is the actual settings backing store now — a
  // riderId's settings live on the backend, not just in this device's
  // AsyncStorage (see settings/SettingsContext.tsx). ----

  getProfile(riderId: string): Promise<RiderProfile> {
    return this.getJson(`/riders/${encodeURIComponent(riderId)}/profile`);
  }

  updateProfile(riderId: string, update: ProfileUpdate): Promise<RiderProfile> {
    return this.request('PUT', `/riders/${encodeURIComponent(riderId)}/profile`, update);
  }

  // ---- Friends ----

  sendFriendRequest(fromRiderId: string, toRiderId: string): Promise<FriendRequest> {
    return this.postJson('/friends/requests', { fromRiderId, toRiderId });
  }

  getFriendRequests(
    riderId: string
  ): Promise<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }> {
    return this.getJson(`/riders/${encodeURIComponent(riderId)}/friend-requests`);
  }

  acceptFriendRequest(requestId: string): Promise<{ friend: FriendSummary }> {
    return this.postJson(`/friends/requests/${encodeURIComponent(requestId)}/accept`, {});
  }

  declineFriendRequest(requestId: string): Promise<Record<string, never>> {
    return this.postJson(`/friends/requests/${encodeURIComponent(requestId)}/decline`, {});
  }

  getFriends(riderId: string): Promise<{ friends: FriendSummary[] }> {
    return this.getJson(`/riders/${encodeURIComponent(riderId)}/friends`);
  }

  removeFriend(riderId: string, friendId: string): Promise<Record<string, never>> {
    return this.request(
      'DELETE',
      `/riders/${encodeURIComponent(riderId)}/friends/${encodeURIComponent(friendId)}`
    );
  }

  // ---- Direct messages (poll-based, same pattern as presence — no
  // websocket/SFU infra exists in this sandbox to push messages instead) ----

  sendMessage(fromRiderId: string, toRiderId: string, text: string): Promise<DirectMessage> {
    return this.postJson('/messages', { fromRiderId, toRiderId, text });
  }

  getMessages(riderId: string, withRiderId: string): Promise<{ messages: DirectMessage[] }> {
    return this.getJson(
      `/messages?riderId=${encodeURIComponent(riderId)}&withRiderId=${encodeURIComponent(withRiderId)}`
    );
  }

  // ---- Hideouts: saved meeting points planned with specific friends ----

  createHideout(
    name: string,
    lat: number,
    lon: number,
    createdBy: string,
    participantIds: string[]
  ): Promise<Hideout> {
    return this.postJson('/hideouts', { name, lat, lon, createdBy, participantIds });
  }

  getHideouts(riderId: string): Promise<{ hideouts: Hideout[] }> {
    return this.getJson(`/riders/${encodeURIComponent(riderId)}/hideouts`);
  }

  deleteHideout(hideoutId: string, riderId: string): Promise<Record<string, never>> {
    return this.request(
      'DELETE',
      `/hideouts/${encodeURIComponent(hideoutId)}?riderId=${encodeURIComponent(riderId)}`
    );
  }
}
