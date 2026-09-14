import * as React from 'react';
import type { FriendRequest, FriendSummary } from '@rider-comms/shared';
import { ApiError, RiderCommsClient } from '../api/client';
import { API_BASE_URL } from '../config';

// Same poll cadence style as MapScreen.tsx's presence polling — no
// websocket/push infra exists in this sandbox, so the friends list and
// requests are kept fresh by re-fetching on an interval.
const FRIENDS_POLL_INTERVAL_MS = 10000;

// TODO: replace 'me' with the real signed-in rider id once auth exists
// (see CreateRideScreen.tsx for the same pattern elsewhere in this app).
const ME = 'me';

interface FriendsContextValue {
  friends: FriendSummary[];
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
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
    return typeof err.body === 'object' && err.body && 'error' in (err.body as Record<string, unknown>)
      ? String((err.body as Record<string, unknown>).error)
      : fallback;
  }
  return err instanceof Error ? err.message : fallback;
}

export function FriendsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [friends, setFriends] = React.useState<FriendSummary[]>([]);
  const [incomingRequests, setIncomingRequests] = React.useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = React.useState<FriendRequest[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const clientRef = React.useRef(new RiderCommsClient(API_BASE_URL));

  const refresh = React.useCallback(async () => {
    try {
      const client = clientRef.current;
      const [friendsRes, requestsRes] = await Promise.all([
        client.getFriends(ME),
        client.getFriendRequests(ME),
      ]);
      setFriends(friendsRes.friends);
      setIncomingRequests(requestsRes.incoming);
      setOutgoingRequests(requestsRes.outgoing);
      setError(null);
    } catch (err) {
      setError(messageFor(err, 'Could not load friends.'));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
    const interval = setInterval(refresh, FRIENDS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const sendRequest = React.useCallback(
    async (toRiderId: string) => {
      try {
        const request = await clientRef.current.sendFriendRequest(ME, toRiderId);
        setOutgoingRequests((current) => [...current, request]);
        setError(null);
      } catch (err) {
        setError(messageFor(err, 'Could not send that friend request.'));
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
        const { friend } = await clientRef.current.acceptFriendRequest(requestId);
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
        await clientRef.current.declineFriendRequest(requestId);
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
        await clientRef.current.removeFriend(ME, friendId);
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
      loading,
      error,
      refresh,
      sendRequest,
      accept,
      decline,
      remove,
    }),
    [friends, incomingRequests, outgoingRequests, loading, error, refresh, sendRequest, accept, decline, remove]
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
