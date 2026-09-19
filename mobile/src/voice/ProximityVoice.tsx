import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LiveKitRoom, useSpeakingParticipants } from '@livekit/react-native';
import type { ProximityVoiceConnection } from '../api/client';
import { acquireVoiceAudioSession, releaseVoiceAudioSession } from '../audio/audioSession';
import { LiveKitAudioPriorityBridge } from '../audio/LiveKitAudioPriorityBridge';
import { useVoiceActivity } from '../audio/useVoiceActivity';
import { useAuth } from '../auth/AuthContext';
import { useRide } from '../ride/RideContext';
import { colors, elevation, radii, spacing, type } from '../theme';

const ROSTER_REFRESH_MS = 20_000;

function VoiceActivityBridge({ onError }: { onError: (message: string) => void }): null {
  useVoiceActivity(true, onError);
  return null;
}

function RemoteSpeakerBridge({
  peerId,
  onSpeakingChange,
}: {
  peerId: string;
  onSpeakingChange: (peerId: string, speaking: boolean) => void;
}): null {
  const speakers = useSpeakingParticipants();
  const speaking = speakers.some((speaker) => speaker.identity === peerId);

  React.useEffect(() => {
    onSpeakingChange(peerId, speaking);
  }, [onSpeakingChange, peerId, speaking]);

  React.useEffect(() => () => onSpeakingChange(peerId, false), [onSpeakingChange, peerId]);

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
  const [peerLabels, setPeerLabels] = React.useState<Map<string, string>>(new Map());
  const [error, setError] = React.useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = React.useState(0);
  const [audioSessionReady, setAudioSessionReady] = React.useState(false);
  const peerRosterKey = React.useMemo(
    () => [...peerIds].sort().join('\u0000'),
    [peerIds],
  );
  const connectionPeerKey = React.useMemo(
    () => connections.map((connection) => connection.peerId).sort().join('\u0000'),
    [connections],
  );

  React.useEffect(() => {
    if (!active) {
      setConnections([]);
      setConnectedPeers(new Set());
      setSpeakingPeers(new Set());
      setPeerLabels(new Map());
      setError(null);
      return;
    }
    let cancelled = false;
    async function refresh() {
      try {
        const response = await client.getChannelVoiceToken();
        if (!cancelled) {
          // Keep the existing credential for unchanged peers so connected
          // rooms are not needlessly remounted every refresh. New peers get
          // a fresh token; removed peers disappear and disconnect at once.
          setConnections((current) => {
            const previous = new Map(current.map((connection) => [connection.peerId, connection]));
            return response.connections.map((connection) => previous.get(connection.peerId) ?? connection);
          });
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Proximity voice is unavailable.');
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), ROSTER_REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active, client, peerRosterKey, refreshVersion]);

  React.useEffect(() => {
    const ids = connectionPeerKey ? connectionPeerKey.split('\u0000') : [];
    if (!active || ids.length === 0) {
      setPeerLabels(new Map());
      return;
    }

    let cancelled = false;
    void Promise.all(ids.map(async (peerId) => {
      try {
        const profile = await client.getPublicProfile(peerId);
        return [peerId, profile.displayName] as const;
      } catch {
        return [peerId, 'Nearby rider'] as const;
      }
    })).then((entries) => {
      if (!cancelled) setPeerLabels(new Map(entries));
    });

    return () => { cancelled = true; };
  }, [active, client, connectionPeerKey]);

  const handlePeerSpeakingChange = React.useCallback((peerId: string, speaking: boolean) => {
    setSpeakingPeers((current) => {
      if (current.has(peerId) === speaking) return current;
      const next = new Set(current);
      if (speaking) next.add(peerId);
      else next.delete(peerId);
      return next;
    });
  }, []);

  const speakingNames = [...speakingPeers].map((peerId) => peerLabels.get(peerId) ?? 'Nearby rider');
  const speakerSummary = speakingNames.length === 1
    ? `${speakingNames[0]} speaking`
    : speakingNames.length === 2
      ? `${speakingNames[0]} + ${speakingNames[1]} speaking`
      : speakingNames.length > 2
        ? `${speakingNames[0]}, ${speakingNames[1]} + ${speakingNames.length - 2} speaking`
        : null;

  const needsAudioSession = active && connections.length > 0;
  React.useEffect(() => {
    if (!needsAudioSession) {
      setAudioSessionReady(false);
      return;
    }

    let stopped = false;
    setAudioSessionReady(false);
    void acquireVoiceAudioSession('proximity')
      .then(() => {
        if (!stopped) setAudioSessionReady(true);
      })
      .catch(() => {
        if (!stopped) {
          setAudioSessionReady(false);
          setError('Microphone or Bluetooth audio is unavailable.');
        }
      });

    return () => {
      stopped = true;
      void releaseVoiceAudioSession('proximity').catch(() => {});
    };
  }, [needsAudioSession]);

  if (!active) return null;

  return (
    <View pointerEvents="none" style={styles.host} accessibilityLiveRegion="polite">
      <View style={[styles.status, speakerSummary && styles.statusSpeaking, error && styles.statusError]}>
          <View style={[styles.dot, speakerSummary && styles.dotSpeaking, error && styles.dotError]} />
          <Text style={[styles.text, error && styles.textError]}>
            {error
              ? 'Nearby Voice unavailable'
              : speakerSummary
                ? `Nearby Voice · ${speakerSummary}`
                : connectedPeers.size > 0
                  ? `Nearby Voice · ${connectedPeers.size} connected`
                  : connections.length > 0
                    ? 'Connecting Nearby Voice'
                    : 'Nearby Voice · waiting for riders'}
          </Text>
        </View>
      {connections.map((connection) => {
        const retryPeer = () => {
          handlePeerSpeakingChange(connection.peerId, false);
          setConnectedPeers((current) => {
            const next = new Set(current);
            next.delete(connection.peerId);
            return next;
          });
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
          onMediaDeviceFailure={() => setError('Microphone or audio device became unavailable.')}
        >
          <VoiceActivityBridge onError={(message) => setError(message || 'Microphone is unavailable.')} />
          <RemoteSpeakerBridge peerId={connection.peerId} onSpeakingChange={handlePeerSpeakingChange} />
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
  statusSpeaking: { borderColor: colors.accent },
  statusError: { borderColor: colors.danger },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  dotSpeaking: { backgroundColor: colors.accent },
  dotError: { backgroundColor: colors.danger },
  text: { ...type.caption, color: colors.textSecondary, fontWeight: '700' },
  textError: { color: colors.danger },
});
