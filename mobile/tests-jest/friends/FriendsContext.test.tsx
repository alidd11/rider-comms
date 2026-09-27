import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { FriendRequest, FriendSummary, SocialEvent, SocialEventPage } from '@rider-comms/shared';
import { ApiError } from '../../src/api/client';
import type { RiderCommsClient } from '../../src/api/client';
import { FriendsProvider, useFriends } from '../../src/friends/FriendsContext';

const ME = 'me';

let mockAuthValue: { riderId: string; client: Partial<RiderCommsClient> } | null = null;
jest.mock('../../src/auth/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

const mockRefreshProfile = jest.fn();
jest.mock('../../src/settings/SettingsContext', () => ({
  useSettings: () => ({ refreshProfile: mockRefreshProfile }),
}));

function friend(riderId: string): FriendSummary {
  return { riderId, displayName: riderId, handle: `@${riderId}`, avatarId: 'default' };
}

function friendRequest(id: string, fromRiderId: string, toRiderId: string): FriendRequest {
  return { id, fromRiderId, toRiderId, status: 'pending', createdAt: 0 };
}

function socialEvent(type: SocialEvent['type'], actorRiderId: string, entityId = 'x'): SocialEvent {
  return { cursor: 'unused', type, actorRiderId, entityId, createdAt: 0 };
}

function page(events: SocialEvent[], cursor: string): SocialEventPage {
  return { events, cursor, hasMore: false };
}

/**
 * client.getSocialEvents() drives an infinite long-poll loop in the
 * provider. Rather than let a resolved mock spin that loop as fast as
 * microtasks allow, every call returns a promise this helper controls, so
 * the loop always blocks on the latest call until the test explicitly
 * settles it.
 */
function deferredSocialEvents() {
  const pending: Array<{ args: unknown; resolve: (page: SocialEventPage) => void; reject: (error: unknown) => void }> = [];
  const getSocialEvents = jest.fn((...args: unknown[]) => new Promise<SocialEventPage>((resolve, reject) => {
    pending.push({ args, resolve, reject });
  }));
  async function resolveNext(result: SocialEventPage): Promise<void> {
    await waitFor(() => expect(pending.length).toBeGreaterThan(0));
    const call = pending.shift()!;
    await act(async () => { call.resolve(result); });
  }
  async function rejectNext(error: unknown): Promise<void> {
    await waitFor(() => expect(pending.length).toBeGreaterThan(0));
    const call = pending.shift()!;
    await act(async () => { call.reject(error); });
  }
  return { getSocialEvents, resolveNext, rejectNext };
}

async function renderFriends(client: Partial<RiderCommsClient>) {
  mockAuthValue = { riderId: ME, client };
  return renderHook(() => useFriends(), {
    wrapper: ({ children }) => <FriendsProvider>{children}</FriendsProvider>,
  });
}

function baseClient(overrides: Partial<RiderCommsClient> = {}): Partial<RiderCommsClient> {
  return {
    getFriendActivity: jest.fn(async () => ({ activity: [] })),
    getFriends: jest.fn(async () => ({ friends: [], nextCursor: null })),
    getFriendRequests: jest.fn(async () => ({ incoming: [], outgoing: [], profiles: {}, nextCursor: null })),
    getConversations: jest.fn(async () => ({ conversations: [], nextCursor: null })),
    getUnreadMessageCount: jest.fn(async () => ({ unreadCount: 0 })),
    ...overrides,
  };
}

beforeEach(() => {
  mockRefreshProfile.mockReset().mockResolvedValue(undefined);
});

test('loads friends, requests, and conversations on mount', async () => {
  const { getSocialEvents } = deferredSocialEvents();
  const client = baseClient({
    getFriends: jest.fn(async () => ({ friends: [friend('a')], nextCursor: null })),
    getSocialEvents,
  });
  const { result } = await renderFriends(client);

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.friends).toEqual([friend('a')]);
  expect(client.getFriendActivity).toHaveBeenCalledTimes(1);
});

test('establishes a baseline cursor and bumps both revisions', async () => {
  const { getSocialEvents, resolveNext } = deferredSocialEvents();
  const client = baseClient({ getSocialEvents });
  const { result } = await renderFriends(client);
  await waitFor(() => expect(result.current.loading).toBe(false));

  await resolveNext(page([], 'c1'));

  await waitFor(() => expect(result.current.socialRevision).toBe(1));
  expect(result.current.friendProfileRevision).toBe(1);
  expect(mockRefreshProfile).toHaveBeenCalled();
});

// The mount effect's own refresh() and the baseline handshake's explicit
// refreshAuthoritative() each independently call refreshNetwork/refreshMessages
// (see refreshAuthoritativeSocialSnapshot), so every network/message client
// method is already at 2 calls by the time a baseline settles -- these tests
// capture that count and assert deltas from it, rather than hardcoding it.

