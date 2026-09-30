import type http from 'node:http';
import type { AccountDeletionStore } from '../accountDeletionStore.ts';
import type { AuthStore } from '../authStore.ts';
import type { DrivingRoute, RouteCoordinate } from '../directionsProvider.ts';
import type { FriendStore } from '../friendStore.ts';
import type { HazardStore } from '../hazardStore.ts';
import type { HideoutStore } from '../hideoutStore.ts';
import type { LiveKitCredentials } from '../liveKitToken.ts';
import type { MessageStore } from '../messageStore.ts';
import type { ModerationStore } from '../moderationStore.ts';
import type { AdminStatsStore } from '../adminStatsStore.ts';
import type { PlaceSearchRequest, PlaceSummary } from '../placesProvider.ts';
import type { PresenceStore } from '../presenceStore.ts';
import type { ProfileStore } from '../profileStore.ts';
import type { RateLimitStore } from '../rateLimitStore.ts';
import type { RideMemberLocation, RideStore } from '../rideStore.ts';
import type { ScenicRouteStore } from '../scenicRouteStore.ts';
import type { SocialActivityStore } from '../socialActivityStore.ts';
import type { SocialEventStore } from '../socialEventStore.ts';
import type { SocialRateLimitStore } from '../socialRateLimitStore.ts';

/**
 * Route modules share this context. Each handler returns NOT_HANDLED when no
 * route in its group matched; any other return value (including the
 * `undefined` of a bare `return;` after a rate-limit response was sent)
 * means the request was answered. createApp (server.ts) calls the groups in
 * a fixed order, which matters where an exact path must win over a
 * parameterised one (e.g. /rides/current before /rides/:id).
 */
export const NOT_HANDLED = Symbol('not_handled');

/** Long-lived dependencies, built once per createApp call. */
export interface RouteDeps {
  rideStore: RideStore;
  presenceStore: PresenceStore;
  profileStore: ProfileStore;
  friendStore: FriendStore;
  messageStore: MessageStore;
  hideoutStore: HideoutStore;
  authStore: AuthStore;
  moderationStore: ModerationStore;
  adminStatsStore: Pick<AdminStatsStore, 'overview' | 'searchRiders' | 'increment'>;
  hazardStore: HazardStore;
  scenicRouteStore: ScenicRouteStore;
  accountDeletionStore: Pick<AccountDeletionStore, 'deleteRider'>;
  rateLimitStore: Pick<RateLimitStore, 'consume'>;
  socialRateLimitStore: Pick<SocialRateLimitStore, 'consume'>;
  socialActivityStore: Pick<SocialActivityStore, 'touch' | 'getFriendActivity'>;
  socialEventStore: Pick<SocialEventStore, 'waitForEvents'> & Partial<Pick<SocialEventStore, 'close'>>;
  readinessCheck: () => Promise<void>;
  directionsProvider: (origin: RouteCoordinate, destination: RouteCoordinate) => Promise<DrivingRoute>;
  placesProvider: (request: PlaceSearchRequest) => Promise<PlaceSummary[]>;
  liveKitCredentials: LiveKitCredentials | null | undefined;
  revokeRideVoiceParticipants: (rideId: string, riderIds: Iterable<string>) => Promise<void>;
  revokeProximityVoiceParticipants: (riderA: string, riderB: string) => Promise<void>;
  visibleRideLocationsFor: (actorId: string, locations: RideMemberLocation[]) => Promise<RideMemberLocation[]>;
}

/** Context for routes that run before authentication. */
export interface PublicRouteContext extends RouteDeps {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  /** Client address, as resolved for rate limiting and logs. */
  address: string;
}

/** Context for routes that require a signed-in rider. */
export interface RouteContext extends PublicRouteContext {
  actorId: string;
  /** Non-empty path segments, e.g. ['rides', ':id', 'leave']. */
  s: string[];
}

export const HAZARD_TYPES = ['police', 'accident', 'road_closure', 'camera', 'hidden_police', 'police_checkpoint'] as const;
export const VEHICLE_CATEGORIES = ['motorcycle_small', 'motorcycle_large', 'scooter', 'car'] as const;
export const ROAD_TYPES = ['rural', 'mountain', 'coastal', 'urban', 'mixed'] as const;
export const DIFFICULTIES = ['easy', 'moderate', 'challenging'] as const;

// Ride rosters are capped at MAX_RIDE_MEMBERS (20, see rideStore.ts); a
// generous ceiling above that keeps this a defensive bound, not a real limit.
export const MAX_PROFILE_BATCH_SIZE = 50;
export const MAX_PRESENCE_ACCURACY_METERS = 100;
export const MAX_PRESENCE_FIX_AGE_MS = 30_000;
export const MAX_PRESENCE_FUTURE_SKEW_MS = 5_000;
export const PROXIMITY_VOICE_TOKEN_TTL_SECONDS = 60;
export const PROXIMITY_VOICE_REFRESH_MS = 20_000;
// LiveKit token expiry only gates joining; it does not eject an already
// connected participant. Treat public proximity authorization as a renewable
// client lease so a stale pair cannot remain connected indefinitely if the
// backend/presence path stops confirming that they are still allowed together.
export const PROXIMITY_VOICE_AUTHORIZATION_LEASE_MS = PROXIMITY_VOICE_TOKEN_TTL_SECONDS * 1000;

export function rideBody(ride: { id: string; createdBy: string; createdAt: number; memberIds: Set<string> }) { return { rideId: ride.id, createdBy: ride.createdBy, createdAt: ride.createdAt, memberIds: [...ride.memberIds] }; }
export async function publicProfile(profileStore: ProfileStore, friendStore: FriendStore, actorId: string, targetId: string) {
  const profile = await profileStore.getOrCreate(targetId);
  const isFriend = actorId === targetId ? false : await friendStore.isFriendOf(actorId, targetId);
  const canSee = (visibility: 'public' | 'friends' | 'private') => visibility === 'public' || (visibility === 'friends' && isFriend) || actorId === targetId;
  return { riderId: profile.riderId, displayName: profile.displayName, handle: profile.handle, avatarId: profile.avatarId, instagramUsername: canSee(profile.instagramVisibility) ? profile.instagramUsername : '', tiktokUsername: canSee(profile.tiktokVisibility) ? profile.tiktokUsername : '' };
}
