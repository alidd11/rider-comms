// Unverified on real hardware — see navigation/index.tsx header note. This
// sandbox has no native build tooling and no device to actually place a
// call from, so the LiveKit connection itself (and the exact VOX
// threshold/hangtime tuning in useVoiceActivity.ts) have never been
// confirmed on real hardware. What IS real and code-verified: the token
// fetch from the backend (client.getRideVoiceToken /
// backend/src/liveKitToken.ts, genuine and tested end-to-end against a
// real LiveKit Cloud project), and hands-free VOX itself — see
// ../audio/useVoiceActivity.ts, which mutes/unmutes the real published mic
// track based on a real native on-device volume reading, not a stub.
// `audio: true` still publishes the mic on connect, but VoiceActivityBridge
// immediately takes over muting it until real speech is detected.
import * as React from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Alert } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LiveKitRoom } from '@livekit/react-native';
import { AudioEngine } from '../audio/audioEngine';
import { startVoiceAudioSession, stopVoiceAudioSession } from '../audio/audioSession';
import { useVoiceActivity } from '../audio/useVoiceActivity';
import { useAuth } from '../auth/AuthContext';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { useRide } from './RideContext';
import { useMovementSafety } from '../safety/MovementSafetyContext';

/**
 * Configures + starts the native audio session (device routing — see
 * audioSession.ts) as soon as a ride is active, and stops it on leave.
 * Must run before LiveKitRoom's `connect` flips true, which is why this
 * fires on `active` (the ride existing) rather than waiting on the voice
 * token to resolve — the token fetch and the audio session setup happen
 * in parallel, not one after the other.
 */
function useVoiceAudioSession(active: boolean): string | null {
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!active) { setError(null); return; }
    let stopped = false;
    setError(null);
    void startVoiceAudioSession().catch(() => {
      if (!stopped) setError('Audio routing is unavailable. Check microphone permission and your Bluetooth connection.');
    });
    return () => {
      if (stopped) return;
      stopped = true;
      void stopVoiceAudioSession().catch(() => {});
    };
  }, [active]);
  return error;
}

function useRideVoiceToken(rideId: string | undefined): { token?: string; url?: string; error?: string } {
  const { client } = useAuth();
  const [state, setState] = React.useState<{ token?: string; url?: string; error?: string }>({});

  React.useEffect(() => {
    if (!rideId) { setState({}); return; }
    let cancelled = false;
    client.getRideVoiceToken(rideId)
      .then((res) => { if (!cancelled) setState({ token: res.token, url: res.url }); })
      .catch((err) => { if (!cancelled) setState({ error: err instanceof Error ? err.message : 'Could not connect to voice' }); });
    return () => { cancelled = true; };
  }, [rideId, client]);

  return state;
}

const CHANNELS: Array<{ key: 'nav' | 'chat' | 'music'; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'nav', label: 'Navigation', icon: 'navigate' },
  { key: 'chat', label: 'Group Chat', icon: 'people' },
  { key: 'music', label: 'Music', icon: 'musical-notes' },
];

function GainBar({ value }: { value: number }): React.JSX.Element {
  return (
    <View style={styles.gainTrack}>
      <View style={[styles.gainFill, { width: `${Math.round(value * 100)}%` }]} />
    </View>
  );
}

/**
 * Bridges real VOX detection (which needs LiveKit room context, so it can
 * only run inside `<LiveKitRoom>`) out to the AudioEngine/UI state that
 * lives in the outer RideBar component, which renders that same
 * `<LiveKitRoom>`. Renders nothing itself.
 */
function VoiceActivityBridge({
  enabled,
  onSpeakingChange,
}: {
  enabled: boolean;
  onSpeakingChange: (speaking: boolean) => void;
}): null {
  const isSpeaking = useVoiceActivity(enabled);
  React.useEffect(() => {
    onSpeakingChange(isSpeaking);
  }, [isSpeaking, onSpeakingChange]);
  return null;
}

/**
 * Floating "mini-player"-style bar for an active ride, visible over every
 * tab (à la a music app's now-playing bar) instead of taking over the whole
 * screen — tap it to expand the full mixer + leave-ride controls.
 */
