import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FriendRequest } from '@rider-comms/shared';
import { appendUniqueFriendRequest } from '../src/friends/requestState.ts';

const request = (id: string): FriendRequest => ({
  id,
  fromRiderId: 'rider_a',
  toRiderId: 'rider_b',
  status: 'pending',
  createdAt: 1,
});

describe('appendUniqueFriendRequest', () => {
  it('doesn’t duplicate a request already delivered by realtime', () => {
    const existing = request('request-1');
    assert.deepEqual(
      appendUniqueFriendRequest([existing], existing).map((item) => item.id),
      ['request-1'],
    );
  });

  it('appends a newly acknowledged request when realtime hasn’t delivered it', () => {
    assert.deepEqual(
      appendUniqueFriendRequest([], request('request-1')).map((item) => item.id),
      ['request-1'],
    );
  });
});
