// Public/private LiveKit voice and hands-free VOX have been confirmed on
// physical devices. The current sensitivity envelope is intentionally
// conservative for helmet/intercom use; broader wind/engine/headset testing
// is still required before treating the tuning as production-final. Token
// fetches remain server-authorised, and useVoiceActivity.ts creates and mutes
// the real microphone track before publication so LiveKitRoom never
// auto-publishes an open mic.
import * as React from 'react';
import { View, Text, Pressable, Modal, Alert, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LiveKitRoom } from '@livekit/react-native';
import { ApiError } from '../api/client';
import { audioEngine } from '../audio/audioEngine';
import { LiveKitAudioPriorityBridge } from '../audio/LiveKitAudioPriorityBridge';
import { acquireVoiceAudioSession, releaseVoiceAudioSession } from '../audio/audioSession';
import { useVoiceActivity } from '../audio/useVoiceActivity';
import { useAuth } from '../auth/AuthContext';
import { ActiveSpeakerBridge } from '../voice/ActiveSpeakerBridge';
import { colors } from '../theme';
import { styles } from './RideBar.styles';
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
function useVoiceAudioSession(active: boolean, retryKey: number): { ready: boolean; error: string | null } {
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
  }, [active, retryKey]);

  return state;
}

function useRideVoiceToken(
  rideId: string | undefined,
  refreshKey: number,
): { token?: string; url?: string; error?: string; retryable?: boolean } {
  const { client } = useAuth();
  const [state, setState] = React.useState<{ token?: string; url?: string; error?: string; retryable?: boolean }>({});

  React.useEffect(() => {
    if (!rideId) { setState({}); return; }
    let cancelled = false;
    // Drop stale credentials before a terminal-reconnect attempt. A fresh
    // token must be re-authorised by Rider Comms before a new media room
    // instance can be created.
    setState({});
    client.getRideVoiceToken(rideId)
      .then((res) => { if (!cancelled) setState({ token: res.token, url: res.url }); })
      .catch((err) => {
        if (cancelled) return;
        const retryable = !(err instanceof ApiError)
          || err.status === 408
          || err.status === 429
          || err.status >= 500;
        const code = err instanceof ApiError
          && typeof err.body === 'object'
          && err.body
          && 'error' in (err.body as Record<string, unknown>)
          ? String((err.body as Record<string, unknown>).error)
          : '';
        setState({
          error: code === 'email_verification_required'
            ? 'Verify your email before using ride voice.'
            : err instanceof Error ? err.message : 'Could not connect to voice',
          retryable,
        });
      });
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
  const [codeCopied, setCodeCopied] = React.useState(false);
  const codeCopiedTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [voiceRetryVersion, setVoiceRetryVersion] = React.useState(0);
  const [audioSessionRetryVersion, setAudioSessionRetryVersion] = React.useState(0);
  const voiceRetryTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Hooks run unconditionally, before the !activeRide early return below.
  const voice = useRideVoiceToken(activeRide?.rideId, voiceRetryVersion);
  const audioSession = useVoiceAudioSession(Boolean(activeRide), audioSessionRetryVersion);
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

  // Audio-session permission/device failures are not safe to hammer in an
  // automatic loop: the rider may need to reconnect Bluetooth or change an
  // OS permission first. When stationary, the existing voice control becomes
  // an explicit retry action. Re-acquire native audio routing only when that
  // setup itself failed; ordinary token/LiveKit retries keep a healthy audio
  // session leased so Bluetooth/music playback is not needlessly disrupted.
  const retryVoiceManually = React.useCallback(() => {
    if (voiceRetryTimer.current) {
      clearTimeout(voiceRetryTimer.current);
      voiceRetryTimer.current = undefined;
    }
    setTalking(false);
    setRemoteSpeakerIds(new Set());
    setRoomStatus('connecting');
    setRoomError(null);
    setManuallyMuted(false);
    if (audioSessionError) setAudioSessionRetryVersion((version) => version + 1);
    setVoiceRetryVersion((version) => version + 1);
  }, [audioSessionError]);

  // A token request can fail before LiveKitRoom ever exists, so neither
  // onError nor onDisconnected can start the normal reconnect loop. Retry
  // transient/network/rate-limit/server failures through the same fresh-token
  // path; do not hammer permanent 4xx authorisation/membership failures.
  React.useEffect(() => {
    if (!activeRide?.rideId || !voice.error || voice.retryable !== true) return;
    scheduleVoiceRetry();
  }, [activeRide?.rideId, scheduleVoiceRetry, voice.error, voice.retryable]);

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

  React.useEffect(() => {
    return () => {
      if (codeCopiedTimeout.current) clearTimeout(codeCopiedTimeout.current);
    };
  }, []);

  if (!activeRide) return null;

  const handleShareCode = async () => {
    const code = activeRide.code;
    if (!code) return;
    try {
      await Share.share({ message: `Join my Rider Comms group ride with code ${code}` });
    } catch {
      // Ignore share-sheet dismissal; copy remains available separately.
    }
  };

  const handleCopyCode = async () => {
    const code = activeRide.code;
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCodeCopied(true);
    if (codeCopiedTimeout.current) clearTimeout(codeCopiedTimeout.current);
    codeCopiedTimeout.current = setTimeout(() => setCodeCopied(false), 2000);
  };

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
                  <View style={styles.codeCardHead}>
                    <Text style={styles.codeLabel}>{codeCopied ? 'Copied to clipboard' : 'Share code'}</Text>
                    <View style={styles.codeCardActions}>
                      <Pressable
                        style={styles.codeCardAction}
                        onPress={() => void handleCopyCode()}
                        accessibilityRole="button"
                        accessibilityLabel="Copy ride code"
                      >
                        <Ionicons name={codeCopied ? 'checkmark' : 'copy-outline'} size={18} color={codeCopied ? colors.success : colors.accent} />
                      </Pressable>
                      <Pressable
                        style={styles.codeCardAction}
                        onPress={() => void handleShareCode()}
                        accessibilityRole="button"
                        accessibilityLabel="Share ride code"
                      >
                        <Ionicons name="share-outline" size={18} color={colors.accent} />
                      </Pressable>
                    </View>
                  </View>
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
                accessibilityRole="button"
                accessibilityLabel={voiceFailure
                  ? 'Retry voice connection'
                  : manuallyMuted
                    ? 'Unmute hands-free voice'
                    : 'Mute hands-free voice'}
                style={({ pressed }) => [
                  styles.talkButton,
                  talking && !voiceFailure && styles.talkButtonActive,
                  pressed && styles.talkButtonPressed,
                ]}
                onPress={() => {
                  if (voiceFailure) retryVoiceManually();
                  else setManuallyMuted((muted) => !muted);
                }}
              >
                <Ionicons
                  name={voiceFailure ? 'refresh' : manuallyMuted ? 'mic-off' : talking ? 'mic' : 'mic-outline'}
                  size={22}
                  color={colors.textPrimary}
                />
                <Text style={styles.talkButtonText}>
                  {voiceFailure
                    ? 'Retry voice'
                    : manuallyMuted
                      ? 'Muted — tap to unmute'
                      : talking
                        ? 'Talking'
                        : 'Listening — hands-free'}
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

