import type { DirectMessage, FriendRequest, FriendSummary, Hideout, ProfileUpdate, RiderProfile } from '@rider-comms/shared';

export interface GuestSession { riderId: string; token: string }
export interface CreateRideResponse { rideId: string; code: string; expiresAt: number; createdBy: string; memberIds: string[] }
export interface JoinRideResponse { rideId: string }
export interface RideResponse { rideId: string; createdBy: string; createdAt: number; memberIds: string[] }
export interface PresenceResponse { inZoneWith: string[]; transitions: Array<{ a: string; b: string; type: 'entered' | 'left' }>; radiusMiles: number }

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) { super(`API error ${status}: ${JSON.stringify(body)}`); this.status = status; this.body = body; }
}
export class RiderCommsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly token?: string;
  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch, token?: string) { this.baseUrl = baseUrl.replace(/\/$/, ''); this.fetchImpl = fetchImpl; this.token = token; }
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
      const contentType = res.headers?.get?.('content-type') ?? '';
      const json = contentType.includes('application/json') || !res.headers ? await res.json() : { error: await res.text() };
      if (!res.ok) throw new ApiError(res.status, json);
      return json as T;
    } finally { clearTimeout(timeout); }
  }
  registerGuest(): Promise<GuestSession> { return this.request('POST', '/auth/guest', {}); }
  getMe(): Promise<{ riderId: string }> { return this.request('GET', '/auth/me'); }
  deleteAccount(): Promise<Record<string, never>> { return this.request('DELETE', '/auth/me'); }
  createRide(): Promise<CreateRideResponse> { return this.request('POST', '/rides', {}); }
  joinRide(code: string): Promise<JoinRideResponse> { return this.request('POST', '/rides/join', { code }); }
  getRide(id: string): Promise<RideResponse> { return this.request('GET', `/rides/${encodeURIComponent(id)}`); }
  leaveRide(id: string): Promise<Record<string, never>> { return this.request('POST', `/rides/${encodeURIComponent(id)}/leave`, {}); }
  endRide(id: string): Promise<Record<string, never>> { return this.request('DELETE', `/rides/${encodeURIComponent(id)}`); }
  removeRideMember(id: string, memberId: string): Promise<RideResponse> { return this.request('DELETE', `/rides/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`); }
  updatePresence(lat: number, lon: number): Promise<PresenceResponse> { return this.request('POST', '/presence', { lat, lon }); }
  leavePresence(): Promise<Record<string, never>> { return this.request('DELETE', '/presence'); }
  getProfile(id: string): Promise<RiderProfile> { return this.request('GET', `/riders/${encodeURIComponent(id)}/profile`); }
  updateProfile(id: string, update: ProfileUpdate): Promise<RiderProfile> { return this.request('PUT', `/riders/${encodeURIComponent(id)}/profile`, update); }
  sendFriendRequest(toRiderId: string): Promise<FriendRequest> { return this.request('POST', '/friends/requests', { toRiderId }); }
  getFriendRequests(id: string): Promise<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }> { return this.request('GET', `/riders/${encodeURIComponent(id)}/friend-requests`); }
  acceptFriendRequest(id: string): Promise<{ friend: FriendSummary }> { return this.request('POST', `/friends/requests/${encodeURIComponent(id)}/accept`, {}); }
  declineFriendRequest(id: string): Promise<Record<string, never>> { return this.request('POST', `/friends/requests/${encodeURIComponent(id)}/decline`, {}); }
  getFriends(id: string): Promise<{ friends: FriendSummary[] }> { return this.request('GET', `/riders/${encodeURIComponent(id)}/friends`); }
  removeFriend(id: string, friendId: string): Promise<Record<string, never>> { return this.request('DELETE', `/riders/${encodeURIComponent(id)}/friends/${encodeURIComponent(friendId)}`); }
  sendMessage(toRiderId: string, text: string): Promise<DirectMessage> { return this.request('POST', '/messages', { toRiderId, text }); }
  getMessages(withRiderId: string): Promise<{ messages: DirectMessage[] }> { return this.request('GET', `/messages?withRiderId=${encodeURIComponent(withRiderId)}`); }
  blockRider(riderId: string): Promise<Record<string, never>> { return this.request('POST', '/blocks', { riderId }); }
  unblockRider(riderId: string): Promise<Record<string, never>> { return this.request('DELETE', `/blocks/${encodeURIComponent(riderId)}`); }
  reportRider(riderId: string, reason: 'harassment' | 'unsafe' | 'spam' | 'sexual' | 'other', details = ''): Promise<{ received: true }> { return this.request('POST', '/reports', { riderId, reason, details }); }
  createHideout(name: string, lat: number, lon: number, participantIds: string[]): Promise<Hideout> { return this.request('POST', '/hideouts', { name, lat, lon, participantIds }); }
  getHideouts(id: string): Promise<{ hideouts: Hideout[] }> { return this.request('GET', `/riders/${encodeURIComponent(id)}/hideouts`); }
  deleteHideout(id: string): Promise<Record<string, never>> { return this.request('DELETE', `/hideouts/${encodeURIComponent(id)}`); }
}
