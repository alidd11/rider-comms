import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LiveKitRoom } from '@livekit/react-native';
import type { ProximityVoiceConnection } from '../api/client';
import { acquireVoiceAudioSession, releaseVoiceAudioSession } from '../audio/audioSession';
import { LiveKitAudioPriorityBridge } from '../audio/LiveKitAudioPriorityBridge';
import { useVoiceActivity } from '../audio/useVoiceActivity';
import { ActiveSpeakerBridge } from './ActiveSpeakerBridge';
import {
  DEFAULT_PROXIMITY_VOICE_REFRESH_MS,
  proximityVoiceStatus,
  prunePeerSet,
  resolveProximityVoiceTiming,
} from './proximityVoiceState';
import { useAuth } from '../auth/AuthContext';
import { useRide } from '../ride/RideContext';
import { colors, elevation, radii, spacing, type } from '../theme';

function VoiceActivityBridge({
  enabled,
  onError,
  onSpeakingChange,
}: {
  enabled: boolean;
  onError: (message: string) => void;
  onSpeakingChange: (speaking: boolean) => void;
}): null {
  const speaking = useVoiceActivity(enabled, onError);
  React.useEffect(() => {
    onSpeakingChange(speaking);
  }, [onSpeakingChange, speaking]);
  return null;
}

/**
 * Connects the native app to one LiveKit room per currently authorised
 * proximity peer. Pair isolation is deliberate: even a modified client can
 * only subscribe to the other rider in that room. A private ride takes
 * priority, so the public rooms are torn down while RideBar owns voice.
 */
