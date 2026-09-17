import * as React from 'react';
import type { FriendRequest, FriendSummary } from '@rider-comms/shared';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

// Same poll cadence style as MapScreen.tsx's presence polling — no
// websocket/push infra exists in this sandbox, so the friends list and
// requests are kept fresh by re-fetching on an interval.
const FRIENDS_POLL_INTERVAL_MS = 10000;

interface FriendsContextValue {
  friends: FriendSummary[];
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
  requestProfiles: Readonly<Record<string, FriendSummary>>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  sendRequest: (toRiderId: string) => Promise<void>;
  accept: (requestId: string) => Promise<void>;
  decline: (requestId: string) => Promise<void>;
  remove: (friendId: string) => Promise<void>;
}

const FriendsContext = React.createContext<FriendsContextValue | null>(null);

function messageFor(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    // The backend's error bodies are always `{ error: '<reason>' }` (see
    // backend/src/server.ts's sendJson calls) — never `message`.
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

export function FriendsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { riderId: ME, client } = useAuth();
  const [friends, setFriends] = React.useState<FriendSummary[]>([]);
  const [incomingRequests, setIncomingRequests] = React.useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = React.useState<FriendRequest[]>([]);
  const [requestProfiles, setRequestProfiles] = React.useState<Record<string, FriendSummary>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const [friendsRes, requestsRes] = await Promise.all([
        client.getFriends(ME),
        client.getFriendRequests(ME),
      ]);
      setFriends(friendsRes.friends);
      setIncomingRequests(requestsRes.incoming);
      setOutgoingRequests(requestsRes.outgoing);
      setRequestProfiles(requestsRes.profiles);
      setError(null);
    } catch (err) {
      setError(messageFor(err, 'Could not load friends.'));
    } finally {
      setLoading(false);
    }
  }, [ME, client]);

  React.useEffect(() => {
    refresh();
    const interval = setInterval(refresh, FRIENDS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  // Unlike accept/decline/remove below, a failed add-friend attempt is
  // surfaced inline next to the input it came from (see AddFriendCard in
  // FriendsScreen.tsx) rather than in this context's shared top-of-screen
  // `error` — so this rethrows instead of calling setError.
  const sendRequest = React.useCallback(
    async (toRiderId: string) => {
      try {
        const request = await client.sendFriendRequest(toRiderId);
        setOutgoingRequests((current) => [...current, request]);
      } catch (err) {
        throw new Error(messageFor(err, 'Could not send that friend request.'));
      } finally {
        refresh();
      }
    },
    [refresh]
  );

  const accept = React.useCallback(
    async (requestId: string) => {
      // Optimistic: drop it from incoming immediately so the button doesn't
      // sit there waiting on the round trip.
      setIncomingRequests((current) => current.filter((r) => r.id !== requestId));
      try {
        const { friend } = await client.acceptFriendRequest(requestId);
        setFriends((current) => (current.some((f) => f.riderId === friend.riderId) ? current : [...current, friend]));
        setError(null);
      } catch (err) {
        setError(messageFor(err, 'Could not accept that request.'));
      } finally {
        refresh();
      }
    },
    [refresh]
  );

  const decline = React.useCallback(
    async (requestId: string) => {
      setIncomingRequests((current) => current.filter((r) => r.id !== requestId));
      try {
        await client.declineFriendRequest(requestId);
        setError(null);
      } catch (err) {
        setError(messageFor(err, 'Could not decline that request.'));
      } finally {
        refresh();
      }
    },
    [refresh]
  );

  const remove = React.useCallback(
    async (friendId: string) => {
      setFriends((current) => current.filter((f) => f.riderId !== friendId));
      try {
        await client.removeFriend(ME, friendId);
        setError(null);
      } catch (err) {
        setError(messageFor(err, 'Could not remove that friend.'));
      } finally {
        refresh();
      }
    },
    [refresh]
  );

  const value = React.useMemo(
    () => ({
      friends,
      incomingRequests,
      outgoingRequests,
      requestProfiles,
      loading,
      error,
      refresh,
      sendRequest,
      accept,
      decline,
      remove,
    }),
    [friends, incomingRequests, outgoingRequests, requestProfiles, loading, error, refresh, sendRequest, accept, decline, remove]
  );

  return <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>;
}

export function useFriends(): FriendsContextValue {
  const ctx = React.useContext(FriendsContext);
  if (!ctx) {
    throw new Error('useFriends() must be called within a FriendsProvider');
  }
  return ctx;
}
