import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SocialRefreshError, refreshAuthoritativeSocialSnapshot, socialRefreshErrorMessage } from '../src/friends/socialRefresh.ts';

describe('refreshAuthoritativeSocialSnapshot', () => {
  it('runs network and message refreshes together', async () => {
    const calls: string[] = [];
    await refreshAuthoritativeSocialSnapshot(
      async () => { calls.push('network'); },
      async () => { calls.push('messages'); },
    );
    assert.deepEqual(calls.sort(), ['messages', 'network']);
  });

  it('lets messages refresh when the network refresh fails, and says friends failed', async () => {
    let messagesRan = false;
    await assert.rejects(
      refreshAuthoritativeSocialSnapshot(
        async () => { throw new Error('network unavailable'); },
        async () => { messagesRan = true; },
      ),
      (error: unknown) => error instanceof SocialRefreshError && error.part === 'friends' && /network unavailable/.test(error.message),
    );
    assert.equal(messagesRan, true);
  });

  it('keeps a fresh friend list when only messages fail, and says messages failed', async () => {
    let networkRan = false;
    await assert.rejects(
      refreshAuthoritativeSocialSnapshot(
        async () => { networkRan = true; },
        async () => { throw new Error('messages unavailable'); },
      ),
      (error: unknown) => error instanceof SocialRefreshError && error.part === 'messages',
    );
    assert.equal(networkRan, true);
  });
});

describe('socialRefreshErrorMessage', () => {
  const api = (status: number) => Object.assign(new Error('api'), { status });
  it('says what failed and points at the connection when nothing answered', () => {
    assert.equal(socialRefreshErrorMessage(new SocialRefreshError('friends', new TypeError('Network request failed'))), 'Couldn’t load friends. Check your connection and try again.');
    assert.equal(socialRefreshErrorMessage(new SocialRefreshError('messages', api(503))), 'Couldn’t load your messages. Check your connection and try again.');
    assert.equal(socialRefreshErrorMessage(new SocialRefreshError('friends', api(429))), 'Couldn’t load friends. Try again.');
    assert.equal(socialRefreshErrorMessage(new Error('anything')), 'Couldn’t load friends. Check your connection and try again.');
  });
});
