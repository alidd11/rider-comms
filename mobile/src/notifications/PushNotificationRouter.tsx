import * as React from 'react';
import * as Notifications from 'expo-notifications';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import { useFriends } from '../friends/FriendsContext';
import type { RootStackParamList } from '../navigation';
import { notificationQuickAction, notificationRoute, syncPush } from './pushNotifications';

/**
 * Opens what a tapped notification is about (a friend request: Friends; a
 * message or an accepted request: that chat), including when the tap is
 * what launched the app. Also keeps this phone's registration current.
 * Renders nothing. The PWA does the same in openAppRoute (docs/app).
 */
export function PushNotificationRouter({ navigationRef }: {
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>;
}): null {
  const { client, riderId } = useAuth();
  const { friends, refresh, refreshMessages } = useFriends();
  const friendsRef = React.useRef(friends);
  friendsRef.current = friends;
  const actionsRef = React.useRef({ client, refresh, refreshMessages });
  actionsRef.current = { client, refresh, refreshMessages };

  React.useEffect(() => {
    void syncPush(client, riderId).catch(() => undefined);
  }, [client, riderId]);

  React.useEffect(() => {
    const open = (data: unknown) => {
      const route = notificationRoute(data);
      if (!route || !navigationRef.isReady()) return;
      if (route.screen === 'map') {
        navigationRef.navigate('Tabs', { screen: 'Map' });
        return;
      }
      if (route.screen === 'chat') {
        const friend = friendsRef.current.find((person) => person.riderId === route.riderId);
        if (friend) {
          navigationRef.navigate('FriendChat', { riderId: friend.riderId, displayName: friend.displayName, avatarId: friend.avatarId });
          return;
        }
      }
      navigationRef.navigate('Tabs', { screen: 'Friends' });
    };
    // Reply, Accept and Decline run without opening anything; if one fails,
    // open what it was about so the rider can do it there.
    const act = async (response: Notifications.NotificationResponse): Promise<boolean> => {
      const { data } = response.notification.request.content;
      const action = notificationQuickAction(response.actionIdentifier, data, response.userText);
      if (!action) return false;
      const { client: api, refresh: refreshNetwork, refreshMessages: refreshChats } = actionsRef.current;
      try {
        if (action.kind === 'reply') {
          await api.sendMessage(action.riderId, action.text);
          await refreshChats();
        } else {
          await (action.kind === 'accept' ? api.acceptFriendRequest(action.requestId) : api.declineFriendRequest(action.requestId));
          await refreshNetwork();
        }
        await Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(() => undefined);
      } catch {
        open(data);
      }
      return true;
    };
    let cancelled = false;
    // The tap that launched the app: wait for navigation (and give the
    // friends list a moment to load), then clear it so a later launch
    // doesn't open it again.
    void (async () => {
      const response = await Notifications.getLastNotificationResponseAsync();
      if (!response) return;
      for (let attempt = 0; attempt < 25 && !cancelled && (!navigationRef.isReady() || friendsRef.current.length === 0); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (cancelled) return;
      if (!(await act(response))) open(response.notification.request.content.data);
      await Notifications.clearLastNotificationResponseAsync?.();
    })().catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void act(response).then((handled) => { if (!handled) open(response.notification.request.content.data); });
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [navigationRef]);

  return null;
}
