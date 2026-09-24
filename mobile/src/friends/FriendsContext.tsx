import * as React from 'react';
import type { FriendActivity, FriendRequest, FriendSummary } from '@rider-comms/shared';
import { ApiError, type ConversationSummary, type RiderCommsClient } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { refreshAuthoritativeSocialSnapshot } from './socialRefresh';
import { useSettings } from '../settings/SettingsContext';
import { appendUniqueFriendRequest } from './requestState';
import {
  socialEventInvalidatesFriendProfile,
  socialEventInvalidatesOpenChat,
  socialEventNeedsMessageRefresh,
  socialEventNeedsNetworkRefresh,
} from './socialEventState';

const SOCIAL_EVENT_RETRY_MS = 2_000;
const SOCIAL_ACTIVITY_POLL_MS = 30_000;

interface FriendsContextValue {
  friends: FriendSummary[];
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
  requestProfiles: Readonly<Record<string, FriendSummary>>;
  activityByRider: Readonly<Record<string, FriendActivity>>;
  conversations: ConversationSummary[];
  unreadMessageCount: number;
  socialRevision: number;
  friendProfileRevision: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshMessages: () => Promise<void>;
  sendRequest: (toRiderId: string) => Promise<void>;
  accept: (requestId: string) => Promise<void>;
  decline: (requestId: string) => Promise<void>;
  cancel: (requestId: string) => Promise<void>;
  remove: (friendId: string) => Promise<void>;
}

const FriendsContext = React.createContext<FriendsContextValue | null>(null);

function messageFor(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const code = typeof err.body === 'object' && err.body && 'error' in (err.body as Record<string, unknown>)
      ? String((err.body as Record<string, unknown>).error)
      : '';
    const messages: Record<string, string> = {
      rider_not_found: 'No rider with that handle or Rider ID was found.',
      cannot_friend_yourself: 'You cannot send a friend request to yourself.',
      already_friends: 'You are already friends with this rider.',
      request_exists: 'A friend request is already pending between you.',
      blocked: 'This connection is unavailable.',
      rate_limited: 'Too many requests. Wait a moment and try again.',
      unauthorized: 'Your session has expired. Sign in again.',
    };
    return messages[code] ?? fallback;
  }
  return err instanceof Error ? err.message : fallback;
}

async function loadAllFriends(client: RiderCommsClient, riderId: string): Promise<FriendSummary[]> {
  const friends: FriendSummary[] = [];
  let before: string | undefined;
  do {
    const page = await client.getFriends(riderId, { before, limit: 100 });
    friends.push(...page.friends);
    before = page.nextCursor ?? undefined;
  } while (before);
  return friends;
}

async function loadAllRequests(
  client: RiderCommsClient,
  riderId: string,
): Promise<{ incoming: FriendRequest[]; outgoing: FriendRequest[]; profiles: Record<string, FriendSummary> }> {
  const incoming: FriendRequest[] = [];
  const outgoing: FriendRequest[] = [];
  const profiles: Record<string, FriendSummary> = {};
  let before: string | undefined;
  do {
    const page = await client.getFriendRequests(riderId, { before, limit: 100 });
    incoming.push(...page.incoming);
    outgoing.push(...page.outgoing);
    Object.assign(profiles, page.profiles);
    before = page.nextCursor ?? undefined;
  } while (before);
  return { incoming, outgoing, profiles };
}

async function loadAllConversations(client: RiderCommsClient): Promise<ConversationSummary[]> {
  const conversations: ConversationSummary[] = [];
  let before: string | undefined;
  do {
    const page = await client.getConversations({ before, limit: 100 });
    conversations.push(...page.conversations);
    before = page.nextCursor ?? undefined;
  } while (before);
  return conversations;
}

