import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LiveKitRoom } from '@livekit/react-native';
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

/**
 * Connects the native app to one LiveKit room per currently authorised
 * proximity peer. Pair isolation is deliberate: even a modified client can
 * only subscribe to the other rider in that room. A private ride takes
 * priority, so the public rooms are torn down while RideBar owns voice.
 */
export function ProximityVoice({ enabled }: { enabled: boolean }): React.JSX.Element | null {
  const { client } = useAuth();
  const { activeRide } = useRide();
  const active = enabled && !activeRide;
  const [connections, setConnections] = React.useState<ProximityVoiceConnection[]>([]);
  const [connectedPeers, setConnectedPeers] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = React.useState(0);
  const [audioSessionReady, setAudioSessionReady] = React.useState(false);

  React.useEffect(() => {
    if (!active) {
      setConnections([]);
      setConnectedPeers(new Set());
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
  }, [active, client, refreshVersion]);

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
      {(connections.length > 0 || error) && (
        <View style={[styles.status, error && styles.statusError]}>
          <View style={[styles.dot, error && styles.dotError]} />
          <Text style={[styles.text, error && styles.textError]}>
            {error
              ? 'Proximity voice unavailable'
              : connectedPeers.size > 0
                ? `Proximity voice · ${connectedPeers.size} connected`
                : 'Connecting proximity voice'}
          </Text>
        </View>
      )}
      {connections.map((connection) => {
        const retryPeer = () => {
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
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  dotError: { backgroundColor: colors.danger },
  text: { ...type.caption, color: colors.textSecondary, fontWeight: '700' },
  textError: { color: colors.danger },
});
