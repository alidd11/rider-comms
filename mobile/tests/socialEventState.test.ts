import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SocialEvent } from '@rider-comms/shared';
import {
  socialEventInvalidatesFriendProfile,
  socialEventInvalidatesOpenChat,
  socialEventNeedsMessageRefresh,
  socialEventNeedsNetworkRefresh,
} from '../src/friends/socialEventState.ts';

const event = (type: SocialEvent['type'], actorRiderId: string, entityId: string): SocialEvent => ({
  cursor: '1',
  type,
  actorRiderId,
  entityId,
  createdAt: 1,
});

describe('social event invalidation', () => {
  it('targets a peer profile refresh without reloading message summaries', () => {
    const profile = event('social_refresh', 'friend-1', 'profile');
    assert.equal(socialEventNeedsNetworkRefresh(profile, 'me'), true);
    assert.equal(socialEventInvalidatesFriendProfile(profile, 'me'), true);
    assert.equal(socialEventNeedsMessageRefresh(profile), false);
    assert.equal(socialEventInvalidatesOpenChat(profile), false);
  });

  it('keeps self-profile and block-list refreshes out of friend-profile invalidation', () => {
    assert.equal(socialEventInvalidatesFriendProfile(event('social_refresh', 'me', 'profile'), 'me'), false);
    assert.equal(socialEventNeedsNetworkRefresh(event('social_refresh', 'me', 'profile'), 'me'), false);
    assert.equal(socialEventNeedsNetworkRefresh(event('social_refresh', 'me', 'blocks'), 'me'), false);
  });

  it('keeps relationship removal authoritative for network, messages and open chat', () => {
    const removed = event('friend_removed', 'friend-1', 'friend-1');
    assert.equal(socialEventNeedsNetworkRefresh(removed, 'me'), true);
    assert.equal(socialEventNeedsMessageRefresh(removed), true);
    assert.equal(socialEventInvalidatesOpenChat(removed), true);
  });
});
