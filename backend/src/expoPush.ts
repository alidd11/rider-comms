import type { FetchLike } from './webPush.ts';

/**
 * Native push through Expo's push service, which forwards to APNs (iOS) and
 * FCM (Android) using the credentials stored on the app's Expo project.
 * Plain HTTPS, no SDK. EXPO_ACCESS_TOKEN is optional (needed only if the
 * Expo project enables enhanced push security).
 */
export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$/;

export function isExpoPushToken(token: string): boolean {
  return EXPO_TOKEN_PATTERN.test(token);
}

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

/** Sends up to 100 messages; returns the tokens Expo says are no longer valid. */
export async function sendExpoPush(messages: ExpoPushMessage[], fetchImpl: FetchLike, accessToken?: string): Promise<{ goneTokens: string[] }> {
  if (messages.length === 0) return { goneTokens: [] };
  const response = await fetchImpl(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(messages.slice(0, 100).map((message) => ({ ...message, sound: 'default', priority: 'high', channelId: 'default' }))),
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`expo push failed: ${response.status}`);
  const parsed = JSON.parse(await response.text()) as { data?: Array<{ status?: string; details?: { error?: string } }> };
  const goneTokens = (parsed.data ?? []).flatMap((ticket, index) =>
    ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered' ? [messages[index]!.to] : []);
  return { goneTokens };
}
