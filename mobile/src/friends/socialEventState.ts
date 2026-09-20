import type { SocialEvent } from '@rider-comms/shared';

export function socialEventNeedsNetworkRefresh(event: SocialEvent, me: string): boolean {
  return event.type === 'friend_request'
    || event.type === 'friend_request_resolved'
    || event.type === 'friend_removed'
    || (event.type === 'social_refresh' && event.entityId === 'profile' && event.actorRiderId !== me);
}

export function socialEventNeedsMessageRefresh(event: SocialEvent): boolean {
  return event.type === 'message'
    || event.type === 'message_read'
    || event.type === 'friend_removed';
}

export function socialEventInvalidatesFriendProfile(event: SocialEvent, me: string): boolean {
  return event.type === 'social_refresh'
    && event.entityId === 'profile'
    && event.actorRiderId !== me;
}

export function socialEventInvalidatesOpenChat(event: SocialEvent): boolean {
  return event.type === 'message'
    || event.type === 'message_read'
    || event.type === 'friend_removed';
}
