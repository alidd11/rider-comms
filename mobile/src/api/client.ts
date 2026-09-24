import type {
  DirectMessage,
  Difficulty,
  FriendActivity,
  FriendRequest,
  FriendSummary,
  HazardReport,
  HazardType,
  Hideout,
  ProfileUpdate,
  RiderProfile,
  RoadType,
  ScenicRoute,
  SocialEventPage,
  VehicleCategory,
} from '@rider-comms/shared';
import type { InAppNavigationRoute, RouteCoordinate } from './directions';

export type ScenicRouteInput = Omit<ScenicRoute, 'id' | 'createdBy' | 'createdAt'>;
export interface ScenicRouteFilters { vehicleCategory?: VehicleCategory; roadType?: RoadType; maxDifficulty?: Difficulty }

export interface GuestSession { riderId: string; token: string }
export interface LoginSession extends GuestSession { emailVerified: boolean }
export interface SignUpSession extends LoginSession { emailVerificationSent: boolean }
export interface AccountSessionSummary { id: string; deviceName: string; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean }
export interface CreateRideResponse { rideId: string; code: string; expiresAt: number; createdBy: string; memberIds: string[] }
export interface JoinRideResponse { rideId: string }
export interface RideResponse { rideId: string; createdBy: string; createdAt: number; memberIds: string[]; shareRideLocation: boolean; code: string | null }
export interface RideMemberLocation { riderId: string; lat: number; lon: number; updatedAt: number }
export interface PresenceResponse { inZoneWith: string[]; transitions: Array<{ a: string; b: string; type: 'entered' | 'left' }>; radiusMiles: number }
export interface VoiceTokenResponse { token: string; url: string }
export interface ProximityVoiceConnection extends VoiceTokenResponse { peerId: string }
export interface ProximityVoiceResponse { connections: ProximityVoiceConnection[]; refreshAfterMs: number; authorizationLeaseMs: number }
export interface PublicRiderProfile {
  riderId: string;
  displayName: string;
  handle: string;
  avatarId: string;
  instagramUsername: string;
  tiktokUsername: string;
}
export interface ConversationSummary {
  friend: FriendSummary;
  lastMessage: DirectMessage;
  unreadCount: number;
}

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
  private async request<T>(method: string, path: string, body?: unknown, timeoutMs = 10_000): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
      if (res.status === 204 && res.ok) return undefined as T;
      const contentType = res.headers?.get?.('content-type') ?? '';
      const json = contentType.includes('application/json') || !res.headers ? await res.json() : { error: await res.text() };
      if (!res.ok) throw new ApiError(res.status, json);
      return json as T;
    } finally { clearTimeout(timeout); }
  }
  signUp(username: string, email: string, password: string, deviceName = 'Rider Comms mobile'): Promise<SignUpSession> { return this.request('POST', '/auth/signup', { username, email, password, deviceName }); }
  logIn(username: string, password: string, deviceName = 'Rider Comms mobile'): Promise<LoginSession> { return this.request('POST', '/auth/login', { username, password, deviceName }); }
  requestPasswordReset(email: string): Promise<{ accepted: true }> { return this.request('POST', '/auth/password-reset/request', { email }); }
  resetPassword(token: string, password: string): Promise<{ reset: true }> { return this.request('POST', '/auth/password-reset/confirm', { token, password }); }
  resendVerification(): Promise<{ sent: boolean }> { return this.request('POST', '/auth/resend-verification', {}); }
  logOut(): Promise<void> { return this.request('POST', '/auth/logout', {}); }
  getMe(): Promise<{ riderId: string; username: string | null; emailVerified: boolean }> { return this.request('GET', '/auth/me'); }
  getSessions(): Promise<{ sessions: AccountSessionSummary[] }> { return this.request('GET', '/auth/sessions'); }
  revokeSession(id: string): Promise<void> { return this.request('DELETE', `/auth/sessions/${encodeURIComponent(id)}`); }
  deleteAccount(): Promise<Record<string, never>> { return this.request('DELETE', '/auth/me'); }
  createRide(): Promise<CreateRideResponse> { return this.request('POST', '/rides', {}); }
  joinRide(code: string): Promise<JoinRideResponse> { return this.request('POST', '/rides/join', { code }); }
  getRide(id: string): Promise<RideResponse> { return this.request('GET', `/rides/${encodeURIComponent(id)}`); }
  getCurrentRide(): Promise<{ ride: RideResponse | null }> { return this.request('GET', '/rides/current'); }
  leaveRide(id: string): Promise<Record<string, never>> { return this.request('POST', `/rides/${encodeURIComponent(id)}/leave`, {}); }
  endRide(id: string): Promise<Record<string, never>> { return this.request('DELETE', `/rides/${encodeURIComponent(id)}`); }
  removeRideMember(id: string, memberId: string): Promise<RideResponse> { return this.request('DELETE', `/rides/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`); }
  setRideLocationSharing(id: string, enabled: boolean): Promise<{ enabled: boolean }> { return this.request('PUT', `/rides/${encodeURIComponent(id)}/location-sharing`, { enabled }); }
  updateRideLocation(id: string, lat: number, lon: number): Promise<{ locations: RideMemberLocation[] }> { return this.request('POST', `/rides/${encodeURIComponent(id)}/location`, { lat, lon }); }
  getRideLocations(id: string): Promise<{ locations: RideMemberLocation[] }> { return this.request('GET', `/rides/${encodeURIComponent(id)}/locations`); }
  updatePresence(lat: number, lon: number, accuracyMeters: number, recordedAt: number): Promise<PresenceResponse> {
    return this.request('POST', '/presence', { lat, lon, accuracyMeters, recordedAt });
  }
  leavePresence(): Promise<Record<string, never>> { return this.request('DELETE', '/presence'); }
  getDrivingRoute(origin: RouteCoordinate, destination: RouteCoordinate): Promise<InAppNavigationRoute> {
    return this.request('POST', '/directions', {
      origin: { lat: origin.lat, lon: origin.lon },
      destination: { lat: destination.lat, lon: destination.lon },
    }, 12_000);
  }
  getRideVoiceToken(rideId: string): Promise<VoiceTokenResponse> { return this.request('POST', '/voice/token', { target: 'ride', rideId }); }
  getChannelVoiceToken(): Promise<ProximityVoiceResponse> { return this.request('POST', '/voice/token', { target: 'channel' }); }
  getProfile(id: string): Promise<RiderProfile> { return this.request('GET', `/riders/${encodeURIComponent(id)}/profile`); }
  getPublicProfile(id: string): Promise<PublicRiderProfile> { return this.request('GET', `/profiles/${encodeURIComponent(id)}`); }
  getPublicProfiles(riderIds: readonly string[]): Promise<Record<string, PublicRiderProfile>> {
    return this.request<{ profiles: Record<string, PublicRiderProfile> }>('POST', '/profiles/batch', { riderIds })
      .then((response) => response.profiles);
  }
  updateProfile(id: string, update: ProfileUpdate): Promise<RiderProfile> { return this.request('PUT', `/riders/${encodeURIComponent(id)}/profile`, update); }
  sendFriendRequest(toRiderId: string): Promise<FriendRequest> { return this.request('POST', '/friends/requests', { toRiderId }); }
  getFriendRequests(id: string, options: { before?: string; limit?: number } = {}): Promise<{ incoming: FriendRequest[]; outgoing: FriendRequest[]; profiles: Record<string, FriendSummary>; nextCursor: string | null }> {
    const query = new URLSearchParams({ limit: String(options.limit ?? 100) });
    if (options.before) query.set('before', options.before);
    return this.request('GET', `/riders/${encodeURIComponent(id)}/friend-requests?${query}`);
  }
  acceptFriendRequest(id: string): Promise<{ friend: FriendSummary }> { return this.request('POST', `/friends/requests/${encodeURIComponent(id)}/accept`, {}); }
  declineFriendRequest(id: string): Promise<Record<string, never>> { return this.request('POST', `/friends/requests/${encodeURIComponent(id)}/decline`, {}); }
  cancelFriendRequest(id: string): Promise<Record<string, never>> { return this.request('DELETE', `/friends/requests/${encodeURIComponent(id)}`); }
  getFriends(id: string, options: { before?: string; limit?: number } = {}): Promise<{ friends: FriendSummary[]; nextCursor: string | null }> {
    const query = new URLSearchParams({ limit: String(options.limit ?? 100) });
    if (options.before) query.set('before', options.before);
    return this.request('GET', `/riders/${encodeURIComponent(id)}/friends?${query}`);
  }
  removeFriend(id: string, friendId: string): Promise<Record<string, never>> { return this.request('DELETE', `/riders/${encodeURIComponent(id)}/friends/${encodeURIComponent(friendId)}`); }
  getFriendActivity(): Promise<{ activity: FriendActivity[] }> { return this.request('GET', '/friends/activity'); }
  sendMessage(toRiderId: string, text: string): Promise<DirectMessage> { return this.request('POST', '/messages', { toRiderId, text }); }
  getMessages(withRiderId: string, options: { before?: string; limit?: number } = {}): Promise<{ messages: DirectMessage[]; nextCursor: string | null; peerReadThroughMessageId: string | null }> {
    const query = new URLSearchParams({ withRiderId });
    if (options.before) query.set('before', options.before);
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    return this.request('GET', `/messages?${query.toString()}`);
  }
  getConversations(options: { before?: string; limit?: number } = {}): Promise<{ conversations: ConversationSummary[]; nextCursor: string | null }> {
    const query = new URLSearchParams({ limit: String(options.limit ?? 50) });
    if (options.before) query.set('before', options.before);
    return this.request('GET', `/conversations?${query.toString()}`);
  }
  getUnreadMessageCount(): Promise<{ unreadCount: number }> { return this.request('GET', '/messages/unread-count'); }
  markMessagesRead(withRiderId: string): Promise<{ readThroughSeq: number }> { return this.request('POST', '/messages/read', { withRiderId }); }
  getSocialEvents(options: { after?: string; limit?: number; waitMs?: number } = {}): Promise<SocialEventPage> {
    const waitMs = options.waitMs ?? 25_000;
    const query = new URLSearchParams({ limit: String(options.limit ?? 100), waitMs: String(waitMs) });
    if (options.after) query.set('after', options.after);
    return this.request('GET', `/social/events?${query.toString()}`, undefined, Math.max(10_000, waitMs + 5_000));
  }
  blockRider(riderId: string): Promise<Record<string, never>> { return this.request('POST', '/blocks', { riderId }); }
  unblockRider(riderId: string): Promise<Record<string, never>> { return this.request('DELETE', `/blocks/${encodeURIComponent(riderId)}`); }
  reportRider(riderId: string, reason: 'harassment' | 'unsafe' | 'spam' | 'sexual' | 'other', details = ''): Promise<{ received: true }> { return this.request('POST', '/reports', { riderId, reason, details }); }
  createHideout(name: string, lat: number, lon: number, participantIds: string[]): Promise<Hideout> { return this.request('POST', '/hideouts', { name, lat, lon, participantIds }); }
  getHideouts(id: string): Promise<{ hideouts: Hideout[] }> { return this.request('GET', `/riders/${encodeURIComponent(id)}/hideouts`); }
  deleteHideout(id: string): Promise<Record<string, never>> { return this.request('DELETE', `/hideouts/${encodeURIComponent(id)}`); }
  createHazard(type: HazardType, lat: number, lon: number): Promise<HazardReport> { return this.request('POST', '/hazards', { type, lat, lon }); }
  getNearbyHazards(lat: number, lon: number): Promise<{ hazards: HazardReport[] }> { return this.request('GET', `/hazards/nearby?lat=${lat}&lon=${lon}`); }
  confirmHazard(id: string): Promise<Record<string, never>> { return this.request('POST', `/hazards/${encodeURIComponent(id)}/confirm`, {}); }
  denyHazard(id: string): Promise<Record<string, never>> { return this.request('POST', `/hazards/${encodeURIComponent(id)}/deny`, {}); }
  deleteHazard(id: string): Promise<Record<string, never>> { return this.request('DELETE', `/hazards/${encodeURIComponent(id)}`); }
  createScenicRoute(input: ScenicRouteInput): Promise<ScenicRoute> { return this.request('POST', '/scenic-routes', input); }
  listScenicRoutes(filters: ScenicRouteFilters = {}): Promise<{ routes: ScenicRoute[] }> {
    const params = new URLSearchParams();
    if (filters.vehicleCategory) params.set('vehicleCategory', filters.vehicleCategory);
    if (filters.roadType) params.set('roadType', filters.roadType);
    if (filters.maxDifficulty) params.set('maxDifficulty', filters.maxDifficulty);
    const query = params.toString();
    return this.request('GET', `/scenic-routes${query ? `?${query}` : ''}`);
  }
  getScenicRoute(id: string): Promise<ScenicRoute> { return this.request('GET', `/scenic-routes/${encodeURIComponent(id)}`); }
  deleteScenicRoute(id: string): Promise<Record<string, never>> { return this.request('DELETE', `/scenic-routes/${encodeURIComponent(id)}`); }
}
