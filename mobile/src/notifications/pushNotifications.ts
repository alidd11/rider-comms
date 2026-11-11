import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Push notifications on this phone. The server sends through Expo's push
 * service (backend/src/expoPush.ts), which needs this app's Expo project id:
 * EAS_PROJECT_ID in app.config.js. The PWA does the same with Web Push
 * (docs/app/10-settings.js).
 */

// Shown while Rider Comms is open too (as a banner), like the PWA.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PushPermission = 'granted' | 'denied' | 'undetermined';

export class PushNotConfiguredError extends Error {
  constructor() {
    super('This build of Rider Comms isn’t set up for notifications yet.');
    this.name = 'PushNotConfiguredError';
  }
}

interface PushClient {
  registerPushToken(token: string): Promise<unknown>;
  unregisterPushToken(token: string): Promise<unknown>;
}

const tokenKey = (riderId: string): string => `@rider-comms/push-token/${riderId}`;

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

export async function pushPermission(): Promise<PushPermission> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

/** Whether this phone currently has notifications on for this account. */
export async function pushEnabledOnDevice(riderId: string): Promise<boolean> {
  return (await pushPermission()) === 'granted' && Boolean(await AsyncStorage.getItem(tokenKey(riderId)));
}

async function deviceToken(): Promise<string> {
  const id = projectId();
  if (!id) throw new PushNotConfiguredError();
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Friend requests and messages',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  return (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
}

/** Asks for permission if needed, then registers this phone. False if declined. */
export async function enablePush(client: PushClient, riderId: string): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  const status = current.status === 'granted' ? current.status : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return false;
  const token = await deviceToken();
  await client.registerPushToken(token);
  await AsyncStorage.setItem(tokenKey(riderId), token);
  return true;
}

/** Stops notifications to this phone for this account (also on sign-out). */
export async function disablePush(client: PushClient, riderId: string): Promise<void> {
  const token = await AsyncStorage.getItem(tokenKey(riderId));
  if (!token) return;
  await client.unregisterPushToken(token).catch(() => undefined);
  await AsyncStorage.removeItem(tokenKey(riderId));
}

/** At startup: re-register so the server's record stays current (tokens rotate). */
export async function syncPush(client: PushClient, riderId: string): Promise<void> {
  if (!(await pushEnabledOnDevice(riderId))) return;
  const token = await deviceToken();
  await client.registerPushToken(token);
  await AsyncStorage.setItem(tokenKey(riderId), token);
}

/** The in-app route a notification opens: '#friends' or '#chat:<riderId>'. */
export function notificationRoute(data: unknown): { screen: 'friends' } | { screen: 'chat'; riderId: string } | null {
  const route = data && typeof data === 'object' ? (data as { route?: unknown }).route : undefined;
  if (route === '#friends') return { screen: 'friends' };
  const chat = typeof route === 'string' ? /^#chat:([A-Za-z0-9_-]+)$/.exec(route) : null;
  return chat ? { screen: 'chat', riderId: chat[1]! } : null;
}