test('a friend_request event refreshes the network but not messages', async () => {
  const { getSocialEvents, resolveNext } = deferredSocialEvents();
  const client = baseClient({ getSocialEvents });
  await renderFriends(client);
  await resolveNext(page([], 'c1'));
  await waitFor(() => expect(client.getFriends).toHaveBeenCalled());
  const friendsBefore = (client.getFriends as jest.Mock).mock.calls.length;
  const conversationsBefore = (client.getConversations as jest.Mock).mock.calls.length;

  await resolveNext(page([socialEvent('friend_request', 'friend-1')], 'c2'));

  await waitFor(() => expect(client.getFriends).toHaveBeenCalledTimes(friendsBefore + 1));
  expect(client.getConversations).toHaveBeenCalledTimes(conversationsBefore);
});

test('a message event refreshes messages and bumps the open-chat revision', async () => {
  const { getSocialEvents, resolveNext } = deferredSocialEvents();
  const client = baseClient({ getSocialEvents });
  const { result } = await renderFriends(client);
  await resolveNext(page([], 'c1'));
  await waitFor(() => expect(result.current.socialRevision).toBe(1));
  const friendsBefore = (client.getFriends as jest.Mock).mock.calls.length;
  const conversationsBefore = (client.getConversations as jest.Mock).mock.calls.length;

  await resolveNext(page([socialEvent('message', 'friend-1')], 'c2'));

  await waitFor(() => expect(client.getConversations).toHaveBeenCalledTimes(conversationsBefore + 1));
  expect(result.current.socialRevision).toBe(2);
  expect(client.getFriends).toHaveBeenCalledTimes(friendsBefore);
});

test('a social_refresh profile event from another rider refreshes the network and invalidates their profile', async () => {
  const { getSocialEvents, resolveNext } = deferredSocialEvents();
  const client = baseClient({ getSocialEvents });
  const { result } = await renderFriends(client);
  await resolveNext(page([], 'c1'));
  await waitFor(() => expect(client.getFriends).toHaveBeenCalled());
  const friendsBefore = (client.getFriends as jest.Mock).mock.calls.length;

  await resolveNext(page([socialEvent('social_refresh', 'friend-1', 'profile')], 'c2'));

  await waitFor(() => expect(client.getFriends).toHaveBeenCalledTimes(friendsBefore + 1));
  await waitFor(() => expect(result.current.friendProfileRevision).toBe(2));
});

test('a social_refresh profile event about this rider refreshes their own settings profile instead', async () => {
  const { getSocialEvents, resolveNext } = deferredSocialEvents();
  const client = baseClient({ getSocialEvents });
  await renderFriends(client);
  await resolveNext(page([], 'c1'));
  await waitFor(() => expect(mockRefreshProfile).toHaveBeenCalledTimes(1));
  const friendsBefore = (client.getFriends as jest.Mock).mock.calls.length;

  await resolveNext(page([socialEvent('social_refresh', ME, 'profile')], 'c2'));

  await waitFor(() => expect(mockRefreshProfile).toHaveBeenCalledTimes(2));
  expect(client.getFriends).toHaveBeenCalledTimes(friendsBefore);
});

test('recovers from a long-poll failure by rebaselining after a short delay', async () => {
  jest.useFakeTimers();
  try {
    const { getSocialEvents, resolveNext, rejectNext } = deferredSocialEvents();
    const client = baseClient({ getSocialEvents });
    const { result } = await renderFriends(client);
    await resolveNext(page([], 'c1'));
    await waitFor(() => expect(result.current.error).toBeNull());

    // An ApiError with a code the friendly-message map doesn't recognize
    // falls through to the fallback text below -- a plain Error would
    // instead surface its own .message verbatim (messageFor only applies
    // the fallback when the thrown value isn't an Error at all).
    await rejectNext(new ApiError(500, { error: 'server_error' }));
    await waitFor(() => expect(result.current.error).toBe('Live social updates paused. Reconnecting…'));

    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    await resolveNext(page([], 'c2'));

    await waitFor(() => expect(result.current.error).toBeNull());
  } finally {
    jest.useRealTimers();
  }
});

test('sendRequest appends the new outgoing request and refreshes the network', async () => {
  const { getSocialEvents } = deferredSocialEvents();
  const request = friendRequest('r1', ME, 'friend-1');
  const client = baseClient({
    getSocialEvents,
    // The finally block's fire-and-forget refreshNetwork() re-fetches
    // getFriendRequests() before this test can observe anything -- matching
    // its return value to the just-sent request (as a real server would,
    // having already recorded it) rather than the empty default keeps the
    // assertion about the final settled state, not a transient one.
    getFriendRequests: jest.fn(async () => ({ incoming: [], outgoing: [request], profiles: {}, nextCursor: null })),
    sendFriendRequest: jest.fn(async () => request),
  });
  const { result } = await renderFriends(client);
  await waitFor(() => expect(result.current.loading).toBe(false));
  const friendsBefore = (client.getFriends as jest.Mock).mock.calls.length;

  await act(async () => {
    await result.current.sendRequest('friend-1');
  });

  expect(result.current.outgoingRequests).toEqual([request]);
  await waitFor(() => expect(client.getFriends).toHaveBeenCalledTimes(friendsBefore + 1));
});

