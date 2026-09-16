import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DirectMessage } from '@rider-comms/shared';
import { reconcileMessageThread, type LocalDirectMessage } from '../src/friends/messageState.ts';

const message = (id: string, createdAt: number): DirectMessage => ({
  id,
  fromRiderId: 'rider_one',
  toRiderId: 'rider_two',
  text: id,
  createdAt,
});

describe('reconcileMessageThread', () => {
  it('retains pending and failed local messages across a background refresh', () => {
    const current: LocalDirectMessage[] = [
      message('server-1', 1),
      { ...message('local-pending', 3), status: 'pending' },
      { ...message('local-failed', 4), status: 'failed' },
    ];

    assert.deepEqual(reconcileMessageThread(current, [message('server-1', 1), message('server-2', 2)]), [
      message('server-1', 1),
      message('server-2', 2),
      { ...message('local-pending', 3), status: 'pending' },
      { ...message('local-failed', 4), status: 'failed' },
    ]);
  });

  it('drops stale server copies and avoids duplicating a matching id', () => {
    const current: LocalDirectMessage[] = [
      message('stale', 1),
      { ...message('confirmed', 2), status: 'pending' },
    ];
    assert.deepEqual(reconcileMessageThread(current, [message('confirmed', 2)]), [message('confirmed', 2)]);
  });

  it('sorts the combined thread deterministically', () => {
    const current: LocalDirectMessage[] = [{ ...message('local', 2), status: 'failed' }];
    assert.deepEqual(
      reconcileMessageThread(current, [message('later', 3), message('earlier', 1)]).map((item) => item.id),
      ['earlier', 'local', 'later']
    );
  });
});
