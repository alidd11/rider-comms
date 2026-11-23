import type { ZoneTier } from './types.ts';

export type UnitSystem = 'mi' | 'km';

/** The longest profile bio, in characters. */
export const MAX_PROFILE_BIO_LENGTH = 160;

/** Rider Social, the photo and Reels app on the same accounts (PWA: RIDER_SOCIAL_URL in 18-map-init-events.js). */
export const RIDER_SOCIAL_URL = 'https://social-web-preview-preview.up.railway.app';
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
  /** Rider Comms updates: notifications staff send to every rider. */
  notifyUpdates: boolean;
  shareLocation: boolean;
  instagramUsername: string;
  instagramVisibility: SocialVisibility;
  tiktokUsername: string;
  tiktokVisibility: SocialVisibility;
  /** A short public bio, shown on the rider's profile in Rider Comms and Rider Social. */
  bio: string;
  updatedAt: number;
}

/** The zone tier isn't here: only verified store purchases change it. */
export type ProfileUpdate = Partial<Omit<RiderProfile, 'riderId' | 'updatedAt' | 'zoneTier'>>;

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
  | 'social_refresh'
  /** The actor is typing to the recipient; clients show it for a few seconds. */
  | 'typing';

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

