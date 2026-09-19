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
// The microphone is created and muted before publication by
// useVoiceActivity.ts; LiveKitRoom never auto-publishes an open mic.
import * as React from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Alert } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LiveKitRoom } from '@livekit/react-native';
import { audioEngine } from '../audio/audioEngine';
import { LiveKitAudioPriorityBridge } from '../audio/LiveKitAudioPriorityBridge';
import { acquireVoiceAudioSession, releaseVoiceAudioSession } from '../audio/audioSession';
import { useVoiceActivity } from '../audio/useVoiceActivity';
import { useAuth } from '../auth/AuthContext';
import { ActiveSpeakerBridge } from '../voice/ActiveSpeakerBridge';
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
function useVoiceAudioSession(active: boolean): { ready: boolean; error: string | null } {
  const [state, setState] = React.useState<{ ready: boolean; error: string | null }>({ ready: false, error: null });

  React.useEffect(() => {
    if (!active) {
      setState({ ready: false, error: null });
      return;
    }

    let stopped = false;
    setState({ ready: false, error: null });
    void acquireVoiceAudioSession('private-ride')
      .then(() => {
        if (!stopped) setState({ ready: true, error: null });
      })
      .catch(() => {
        if (!stopped) {
          setState({
            ready: false,
            error: 'Audio routing is unavailable. Check microphone permission and your Bluetooth connection.',
          });
        }
      });

    return () => {
      if (stopped) return;
      stopped = true;
      void releaseVoiceAudioSession('private-ride').catch(() => {});
    };
  }, [active]);

  return state;
}

