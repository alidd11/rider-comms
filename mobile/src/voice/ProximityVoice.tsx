import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LiveKitRoom } from '@livekit/react-native';
import type { ProximityVoiceConnection } from '../api/client';
import { startVoiceAudioSession, stopVoiceAudioSession } from '../audio/audioSession';
import { useVoiceActivity } from '../audio/useVoiceActivity';
import { useAuth } from '../auth/AuthContext';
import { useRide } from '../ride/RideContext';
import { colors, elevation, radii, spacing, type } from '../theme';

const ROSTER_REFRESH_MS = 20_000;

function VoiceActivityBridge(): null {
  useVoiceActivity(true);
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
  }, [active, client]);

  React.useEffect(() => {
    if (!active || connections.length === 0) return;
    let stopped = false;
    void startVoiceAudioSession().catch(() => {
      if (!stopped) setError('Microphone or Bluetooth audio is unavailable.');
    });
    return () => {
      stopped = true;
      void stopVoiceAudioSession().catch(() => {});
    };
  }, [active, connections.length]);

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
      {connections.map((connection) => (
        <LiveKitRoom
          key={connection.peerId}
          serverUrl={connection.url}
          token={connection.token}
          audio
          connect
          onConnected={() => setConnectedPeers((current) => new Set(current).add(connection.peerId))}
          onDisconnected={() => setConnectedPeers((current) => {
            const next = new Set(current);
            next.delete(connection.peerId);
            return next;
          })}
          onError={() => setError('Could not connect to proximity voice.')}
        >
          <VoiceActivityBridge />
        </LiveKitRoom>
      ))}
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
