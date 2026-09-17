import { createHash } from 'node:crypto';
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
 * A public proximity conversation is isolated to exactly two authorised
 * riders. The opaque digest avoids exposing either rider ID through the
 * LiveKit room name while the canonical ordering gives both clients the
 * same room. This makes LiveKit's room boundary the privacy boundary: a
 * modified client cannot subscribe to a third rider because that rider is
 * never in this room.
 */
export function proximityRoomName(riderA: string, riderB: string): string {
  const pair = [riderA, riderB].sort().join('\u0000');
  return `proximity:${createHash('sha256').update(pair).digest('hex').slice(0, 32)}`;
}

export interface VoiceToken {
  token: string;
  url: string;
}

export async function mintVoiceToken(
  credentials: LiveKitCredentials,
  identity: string,
  roomName: string,
  ttl: string | number = '6h'
): Promise<VoiceToken> {
  const accessToken = new AccessToken(credentials.apiKey, credentials.apiSecret, {
    identity,
    ttl,
  });
  accessToken.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });
  const token = await accessToken.toJwt();
  return { token, url: credentials.url };
}