export function FriendsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { riderId: ME, client } = useAuth();
  const { refreshProfile } = useSettings();
  const [friends, setFriends] = React.useState<FriendSummary[]>([]);
  const [incomingRequests, setIncomingRequests] = React.useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = React.useState<FriendRequest[]>([]);
  const [requestProfiles, setRequestProfiles] = React.useState<Record<string, FriendSummary>>({});
  const [activityByRider, setActivityByRider] = React.useState<Record<string, FriendActivity>>({});
  const [conversations, setConversations] = React.useState<ConversationSummary[]>([]);
  const [unreadMessageCount, setUnreadMessageCount] = React.useState(0);
  const [socialRevision, setSocialRevision] = React.useState(0);
  const [friendProfileRevision, setFriendProfileRevision] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refreshActivity = React.useCallback(async () => {
    try {
      const activityRes = await client.getFriendActivity();
      setActivityByRider(Object.fromEntries(activityRes.activity.map((item) => [item.riderId, item])));
    } catch {
      // Keep the last authoritative state on a transient failure. Treating a
      // network error as an empty activity list falsely marks every friend
      // offline until the next successful request.
    }
  }, [client]);

  const refreshNetwork = React.useCallback(async () => {
    const [friendsRes, requestsRes] = await Promise.all([
      loadAllFriends(client, ME),
      loadAllRequests(client, ME),
    ]);
    setFriends(friendsRes);
    setIncomingRequests(requestsRes.incoming);
    setOutgoingRequests(requestsRes.outgoing);
    setRequestProfiles(requestsRes.profiles);
    await refreshActivity();
  }, [ME, client, refreshActivity]);

  const refreshMessages = React.useCallback(async () => {
    const [conversationRes, unreadRes] = await Promise.all([
      loadAllConversations(client),
      client.getUnreadMessageCount(),
    ]);
    setConversations(conversationRes);
    setUnreadMessageCount(unreadRes.unreadCount);
  }, [client]);

  const refreshAuthoritative = React.useCallback(
    () => refreshAuthoritativeSocialSnapshot(refreshNetwork, refreshMessages),
    [refreshMessages, refreshNetwork],
  );

  const refresh = React.useCallback(async () => {
    try {
      await refreshAuthoritative();
      setError(null);
    } catch (err) {
      setError(messageFor(err, 'Could not load friends.'));
    } finally {
      setLoading(false);
    }
  }, [refreshAuthoritative]);

  React.useEffect(() => {
    const interval = setInterval(() => { void refreshActivity(); }, SOCIAL_ACTIVITY_POLL_MS);
    return () => clearInterval(interval);
  }, [refreshActivity]);

  React.useEffect(() => {
    let stopped = false;
    let cursor: string | undefined;

    // Keep Friends usable even if the realtime transport is temporarily
    // unavailable. The post-baseline refresh below closes the race between
    // this initial snapshot and cursor establishment.
    void refresh();

    const run = async () => {
      while (!stopped) {
        try {
          if (!cursor) {
            const baseline = await client.getSocialEvents({ waitMs: 0, limit: 100 });
            if (stopped) return;
            cursor = baseline.cursor;
            // Establish the durable tail first, then load authoritative state.
            // An event committed after this cursor is guaranteed to replay on
            // the next long poll; one committed before it is included here.
            await Promise.all([refreshAuthoritative(), refreshProfile()]);
            // A baseline follows initial connect and every recovery. Bump the
            // social revision after the authoritative snapshot succeeds so an
            // already-open chat re-reads its thread even when the event that
            // originally dirtied it was skipped by a failed refresh/rebaseline.
            // The same baseline also refreshes this rider's account profile so
            // cross-device settings/privacy edits cannot be skipped by recovery.
            setSocialRevision((value) => value + 1);
            // A rebaseline may skip invalidation events that occurred while
            // disconnected. Refresh any currently open friend profile too.
            setFriendProfileRevision((value) => value + 1);
            setError(null);
            continue;
          }

          let page = await client.getSocialEvents({ after: cursor, waitMs: 25_000, limit: 100 });
          if (stopped) return;

          let networkDirty = false;
          let messagesDirty = false;
          let revisionDirty = false;
          let friendProfileDirty = false;
          let selfProfileDirty = false;

          while (true) {
            for (const event of page.events) {
              networkDirty ||= socialEventNeedsNetworkRefresh(event, ME);
              messagesDirty ||= socialEventNeedsMessageRefresh(event);
              revisionDirty ||= socialEventInvalidatesOpenChat(event);
              friendProfileDirty ||= socialEventInvalidatesFriendProfile(event, ME);
              selfProfileDirty ||= event.type === 'social_refresh'
                && event.entityId === 'profile'
                && event.actorRiderId === ME;
            }
            cursor = page.cursor;
            if (!page.hasMore || stopped) break;
            page = await client.getSocialEvents({ after: cursor, waitMs: 0, limit: 100 });
          }

          if (networkDirty) await refreshNetwork();
          if (messagesDirty) await refreshMessages();
          if (selfProfileDirty) await refreshProfile();
          if (friendProfileDirty) setFriendProfileRevision((value) => value + 1);
          if (revisionDirty) setSocialRevision((value) => value + 1);
          // A completed long-poll proves the realtime transport recovered,
          // even when there were no state-changing events in this page.
          setError(null);
        } catch (err) {
          if (stopped) return;
          // Re-establish the durable tail and reload authoritative state after
          // any transport/state-refresh failure. This avoids sitting on a
          // valid cursor with a stale local snapshot after recovery.
          cursor = undefined;
          setError(messageFor(err, 'Live social updates paused. Reconnecting…'));
          await new Promise<void>((resolve) => setTimeout(resolve, SOCIAL_EVENT_RETRY_MS));
        }
      }
    };

    void run();
    return () => { stopped = true; };
  }, [ME, client, refresh, refreshAuthoritative, refreshMessages, refreshNetwork, refreshProfile]);

  const sendRequest = React.useCallback(
    async (toRiderId: string) => {
      try {
        const request = await client.sendFriendRequest(toRiderId);
        setOutgoingRequests((current) => appendUniqueFriendRequest(current, request));
      } catch (err) {
        throw new Error(messageFor(err, 'Could not send that friend request.'));
      } finally {
        void refreshNetwork();
      }
    },
    [client, refreshNetwork],
  );

  // accept/decline/cancel deliberately do not re-throw, unlike sendRequest
  // and remove below: their callers already optimistically remove the list
  // item and only need to reset a local "resolving" flag in `finally`, so a
  // failure is surfaced through the shared `error` banner instead of a
  // per-call catch. sendRequest and remove back a form/confirmation flow
  // that needs to know success vs failure to decide what the UI does next
  // (keep the typed input vs clear it, keep the sheet open vs close it), so
  // those re-throw for the caller to handle.
  const accept = React.useCallback(
    async (requestId: string) => {
      setIncomingRequests((current) => current.filter((request) => request.id !== requestId));
      try {
        const { friend } = await client.acceptFriendRequest(requestId);
        setFriends((current) => (current.some((item) => item.riderId === friend.riderId) ? current : [...current, friend]));
        setError(null);
      } catch (err) {
        setError(messageFor(err, 'Could not accept that request.'));
      } finally {
        void refreshNetwork();
      }
    },
    [client, refreshNetwork],
  );

  const decline = React.useCallback(
    async (requestId: string) => {
      setIncomingRequests((current) => current.filter((request) => request.id !== requestId));
      try {
        await client.declineFriendRequest(requestId);
        setError(null);
      } catch (err) {
        setError(messageFor(err, 'Could not decline that request.'));
      } finally {
        void refreshNetwork();
      }
    },
    [client, refreshNetwork],
  );

  const cancel = React.useCallback(
    async (requestId: string) => {
      setOutgoingRequests((current) => current.filter((request) => request.id !== requestId));
      try {
        await client.cancelFriendRequest(requestId);
        setError(null);
      } catch (err) {
        setError(messageFor(err, 'Could not cancel that request.'));
      } finally {
        void refreshNetwork();
      }
    },
    [client, refreshNetwork],
  );

  const remove = React.useCallback(
    async (friendId: string) => {
      try {
        await client.removeFriend(ME, friendId);
        setFriends((current) => current.filter((friend) => friend.riderId !== friendId));
        setError(null);
      } catch (err) {
        const message = messageFor(err, 'Could not remove that friend.');
        setError(message);
        throw new Error(message);
      } finally {
        void Promise.all([refreshNetwork(), refreshMessages()]);
      }
    },
    [ME, client, refreshMessages, refreshNetwork],
  );

  const value = React.useMemo(
    () => ({
      friends,
      incomingRequests,
      outgoingRequests,
      requestProfiles,
      activityByRider,
      conversations,
      unreadMessageCount,
      socialRevision,
      friendProfileRevision,
      loading,
      error,
      refresh,
      refreshMessages,
      sendRequest,
      accept,
      decline,
      cancel,
      remove,
    }),
    [
      friends,
      incomingRequests,
      outgoingRequests,
      requestProfiles,
      activityByRider,
      conversations,
      unreadMessageCount,
      socialRevision,
      friendProfileRevision,
      loading,
      error,
      refresh,
      refreshMessages,
      sendRequest,
      accept,
      decline,
      cancel,
      remove,
    ],
  );

  return <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>;
}

export function useFriends(): FriendsContextValue {
  const ctx = React.useContext(FriendsContext);
  if (!ctx) throw new Error('useFriends() must be called within a FriendsProvider');
  return ctx;
}