test('sendRequest surfaces a specific message and still refreshes the network on failure', async () => {
  const { getSocialEvents } = deferredSocialEvents();
  const client = baseClient({
    getSocialEvents,
    sendFriendRequest: jest.fn(async () => { throw new ApiError(409, { error: 'already_friends' }); }),
  });
  const { result } = await renderFriends(client);
  await waitFor(() => expect(result.current.loading).toBe(false));
  const friendsBefore = (client.getFriends as jest.Mock).mock.calls.length;

  await expect(act(async () => {
    await result.current.sendRequest('friend-1');
  })).rejects.toThrow('You are already friends with this rider.');

  await waitFor(() => expect(client.getFriends).toHaveBeenCalledTimes(friendsBefore + 1));
});

test('accept optimistically removes the request and settles on the new friend once the server confirms it', async () => {
  const { getSocialEvents } = deferredSocialEvents();
  const request = friendRequest('r1', 'friend-1', ME);
  const client = baseClient({
    getSocialEvents,
    getFriendRequests: jest.fn()
      .mockImplementationOnce(async () => ({ incoming: [request], outgoing: [], profiles: {}, nextCursor: null }))
      .mockImplementation(async () => ({ incoming: [], outgoing: [], profiles: {}, nextCursor: null })),
    getFriends: jest.fn()
      .mockImplementationOnce(async () => ({ friends: [], nextCursor: null }))
      .mockImplementation(async () => ({ friends: [friend('friend-1')], nextCursor: null })),
    acceptFriendRequest: jest.fn(async () => ({ friend: friend('friend-1') })),
  });
  const { result } = await renderFriends(client);
  await waitFor(() => expect(result.current.incomingRequests).toHaveLength(1));

  await act(async () => {
    await result.current.accept('r1');
  });

  await waitFor(() => expect(result.current.friends).toEqual([friend('friend-1')]));
  expect(result.current.incomingRequests).toEqual([]);
});

test('accept sets the error banner on failure, and the authoritative refresh restores the still-pending request', async () => {
  const { getSocialEvents } = deferredSocialEvents();
  const request = friendRequest('r1', 'friend-1', ME);
  const client = baseClient({
    getSocialEvents,
    // The request was never actually accepted server-side, so a realistic
    // getFriendRequests() keeps returning it -- the optimistic local removal
    // is expected to be self-healed back by that authoritative refresh.
    getFriendRequests: jest.fn(async () => ({ incoming: [request], outgoing: [], profiles: {}, nextCursor: null })),
    acceptFriendRequest: jest.fn(async () => { throw new ApiError(500, { error: 'server_error' }); }),
  });
  const { result } = await renderFriends(client);
  await waitFor(() => expect(result.current.incomingRequests).toHaveLength(1));

  await act(async () => {
    await result.current.accept('r1');
  });

  await waitFor(() => expect(result.current.error).toBe('Could not accept that request.'));
  expect(result.current.incomingRequests).toEqual([request]);
});

test('remove re-throws a specific message and sets the error banner on failure', async () => {
  const { getSocialEvents } = deferredSocialEvents();
  const client = baseClient({
    getSocialEvents,
    getFriends: jest.fn(async () => ({ friends: [friend('friend-1')], nextCursor: null })),
    removeFriend: jest.fn(async () => { throw new ApiError(500, { error: 'server_error' }); }),
  });
  const { result } = await renderFriends(client);
  await waitFor(() => expect(result.current.friends).toEqual([friend('friend-1')]));
  const conversationsBefore = (client.getConversations as jest.Mock).mock.calls.length;

  // Catching the rejection inside act()'s own callback (rather than letting
  // act() itself reject via `.rejects.toThrow`) lets React flush the
  // setError() call that happens just before the throw -- act() only
  // guarantees a full flush when its callback resolves normally.
  let thrown: unknown;
  await act(async () => {
    try {
      await result.current.remove('friend-1');
    } catch (err) {
      thrown = err;
    }
  });

  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toBe('Could not remove that friend.');
  expect(result.current.error).toBe('Could not remove that friend.');
  // remove() only filters `friends` locally after a successful removeFriend
  // call, so on failure the list is untouched (still whatever getFriends()
  // returns) rather than optimistically cleared.
  expect(result.current.friends).toEqual([friend('friend-1')]);
  await waitFor(() => expect(client.getConversations).toHaveBeenCalledTimes(conversationsBefore + 1));
});

test('polls friend activity on a 30s interval', async () => {
  jest.useFakeTimers();
  try {
    const { getSocialEvents } = deferredSocialEvents();
    const client = baseClient({ getSocialEvents });
    await renderFriends(client);
    await waitFor(() => expect(client.getFriendActivity).toHaveBeenCalledTimes(1));

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    await waitFor(() => expect(client.getFriendActivity).toHaveBeenCalledTimes(2));
  } finally {
    jest.useRealTimers();
  }
});
