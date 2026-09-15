import { AccessToken } from 'livekit-server-sdk';

/**
 * Voice transport (spec Sections 4/5/7): mints a short-lived LiveKit room
 * token for a rider. This module only signs tokens — it never talks to a
 * LiveKit server itself, so it has nothing to fake in a sandbox without one:
 * given real credentials, the JWT this produces is a real, valid LiveKit
 * token. What's actually unverified is everything downstream of it (a
 * running LiveKit deployment, and the native client actually connecting).
 */
export interface LiveKitCredentials {
  apiKey: string;
  apiSecret: string;
  url: string;
}

export function getLiveKitCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): LiveKitCredentials | null {
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;
  const url = env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) return null;
  return { apiKey, apiSecret, url };
}

/** Private ride groups (Section 5) each get their own room, one per ride. */
export function rideRoomName(rideId: string): string {
  return `ride:${rideId}`;
}

/**
 * Public local channels (Section 5) share one LiveKit room per geo-bucket —
 * the bucket is the SFU-room sharding layer from geoBucket.ts, sized larger
 * than the biggest radius tier. Riders never see the bucket id; each client
 * only subscribes to the participants currently in its own zone within
 * whatever room they land in (per-participant selective subscription,
 * which LiveKit supports natively).
 */
export function channelRoomName(bucketId: string): string {
  return `channel:${bucketId}`;
}

export interface VoiceToken {
  token: string;
  url: string;
}

export async function mintVoiceToken(
  credentials: LiveKitCredentials,
  identity: string,
  roomName: string
): Promise<VoiceToken> {
  const accessToken = new AccessToken(credentials.apiKey, credentials.apiSecret, {
    identity,
    ttl: '6h', // longer than any single ride is likely to run; rejoining mints a fresh one anyway
  });
  accessToken.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });
  const token = await accessToken.toJwt();
  return { token, url: credentials.url };
}