export function RideBar(): React.JSX.Element | null {
  const { activeRide, leaveRide } = useRide();
  const { lockedForSafety } = useMovementSafety();
  const [expanded, setExpanded] = React.useState(false);
  const audioEngineRef = React.useRef(new AudioEngine());
  const [gains, setGains] = React.useState(audioEngineRef.current.getGains());
  const [talking, setTalking] = React.useState(false);
  const [manuallyMuted, setManuallyMuted] = React.useState(false);
  // Hooks run unconditionally, before the `!activeRide` early return below —
  // the hook itself is a no-op (empty state) while there's no active ride.
  const voice = useRideVoiceToken(activeRide?.rideId);
  const audioSessionError = useVoiceAudioSession(Boolean(activeRide));
  const [roomStatus, setRoomStatus] = React.useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [roomError, setRoomError] = React.useState<string | null>(null);
  const voiceConnected = Boolean(voice.token && voice.url);
  const handleSpeakingChange = React.useCallback((speaking: boolean) => {
    setTalking(speaking);
    audioEngineRef.current.setChatActive(speaking);
  }, []);

  React.useEffect(() => {
    return audioEngineRef.current.onGainsChanged(setGains);
  }, []);

  React.useEffect(() => {
    setRoomStatus('connecting');
    setRoomError(null);
  }, [activeRide?.rideId]);

  if (!activeRide) return null;

  const handleLeave = () => {
    Alert.alert(
      'Leave ride?',
      "You'll stop sharing your location with this group.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            setExpanded(false);
            void leaveRide();
          },
        },
      ]
    );
  };

  const voiceFailure = audioSessionError ?? voice.error ?? roomError;
  const voiceLabel = voiceFailure
    ? 'Voice unavailable'
    : roomStatus === 'connected'
      ? 'Voice connected'
      : roomStatus === 'disconnected'
        ? 'Voice disconnected'
        : 'Connecting voice';

  if (lockedForSafety) {
    return (
      <View style={styles.lockedBar} accessibilityLiveRegion="polite">
        <View style={[styles.liveDot, voiceFailure && styles.errorDot]} />
        <MaterialCommunityIcons name="motorbike" size={18} color={colors.accent} />
        <View style={styles.lockedBarCopy}>
          <Text style={styles.barText}>In ride{activeRide.code ? ` · ${activeRide.code}` : ''}</Text>
          <Text style={[styles.voiceStatusText, voiceFailure && styles.voiceError]}>{voiceLabel}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Leave active ride"
          style={styles.compactLeaveButton}
          onPress={handleLeave}
        >
          <Ionicons name="exit-outline" size={20} color={colors.danger} />
          <Text style={styles.compactLeaveText}>Leave</Text>
        </Pressable>
        {voiceConnected && (
          <LiveKitRoom
            serverUrl={voice.url}
            token={voice.token}
            audio
            connect
            onConnected={() => setRoomStatus('connected')}
            onDisconnected={() => setRoomStatus('disconnected')}
            onError={(error) => { setRoomStatus('error'); setRoomError(error.message || 'Could not connect to voice.'); }}
          >
            <VoiceActivityBridge enabled={!manuallyMuted} onSpeakingChange={handleSpeakingChange} />
          </LiveKitRoom>
        )}
      </View>
    );
  }

  return (
    <>
      <Pressable style={({ pressed }) => [styles.bar, pressed && styles.barPressed]} onPress={() => setExpanded(true)}>
        <View style={styles.liveDot} />
        <MaterialCommunityIcons name="motorbike" size={18} color={colors.accent} />
        <Text style={styles.barText}>In ride{activeRide.code ? ` · ${activeRide.code}` : ''}</Text>
        <Ionicons name="chevron-up" size={18} color={colors.textSecondary} />
      </Pressable>

      <LiveKitRoom
        serverUrl={voice.url}
        token={voice.token}
        audio
        connect={voiceConnected}
        onConnected={() => setRoomStatus('connected')}
        onDisconnected={() => setRoomStatus('disconnected')}
        onError={(error) => { setRoomStatus('error'); setRoomError(error.message || 'Could not connect to voice.'); }}
      >
      <VoiceActivityBridge enabled={voiceConnected && !manuallyMuted} onSpeakingChange={handleSpeakingChange} />
      <Modal visible={expanded} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setExpanded(false)}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View style={styles.statusRow}>
              <View style={styles.liveDot} />
              <Text style={styles.statusText}>In ride</Text>
            </View>
            <Pressable onPress={() => setExpanded(false)} style={styles.closeButton}>
              <Ionicons name="chevron-down" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          {activeRide.code && (
            <View style={styles.codeCard}>
              <Text style={styles.codeLabel}>Share code</Text>
              <Text style={styles.codeValue}>{activeRide.code}</Text>
            </View>
          )}
          <Text style={styles.rideId}>Ride ID: {activeRide.rideId}</Text>
          <Text style={[styles.voiceStatusText, voiceFailure && styles.voiceError]}>{voiceLabel}</Text>
          {voiceFailure && <Text style={styles.voiceError}>{voiceFailure}</Text>}

          <View style={styles.mixerCard}>
            <Text style={styles.mixerLabel}>Audio priority — nav overrides chat overrides music</Text>
            {CHANNELS.map(({ key, label, icon }) => (
              <View key={key} style={styles.gainRow}>
                <Ionicons name={icon} size={18} color={colors.textSecondary} style={styles.gainIcon} />
                <Text style={styles.gainLabel}>{label}</Text>
                <GainBar value={gains[key]} />
              </View>
            ))}
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.talkButton,
              talking && styles.talkButtonActive,
              pressed && styles.talkButtonPressed,
            ]}
            onPress={() => setManuallyMuted((muted) => !muted)}
          >
            <Ionicons
              name={manuallyMuted ? 'mic-off' : talking ? 'mic' : 'mic-outline'}
              size={22}
              color={colors.textPrimary}
            />
            <Text style={styles.talkButtonText}>
              {manuallyMuted ? 'Muted — tap to unmute' : talking ? 'Talking' : 'Listening — hands-free'}
            </Text>
          </Pressable>

          <Pressable style={({ pressed }) => [styles.leaveButton, pressed && styles.leaveButtonPressed]} onPress={handleLeave}>
            <Ionicons name="exit-outline" size={20} color={colors.danger} />
            <Text style={styles.leaveButtonText}>Leave Ride</Text>
          </Pressable>
        </View>
      </Modal>
      </LiveKitRoom>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    ...elevation.raised,
  },
  barPressed: { opacity: 0.85 },
  barText: { ...type.body, color: colors.textPrimary, flex: 1 },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success },
  errorDot: { backgroundColor: colors.danger },
  voiceStatusText: { ...type.caption, color: colors.textSecondary },
  lockedBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    minHeight: 58, backgroundColor: colors.surfaceRaised,
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg,
    paddingHorizontal: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.sm,
    ...elevation.raised,
  },
  lockedBarCopy: { flex: 1, minWidth: 0 },
  compactLeaveButton: {
    minHeight: MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.sm, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.danger,
  },
  compactLeaveText: { ...type.caption, color: colors.danger, fontWeight: '800' },
  sheet: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeButton: { padding: spacing.xs },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusText: { ...type.label, color: colors.success },
  codeCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    alignItems: 'center',
    ...elevation.raised,
  },
  codeLabel: { ...type.caption },
  codeValue: { fontSize: 32, fontWeight: '800', letterSpacing: 6, color: colors.accent, marginTop: spacing.xs },
  rideId: { ...type.caption },
  voiceError: { ...type.caption, color: colors.danger },
  mixerCard: { backgroundColor: colors.surface, padding: spacing.md, borderRadius: radii.lg, gap: spacing.md },
  mixerLabel: { ...type.caption, marginBottom: spacing.xs },
  gainRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  gainIcon: { width: 18 },
  gainLabel: { ...type.body, color: colors.textPrimary, width: 90 },
  gainTrack: { flex: 1, height: 8, borderRadius: radii.pill, backgroundColor: colors.border, overflow: 'hidden' },
  gainFill: { height: '100%', backgroundColor: colors.accent, borderRadius: radii.pill },
  talkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    marginTop: 'auto',
  },
  talkButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  talkButtonPressed: { opacity: 0.85 },
  talkButtonText: { ...type.button, color: colors.textPrimary },
  leaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  leaveButtonPressed: { backgroundColor: colors.dangerSurface },
  leaveButtonText: { ...type.button, color: colors.danger },
});
