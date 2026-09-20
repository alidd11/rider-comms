import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { refreshAuthoritativeSocialSnapshot } from '../src/friends/socialRefresh.ts';

describe('refreshAuthoritativeSocialSnapshot', () => {
  it('runs network and message refreshes together', async () => {
    const calls: string[] = [];
    await refreshAuthoritativeSocialSnapshot(
      async () => { calls.push('network'); },
      async () => { calls.push('messages'); },
    );
    assert.deepEqual(calls.sort(), ['messages', 'network']);
  });

  it('rejects when the authoritative network refresh fails', async () => {
    await assert.rejects(
      refreshAuthoritativeSocialSnapshot(
        async () => { throw new Error('network unavailable'); },
        async () => {},
      ),
      /network unavailable/,
    );
  });

  it('rejects when the authoritative message refresh fails', async () => {
    await assert.rejects(
      refreshAuthoritativeSocialSnapshot(
        async () => {},
        async () => { throw new Error('messages unavailable'); },
      ),
      /messages unavailable/,
    );
  });
});
