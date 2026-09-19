import { createHash } from 'node:crypto';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';

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

export interface VoiceRoomAdmin {
  removeParticipant(roomName: string, identity: string): Promise<void>;
  deleteRoom(roomName: string): Promise<void>;
}

export function liveKitServiceUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
  else if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
  else if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('LIVEKIT_URL must use ws, wss, http, or https');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function createVoiceRoomAdmin(credentials: LiveKitCredentials): VoiceRoomAdmin {
  const client = new RoomServiceClient(
    liveKitServiceUrl(credentials.url),
    credentials.apiKey,
    credentials.apiSecret,
  );
  return {
    // LiveKit's RemoveParticipant RPC also revokes previously issued tokens
    // for this identity. When revokeTokenTs is omitted the protocol defaults
    // to server-now plus one minute of clock-skew leeway.
    removeParticipant: (roomName, identity) => client.removeParticipant(roomName, identity),
    deleteRoom: (roomName) => client.deleteRoom(roomName),
  };
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
  accessToken.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canPublishData: false,
    canSubscribe: true,
  });
  const token = await accessToken.toJwt();
  return { token, url: credentials.url };
}