function useRideVoiceToken(rideId: string | undefined, refreshKey: number): { token?: string; url?: string; error?: string } {
  const { client } = useAuth();
  const [state, setState] = React.useState<{ token?: string; url?: string; error?: string }>({});

  React.useEffect(() => {
    if (!rideId) { setState({}); return; }
    let cancelled = false;
    // Drop stale credentials before a terminal-reconnect attempt. A fresh
    // token must be re-authorised by Rider Comms before a new media room
    // instance can be created.
    setState({});
    client.getRideVoiceToken(rideId)
      .then((res) => { if (!cancelled) setState({ token: res.token, url: res.url }); })
      .catch((err) => { if (!cancelled) setState({ error: err instanceof Error ? err.message : 'Could not connect to voice' }); });
    return () => { cancelled = true; };
  }, [rideId, client, refreshKey]);

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
  onError,
}: {
  enabled: boolean;
  onSpeakingChange: (speaking: boolean) => void;
  onError: (message: string) => void;
}): null {
  const isSpeaking = useVoiceActivity(enabled, onError);
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
export function RideBar({ controlsVisible = true }: { controlsVisible?: boolean } = {}): React.JSX.Element | null {
  const { activeRide, leaveRide, roster, shareRideLocation, setRideLocationSharing } = useRide();
  const { client, riderId } = useAuth();
  const { lockedForSafety } = useMovementSafety();
  const [expanded, setExpanded] = React.useState(false);
  const [gains, setGains] = React.useState(audioEngine.getGains());
  const [talking, setTalking] = React.useState(false);
  const [remoteSpeakerIds, setRemoteSpeakerIds] = React.useState<Set<string>>(new Set());
  const [memberNames, setMemberNames] = React.useState<Map<string, string>>(new Map());
  const [manuallyMuted, setManuallyMuted] = React.useState(false);
  const [locationShareBusy, setLocationShareBusy] = React.useState(false);
  const [locationShareError, setLocationShareError] = React.useState<string | null>(null);
  const [voiceRetryVersion, setVoiceRetryVersion] = React.useState(0);
  const voiceRetryTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Hooks run unconditionally, before the !activeRide early return below.
  const voice = useRideVoiceToken(activeRide?.rideId, voiceRetryVersion);
  const audioSession = useVoiceAudioSession(Boolean(activeRide));
  const audioSessionError = audioSession.error;
  const [roomStatus, setRoomStatus] = React.useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [roomError, setRoomError] = React.useState<string | null>(null);
  const voiceConnected = Boolean(voice.token && voice.url && audioSession.ready);
  const handleSpeakingChange = React.useCallback((speaking: boolean) => {
    // This is the local rider's VOX state. Remote speaking state comes from
    // LiveKit's room-level ActiveSpeakersChanged event below.
    setTalking(speaking);
  }, []);
  const handleActiveSpeakerIds = React.useCallback((speakerIds: string[]) => {
    const next = new Set(speakerIds.filter((identity) => identity && identity !== riderId));
    setRemoteSpeakerIds((current) => {
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [riderId]);
  const scheduleVoiceRetry = React.useCallback(() => {
    if (voiceRetryTimer.current) return;
    voiceRetryTimer.current = setTimeout(() => {
      voiceRetryTimer.current = undefined;
      setVoiceRetryVersion((version) => version + 1);
    }, 2_000);
  }, []);

  const handleVoiceRuntimeError = React.useCallback((message: string) => {
    setRoomStatus('error');
    setRoomError(message || 'Microphone is unavailable.');
  }, []);

  React.useEffect(() => () => {
    if (voiceRetryTimer.current) clearTimeout(voiceRetryTimer.current);
  }, []);

  React.useEffect(() => {
    return audioEngine.onGainsChanged(setGains);
  }, []);

  React.useEffect(() => {
    setRoomStatus('connecting');
    setRoomError(null);
    setRemoteSpeakerIds(new Set());
  }, [activeRide?.rideId]);

  const rosterKey = React.useMemo(() => [...roster].sort().join('\u0000'), [roster]);
  React.useEffect(() => {
    if (!activeRide || !rosterKey) {
      setMemberNames(new Map());
      return;
    }
    let cancelled = false;
    const ids = rosterKey.split('\u0000').filter((id) => id && id !== riderId);
    void Promise.all(ids.map(async (id) => {
      try {
        const profile = await client.getPublicProfile(id);
        return [id, profile.displayName || profile.handle || 'Rider'] as const;
      } catch {
        return [id, 'Rider'] as const;
      }
    })).then((entries) => {
      if (!cancelled) setMemberNames(new Map(entries));
    });
    return () => { cancelled = true; };
  }, [activeRide?.rideId, client, riderId, rosterKey]);

  React.useEffect(() => {
    if (!controlsVisible) setExpanded(false);
  }, [controlsVisible]);

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

  const toggleRideLocation = async () => {
    setLocationShareBusy(true);
    setLocationShareError(null);
    const ok = await setRideLocationSharing(!shareRideLocation);
    if (!ok) setLocationShareError('Could not update ride location sharing. Check location permission and try again.');
    setLocationShareBusy(false);
  };

  const voiceFailure = audioSessionError ?? voice.error ?? roomError;
  const remoteSpeakerNames = [...remoteSpeakerIds].map((id) => memberNames.get(id) ?? 'Rider');
  const remoteSpeakerSummary = remoteSpeakerNames.length === 0
    ? null
    : remoteSpeakerNames.length === 1
      ? remoteSpeakerNames[0]
      : `${remoteSpeakerNames[0]} + ${remoteSpeakerNames.length - 1}`;
  const activeSpeakerLabel = roomStatus === 'connected'
    ? remoteSpeakerSummary
      ? `${remoteSpeakerSummary} speaking`
      : talking
        ? 'You speaking'
        : null
    : null;
  const voiceLabel = voiceFailure
    ? 'Voice unavailable'
    : roomStatus === 'connected'
      ? activeSpeakerLabel ?? 'Voice connected'
      : roomStatus === 'disconnected'
        ? 'Voice disconnected'
        : 'Connecting voice';

  return (
    <LiveKitRoom
      key={`${activeRide.rideId}:${voice.token ?? 'pending'}`}
      serverUrl={voice.url}
      token={voice.token}
      connect={voiceConnected}
      onConnected={() => { setRoomStatus('connected'); setRoomError(null); }}
      onDisconnected={() => {
        setRoomStatus('disconnected');
        setRemoteSpeakerIds(new Set());
        scheduleVoiceRetry();
      }}
      onError={(error) => {
        handleVoiceRuntimeError(error.message || 'Could not connect to voice.');
        scheduleVoiceRetry();
      }}
      onMediaDeviceFailure={() => handleVoiceRuntimeError('Microphone or audio device became unavailable.')}
    >
      <VoiceActivityBridge
        enabled={voiceConnected && !manuallyMuted}
        onSpeakingChange={handleSpeakingChange}
        onError={handleVoiceRuntimeError}
      />
      <ActiveSpeakerBridge onSpeakerIdsChange={handleActiveSpeakerIds} />
      <LiveKitAudioPriorityBridge sourceId={`ride:${activeRide.rideId}`} />

      {controlsVisible && lockedForSafety ? (
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
        </View>
      ) : controlsVisible ? (
        <>
          <Pressable style={({ pressed }) => [styles.bar, pressed && styles.barPressed]} onPress={() => setExpanded(true)}>
            <View style={styles.liveDot} />
            <MaterialCommunityIcons name="motorbike" size={18} color={colors.accent} />
            <Text style={styles.barText}>In ride{activeRide.code ? ` · ${activeRide.code}` : ''}</Text>
            {activeSpeakerLabel && (
              <View style={styles.speakerPill} accessibilityLiveRegion="polite">
                <Ionicons name="mic" size={13} color={colors.accent} />
                <Text numberOfLines={1} style={styles.speakerPillText}>{activeSpeakerLabel}</Text>
              </View>
            )}
            {shareRideLocation && (
              <View style={styles.locationLivePill}>
                <Ionicons name="location" size={13} color={colors.success} />
                <Text style={styles.locationLiveText}>Live</Text>
              </View>
            )}
            <Ionicons name="chevron-up" size={18} color={colors.textSecondary} />
          </Pressable>

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

              <View style={styles.locationCard}>
                <View style={styles.locationCardCopy}>
                  <Text style={styles.locationCardTitle}>Share my live location</Text>
                  <Text style={styles.locationCardBody}>
                    {shareRideLocation
                      ? 'On — current ride members can see your recent position.'
                      : 'Off — your position is not being uploaded to this ride.'}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: shareRideLocation, disabled: locationShareBusy }}
                  accessibilityLabel="Share my live location with this ride"
                  disabled={locationShareBusy}
                  onPress={() => void toggleRideLocation()}
                  style={[styles.locationSwitch, shareRideLocation && styles.locationSwitchOn]}
                >
                  <View style={[styles.locationSwitchKnob, shareRideLocation && styles.locationSwitchKnobOn]} />
                </Pressable>
              </View>
              {locationShareError && <Text style={styles.voiceError}>{locationShareError}</Text>}

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
        </>
      ) : null}
    </LiveKitRoom>
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
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    ...elevation.raised,
  },
  barPressed: { opacity: 0.85 },
  barText: { ...type.body, color: colors.textPrimary, flex: 1 },
  speakerPill: {
    maxWidth: 160, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 4, borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  speakerPillText: { ...type.caption, color: colors.accent, fontWeight: '800', flexShrink: 1 },
  locationLivePill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 4, borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  locationLiveText: { ...type.caption, color: colors.success, fontWeight: '800' },
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
  locationCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, padding: spacing.md, borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  locationCardCopy: { flex: 1 },
  locationCardTitle: { ...type.label, color: colors.textPrimary },
  locationCardBody: { ...type.caption, color: colors.textSecondary, marginTop: 3, lineHeight: 18 },
  locationSwitch: {
    width: 50, height: 30, borderRadius: 15, padding: 3,
    justifyContent: 'center', backgroundColor: colors.surfaceRaised,
    borderWidth: 1, borderColor: colors.border,
  },
  locationSwitchOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  locationSwitchKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.textMuted },
  locationSwitchKnobOn: { alignSelf: 'flex-end', backgroundColor: colors.accentText },
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