export function ProximityVoice({
  enabled,
  peerIds = [],
}: {
  enabled: boolean;
  peerIds?: string[];
}): React.JSX.Element | null {
  const { client } = useAuth();
  const { activeRide } = useRide();
  const active = enabled && !activeRide;
  const [connections, setConnections] = React.useState<ProximityVoiceConnection[]>([]);
  const [connectedPeers, setConnectedPeers] = React.useState<Set<string>>(new Set());
  const [speakingPeers, setSpeakingPeers] = React.useState<Set<string>>(new Set());
  const [localSpeakingPeers, setLocalSpeakingPeers] = React.useState<Set<string>>(new Set());
  const [peerNames, setPeerNames] = React.useState<Map<string, string>>(new Map());
  const [error, setError] = React.useState<string | null>(null);
  const [audioSessionError, setAudioSessionError] = React.useState<string | null>(null);
  const [authorizationExpired, setAuthorizationExpired] = React.useState(false);
  const [refreshVersion, setRefreshVersion] = React.useState(0);
  const [audioSessionRetryVersion, setAudioSessionRetryVersion] = React.useState(0);
  const [audioSessionReady, setAudioSessionReady] = React.useState(false);
  const [manuallyMuted, setManuallyMuted] = React.useState(false);
  const authorizationLeaseTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hasAuthorizedOnce = React.useRef(false);
  const peerRosterKey = React.useMemo(
    () => [...peerIds].sort().join('\u0000'),
    [peerIds],
  );
  const connectionRosterKey = React.useMemo(
    () => connections.map((connection) => connection.peerId).sort().join('\u0000'),
    [connections],
  );

  const clearAuthorizationLease = React.useCallback(() => {
    if (authorizationLeaseTimer.current) {
      clearTimeout(authorizationLeaseTimer.current);
      authorizationLeaseTimer.current = undefined;
    }
  }, []);

  const expireAuthorizationLease = React.useCallback(() => {
    authorizationLeaseTimer.current = undefined;
    setConnections([]);
    setConnectedPeers(new Set());
    setSpeakingPeers(new Set());
    setLocalSpeakingPeers(new Set());
    setPeerNames(new Map());
    setError(null);
    setAuthorizationExpired(true);
  }, []);

  const renewAuthorizationLease = React.useCallback((leaseMs: number) => {
    clearAuthorizationLease();
    authorizationLeaseTimer.current = setTimeout(expireAuthorizationLease, leaseMs);
  }, [clearAuthorizationLease, expireAuthorizationLease]);

  React.useEffect(() => () => clearAuthorizationLease(), [clearAuthorizationLease]);

  const handlePeerSpeaking = React.useCallback((peerId: string, speaking: boolean) => {
    setSpeakingPeers((current) => {
      const next = new Set(current);
      if (speaking) next.add(peerId);
      else next.delete(peerId);
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, []);

  const handleLocalSpeaking = React.useCallback((peerId: string, speaking: boolean) => {
    setLocalSpeakingPeers((current) => {
      const next = new Set(current);
      if (speaking) next.add(peerId);
      else next.delete(peerId);
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (!active) {
      clearAuthorizationLease();
      hasAuthorizedOnce.current = false;
      setConnections([]);
      setConnectedPeers(new Set());
      setSpeakingPeers(new Set());
      setLocalSpeakingPeers(new Set());
      setPeerNames(new Map());
      setError(null);
      setAudioSessionError(null);
      setAuthorizationExpired(false);
      setManuallyMuted(false);
      return;
    }

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      let nextRefreshMs = DEFAULT_PROXIMITY_VOICE_REFRESH_MS;
      try {
        const response = await client.getChannelVoiceToken();
        const timing = resolveProximityVoiceTiming(
          response.refreshAfterMs,
          response.authorizationLeaseMs,
        );
        nextRefreshMs = timing.refreshAfterMs;
        if (!cancelled) {
          const authorisedPeerIds = new Set(response.connections.map((connection) => connection.peerId));
          // Keep the existing credential for unchanged peers so connected
          // rooms are not needlessly remounted every refresh. New peers get
          // a fresh token; removed peers disappear and disconnect at once.
          setConnections((current) => {
            const previous = new Map(current.map((connection) => [connection.peerId, connection]));
            return response.connections.map((connection) => previous.get(connection.peerId) ?? connection);
          });
          setConnectedPeers((current) => prunePeerSet(current, authorisedPeerIds));
          setSpeakingPeers((current) => prunePeerSet(current, authorisedPeerIds));
          setLocalSpeakingPeers((current) => prunePeerSet(current, authorisedPeerIds));
          setPeerNames((current) => new Map(
            [...current].filter(([peerId]) => authorisedPeerIds.has(peerId)),
          ));
          hasAuthorizedOnce.current = true;
          setAuthorizationExpired(false);
          setError(null);
          renewAuthorizationLease(timing.authorizationLeaseMs);
        }
      } catch (cause) {
        if (!cancelled && !hasAuthorizedOnce.current) {
          setError(cause instanceof Error ? cause.message : 'Proximity voice is unavailable.');
        }
        // If a previous authorization is still leased, preserve that existing
        // pair through a transient backend miss. The independent lease timer
        // fails closed if re-authorization cannot be confirmed in time.
      } finally {
        if (!cancelled) {
          refreshTimer = setTimeout(() => void refresh(), nextRefreshMs);
        }
      }
    }

    void refresh();
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [
    active,
    clearAuthorizationLease,
    client,
    peerRosterKey,
    refreshVersion,
    renewAuthorizationLease,
  ]);

  React.useEffect(() => {
    if (!active || !connectionRosterKey) {
      setPeerNames(new Map());
      return;
    }
    let cancelled = false;
    const ids = connectionRosterKey.split('\u0000').filter(Boolean);
    void Promise.all(ids.map(async (peerId) => {
      try {
        const profile = await client.getPublicProfile(peerId);
        return [peerId, profile.displayName || profile.handle || 'Nearby rider'] as const;
      } catch {
        return [peerId, 'Nearby rider'] as const;
      }
    })).then((entries) => {
      if (!cancelled) setPeerNames(new Map(entries));
    });
    return () => { cancelled = true; };
  }, [active, client, connectionRosterKey]);

  const needsAudioSession = active && connections.length > 0;
  React.useEffect(() => {
    if (!needsAudioSession) {
      setAudioSessionReady(false);
      setAudioSessionError(null);
      return;
    }

    let stopped = false;
    setAudioSessionReady(false);
    setAudioSessionError(null);
    void acquireVoiceAudioSession('proximity')
      .then(() => {
        if (!stopped) {
          setAudioSessionReady(true);
          setAudioSessionError(null);
        }
      })
      .catch(() => {
        if (!stopped) {
          setAudioSessionReady(false);
          setAudioSessionError('Microphone or Bluetooth audio is unavailable.');
        }
      });

    return () => {
      stopped = true;
      void releaseVoiceAudioSession('proximity').catch(() => {});
    };
  }, [audioSessionRetryVersion, needsAudioSession]);

  if (!active) return null;

  const speakingPeerIds = [...speakingPeers].filter((peerId) => connectedPeers.has(peerId));
  const speakingNames = speakingPeerIds.map((peerId) => peerNames.get(peerId) ?? 'Nearby rider');
  const localSpeaking = [...localSpeakingPeers].some((peerId) => connectedPeers.has(peerId));
  const partialConnectionIssue = Boolean(error && connectedPeers.size > 0 && !audioSessionError && !authorizationExpired);
  const statusHasIssue = Boolean(error || audioSessionError || authorizationExpired);
  const statusText = partialConnectionIssue
    ? `Nearby Voice · ${connectedPeers.size} connected · Reconnecting`
    : proximityVoiceStatus({
      error: Boolean(error || audioSessionError),
      authorizationExpired,
      manuallyMuted,
      localSpeaking,
      remoteSpeakingNames: speakingNames,
      connectedCount: connectedPeers.size,
      pendingCount: connections.length,
    });
  const voiceControlEnabled = connectedPeers.size > 0 || statusHasIssue;
  const voiceControlLabel = audioSessionError
    ? 'Nearby Voice unavailable — tap to retry audio'
    : authorizationExpired
      ? 'Nearby Voice reconnecting — tap to retry'
      : error
        ? connectedPeers.size > 0
          ? `${displayStatusText} — tap to retry disconnected riders`
          : 'Nearby Voice unavailable — tap to retry'
        : connectedPeers.size > 0
          ? manuallyMuted
            ? `${statusText} — tap to unmute microphone`
            : speakingNames.length > 0
              ? `${statusText} — tap to mute microphone`
              : 'Listening — hands-free — tap to mute microphone'
          : statusText;
  const displayStatusText = statusHasIssue && !partialConnectionIssue
    ? `${statusText} · Tap to retry`
    : statusText;
  const handleVoiceControlPress = () => {
    if (audioSessionError || authorizationExpired || (error && connectedPeers.size === 0)) {
      setError(null);
      setAudioSessionError(null);
      setConnections([]);
      setConnectedPeers(new Set());
      setSpeakingPeers(new Set());
      setLocalSpeakingPeers(new Set());
      setPeerNames(new Map());
      setAudioSessionRetryVersion((version) => version + 1);
      setRefreshVersion((version) => version + 1);
      return;
    }
    if (error && connectedPeers.size > 0) {
      // A single pair-room failure must not tear down healthy nearby rooms.
      // retryPeer() already removed the failed credential; a fresh
      // authorization fetch can restore only that peer.
      setError(null);
      setRefreshVersion((version) => version + 1);
      return;
    }
    if (connectedPeers.size > 0) {
      setManuallyMuted((muted) => !muted);
    }
  };

  return (
    <View pointerEvents="box-none" style={styles.host} accessibilityLiveRegion="polite">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={voiceControlLabel}
        accessibilityState={{ disabled: !voiceControlEnabled }}
        disabled={!voiceControlEnabled}
        onPress={handleVoiceControlPress}
        style={({ pressed }) => [
          styles.status,
          statusHasIssue && styles.statusError,
          pressed && voiceControlEnabled && styles.statusPressed,
        ]}
      >
        <View style={[styles.dot, statusHasIssue && styles.dotError]} />
        <Text style={[styles.text, statusHasIssue && styles.textError]}>
          {statusText}
        </Text>
      </Pressable>
      {connections.map((connection) => {
        const retryPeer = () => {
          setConnectedPeers((current) => {
            const next = new Set(current);
            next.delete(connection.peerId);
            return next;
          });
          handlePeerSpeaking(connection.peerId, false);
          handleLocalSpeaking(connection.peerId, false);
          // Remove the failed credential so the refresh cannot preserve it;
          // the next authorised roster response will supply a fresh token.
          setConnections((current) => current.filter((item) => item.peerId !== connection.peerId));
          setRefreshVersion((version) => version + 1);
        };
        return (
        <LiveKitRoom
          key={`${connection.peerId}:${connection.token}`}
          serverUrl={connection.url}
          token={connection.token}
          connect={audioSessionReady}
          onConnected={() => {
            setError(null);
            setConnectedPeers((current) => new Set(current).add(connection.peerId));
          }}
          onDisconnected={retryPeer}
          onError={() => {
            setError('Could not connect to proximity voice.');
            retryPeer();
          }}
          onMediaDeviceFailure={() => setAudioSessionError('Microphone or audio device became unavailable.')}
        >
          <VoiceActivityBridge
            enabled={!manuallyMuted}
            onError={(message) => setAudioSessionError(message || 'Microphone is unavailable.')}
            onSpeakingChange={(speaking) => handleLocalSpeaking(connection.peerId, speaking)}
          />
          <ActiveSpeakerBridge
            onSpeakerIdsChange={(speakerIds) => handlePeerSpeaking(connection.peerId, speakerIds.includes(connection.peerId))}
          />
          <LiveKitAudioPriorityBridge sourceId={`proximity:${connection.peerId}`} />
        </LiveKitRoom>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: 84, zIndex: 11 },
  status: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    ...elevation.raised,
  },
  statusError: { borderColor: colors.danger },
  statusPressed: { opacity: 0.78 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  dotError: { backgroundColor: colors.danger },
  text: { ...type.caption, color: colors.textSecondary, fontWeight: '700' },
  textError: { color: colors.danger },
});
