import type { ZoneTier } from './types.ts';

export type UnitSystem = 'mi' | 'km';
export type SocialVisibility = 'public' | 'friends' | 'private';

/**
 * A rider's account-level settings — server-persisted (Section: this used
 * to be AsyncStorage-only on one device, which isn't a real settings page;
 * it's just a local cache now, and the backend's copy is the source of
 * truth). Keyed by riderId since there's still no auth in this prototype —
 * a riderId is the closest thing to an account identity that exists.
 */
export interface RiderProfile {
  riderId: string;
  displayName: string;
  handle: string;
  avatarId: string;
  zoneTier: ZoneTier;
  unitSystem: UnitSystem;
  notifyNearby: boolean;
  notifyInvites: boolean;
  notifyChat: boolean;
  shareLocation: boolean;
  instagramUsername: string;
  instagramVisibility: SocialVisibility;
  tiktokUsername: string;
  tiktokVisibility: SocialVisibility;
  updatedAt: number;
}

export type ProfileUpdate = Partial<Omit<RiderProfile, 'riderId' | 'updatedAt'>>;

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined';

export interface FriendRequest {
  id: string;
  fromRiderId: string;
  toRiderId: string;
  status: FriendRequestStatus;
  createdAt: number;
}

/** Enough of a friend's profile to render a row/avatar without a second lookup. */
export interface FriendSummary {
  riderId: string;
  displayName: string;
  handle: string;
  avatarId: string;
}

export interface DirectMessage {
  id: string;
  fromRiderId: string;
  toRiderId: string;
  text: string;
  createdAt: number;
}

/** A saved meeting point two or more friends are planning around. */
export interface Hideout {
  id: string;
  name: string;
  lat: number;
  lon: number;
  createdBy: string;
  participantIds: string[];
  createdAt: number;
}

export type SocialEventType =
  | 'message'
  | 'message_read'
  | 'friend_request'
  | 'friend_request_resolved'
  | 'friend_removed'
  | 'social_refresh';

/**
 * A lightweight invalidation event for authenticated social state.
 * Event payloads intentionally contain no message text or profile secrets:
 * clients use the event to refresh the authoritative resource.
 */
export interface SocialEvent {
  cursor: string;
  type: SocialEventType;
  actorRiderId: string;
  entityId: string;
  createdAt: number;
}

export interface SocialEventPage {
  events: SocialEvent[];
  cursor: string;
  hasMore: boolean;
}

export interface FriendActivity {
  riderId: string;
  online: boolean;
  lastSeenAt: number | null;
}

