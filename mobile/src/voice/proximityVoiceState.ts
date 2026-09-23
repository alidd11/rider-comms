export const DEFAULT_PROXIMITY_VOICE_REFRESH_MS = 20_000;
export const DEFAULT_PROXIMITY_VOICE_AUTHORIZATION_LEASE_MS = 60_000;

function validPositiveMs(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function resolveProximityVoiceRetryDelay(
  consecutiveFailures: number,
  normalRefreshMs = DEFAULT_PROXIMITY_VOICE_REFRESH_MS,
): number {
  const refreshCap = validPositiveMs(normalRefreshMs)
    ? normalRefreshMs
    : DEFAULT_PROXIMITY_VOICE_REFRESH_MS;
  const failures = Number.isFinite(consecutiveFailures)
    ? Math.max(1, Math.floor(consecutiveFailures))
    : 1;
  // 5s, 10s, then cap at the normal server cadence. This gives a rider
  // multiple recovery attempts inside the authorization lease without
  // creating a tight retry loop during a backend outage.
  const retryMs = 5_000 * (2 ** Math.min(2, failures - 1));
  return Math.min(refreshCap, retryMs);
}

export function resolveProximityVoiceTiming(
  refreshAfterMs: number | undefined,
  authorizationLeaseMs: number | undefined,
): { refreshAfterMs: number; authorizationLeaseMs: number } {
  const requestedRefresh = validPositiveMs(refreshAfterMs)
    ? refreshAfterMs
    : DEFAULT_PROXIMITY_VOICE_REFRESH_MS;
  const fallbackLease = Math.max(
    DEFAULT_PROXIMITY_VOICE_AUTHORIZATION_LEASE_MS,
    requestedRefresh * 3,
  );
  const lease = validPositiveMs(authorizationLeaseMs)
    ? authorizationLeaseMs
    : fallbackLease;
  // Never make a server-advertised authorization window longer on the client.
  // If a future server shortens the lease below its refresh cadence, refresh
  // earlier instead so re-authorization still happens before expiry.
  const refresh = Math.min(requestedRefresh, Math.max(1, Math.floor(lease / 2)));
  return { refreshAfterMs: refresh, authorizationLeaseMs: lease };
}

export function prunePeerSet(current: ReadonlySet<string>, authorisedPeerIds: ReadonlySet<string>): Set<string> {
  const next = new Set<string>();
  for (const peerId of current) {
    if (authorisedPeerIds.has(peerId)) next.add(peerId);
  }
  return next;
}

export function proximityVoiceStatus({
  error,
  authorizationExpired,
  manuallyMuted,
  localSpeaking,
  remoteSpeakingNames,
  connectedCount,
  pendingCount,
}: {
  error: boolean;
  authorizationExpired: boolean;
  manuallyMuted: boolean;
  localSpeaking: boolean;
  remoteSpeakingNames: readonly string[];
  connectedCount: number;
  pendingCount: number;
}): string {
  if (error) return 'Nearby Voice unavailable';
  if (authorizationExpired) return 'Nearby Voice · reconnecting';
  if (localSpeaking) return 'Nearby Voice · You speaking';
  if (remoteSpeakingNames.length === 1) {
    return `Nearby Voice · ${remoteSpeakingNames[0]} speaking${manuallyMuted ? ' · Mic muted' : ''}`;
  }
  if (remoteSpeakingNames.length > 1) {
    return `Nearby Voice · ${remoteSpeakingNames[0]} + ${remoteSpeakingNames.length - 1} speaking${manuallyMuted ? ' · Mic muted' : ''}`;
  }
  if (manuallyMuted && connectedCount > 0) return 'Nearby Voice · Mic muted';
  if (connectedCount === 1) return 'Nearby Voice · Listening';
  if (connectedCount > 1) return `Nearby Voice · Listening · ${connectedCount} riders`;
  if (pendingCount > 0) return 'Connecting Nearby Voice';
  return 'Nearby Voice · waiting for riders';
}
