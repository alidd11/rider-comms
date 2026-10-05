/**
 * Device-level audio routing for the voice channel — separate from
 * audioEngine.ts's priority mixer (nav > chat > music), which decides WHAT
 * gets heard; this decides WHERE it's heard AND whether other apps' audio
 * survives the call at all. Riders connect any Bluetooth device their OS
 * already pairs as a call/headset audio device — a helmet intercom, a
 * standard Bluetooth headset, AirPods — and this configures the native
 * audio session so that device's mic and speaker are actually used for
 * the voice room, rather than the phone's own mic/speaker. It also asks
 * iOS to keep the rider's music/nav app playing (unducked) alongside the
 * call — see setAppleAudioConfiguration below — instead of the default
 * category, which silences other apps outright for the whole ride. There
 * is no equivalent web API for this (see docs/app.js's voice module for
 * why the PWA can't do the same), so this real coexistence is native-only.
 *
 * This is real, typed configuration against @livekit/react-native's actual
 * AudioSession API (see node_modules/@livekit/react-native's audio module)
 * — not a guess at its shape. What's unverified is everything downstream:
 * whether a specific real helmet intercom's Bluetooth profile behaves as
 * expected, and whether iOS/Android actually keep music/nav audible at the
 * volume this asks for, both of which only real hardware can confirm.
 */
import { Platform } from 'react-native';
import { AudioSession } from '@livekit/react-native';
import type { AudioConfiguration } from '@livekit/react-native';
import {
  startAndroidVoiceForegroundService,
  stopAndroidVoiceForegroundService,
} from './voiceForegroundService';

const VOICE_AUDIO_CONFIG: AudioConfiguration = {
  ios: {
    // Only used when no wired/Bluetooth output is available; with one
    // connected, iOS routes to it regardless of this setting.
    defaultOutput: 'speaker',
  },
  android: {
    // Android already defaults to this order, but the point of a rider
    // app's voice channel is specifically "prefer whatever's paired over
    // the bike", so it's worth being explicit rather than relying on the
    // library's own default staying this way.
    preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'],
    audioTypeOptions: {
      // Keep focus management explicit because the custom configuration
      // replaces LiveKit's preset. The MAY_DUCK request below is what lets
      // a well-behaved music app continue underneath Rider Comms voice.
      manageAudioFocus: true,
      audioMode: 'inCommunication',
      audioAttributesUsageType: 'voiceCommunication',
      // Some Android devices only route to a Bluetooth mic (not just the
      // Bluetooth speaker) when audio mode is forced this way — without
      // it, a paired helmet intercom's speaker can work while its mic
      // silently doesn't.
      forceHandleAudioRouting: true,
      // Android's audio focus model has no true "mix at full volume"
      // option the way iOS does below — 'gain' (the library's own
      // default) tells other apps to stop outright, which would pause a
      // rider's music/nav app entirely for the whole ride. 'gainTransientMayDuck'
      // is the closest real equivalent: well-behaved apps (Spotify, Google/
      // Apple Maps) lower their own volume instead of stopping, so nav
      // prompts and music both keep playing, just quieter under the call.
      audioFocusMode: 'gainTransientMayDuck',
    },
  },
};

// Navigation without voice: a playback session that mixes with the rider's
// music, so iOS keeps speaking turn prompts once the screen locks. Without
// an active session the app's default category goes silent in the
// background. Android needs nothing here; its speech plays in the background
// as long as the navigation location service keeps the app alive.
const NAVIGATION_APPLE_AUDIO_CONFIG = {
  audioCategory: 'playback',
  audioCategoryOptions: ['mixWithOthers', 'interruptSpokenAudioAndMixWithOthers', 'allowBluetoothA2DP', 'allowAirPlay'],
  audioMode: 'voicePrompt',
} as const satisfies Parameters<typeof AudioSession.setAppleAudioConfiguration>[0];

type SessionMode = 'off' | 'voice' | 'navigation';

let sessionMode: SessionMode = 'off';
const sessionOwners = new Set<string>();
let navigationActive = false;
let sessionOperation: Promise<void> = Promise.resolve();

function serializeSessionOperation(operation: () => Promise<void>): Promise<void> {
  const next = sessionOperation.then(operation, operation);
  sessionOperation = next.catch(() => {});
  return next;
}

async function startVoiceAudioSession(): Promise<void> {
  let foregroundServiceStarted = false;
  try {
    // Android must establish its microphone foreground service while Rider
    // Comms is still in the foreground. This helper also confirms RECORD_AUDIO
    // permission before asking Android 14+ to create a microphone-typed FGS.
    // The no-op iOS implementation preserves the same call order everywhere.
    await startAndroidVoiceForegroundService();
    foregroundServiceStarted = true;

    await AudioSession.configureAudio(VOICE_AUDIO_CONFIG);
    // configureAudio()'s own `ios` option only covers output routing (see
    // AudioConfiguration above) — the actual AVAudioSession category/mode
    // is a separate call. Without this, iOS defaults to a category that
    // silences the rider's music/nav app entirely for the whole ride, the
    // same "why did it mute my music" behaviour the PWA has no fix for
    // (there's no web API for this — see docs/app.js's voice module). The
    // native app can ask for real coexistence instead: `mixWithOthers`
    // keeps other apps' audio playing (unducked) alongside the call,
    // `allowBluetooth(A2DP)`/`allowAirPlay` keep the earlier Bluetooth
    // routing config actually reachable under a play-and-record category,
    // and `voiceChat` audio mode applies the same echo-cancellation/
    // gain tuning iOS uses for real phone/FaceTime calls.
    await AudioSession.setAppleAudioConfiguration({
      audioCategory: 'playAndRecord',
      audioCategoryOptions: ['mixWithOthers', 'allowBluetooth', 'allowBluetoothA2DP', 'allowAirPlay', 'defaultToSpeaker'],
      audioMode: 'voiceChat',
    });
    await AudioSession.startAudioSession();
  } catch (error) {
    if (foregroundServiceStarted) {
      await stopAndroidVoiceForegroundService().catch(() => {});
    }
    throw error;
  }
}

async function stopVoiceAudioSession(): Promise<void> {
  let audioSessionError: unknown;
  try {
    await AudioSession.stopAudioSession();
  } catch (error) {
    audioSessionError = error;
  }

  // Never strand the persistent Android voice notification/service if native
  // audio teardown itself throws. Conversely, surface a foreground-service
  // stop failure when audio teardown succeeded so the caller can report it.
  try {
    await stopAndroidVoiceForegroundService();
  } catch (error) {
    if (audioSessionError === undefined) throw error;
  }

  if (audioSessionError !== undefined) throw audioSessionError;
}

async function startNavigationAudioSession(): Promise<void> {
  await AudioSession.setAppleAudioConfiguration({
    ...NAVIGATION_APPLE_AUDIO_CONFIG,
    audioCategoryOptions: [...NAVIGATION_APPLE_AUDIO_CONFIG.audioCategoryOptions],
  });
  await AudioSession.startAudioSession();
}

function desiredSessionMode(): SessionMode {
  if (sessionOwners.size > 0) return 'voice';
  if (navigationActive && Platform.OS === 'ios') return 'navigation';
  return 'off';
}

/**
 * Moves the device session to what the current owners need. Voice wins over
 * navigation because its play-and-record session already plays prompts in
 * the background. Each step clears the mode before tearing down, so a
 * platform error never leaves a stale "started" flag behind.
 */
async function reconcileSession(): Promise<void> {
  const desired = desiredSessionMode();
  if (desired === sessionMode) return;
  const previous = sessionMode;
  sessionMode = 'off';
  if (previous === 'voice') await stopVoiceAudioSession();
  else if (previous === 'navigation') await AudioSession.stopAudioSession();
  if (desired === 'voice') await startVoiceAudioSession();
  else if (desired === 'navigation') await startNavigationAudioSession();
  sessionMode = desired;
}

/**
 * The device audio session is process-global, while Rider Comms has more than
 * one component that can own voice (private RideBar and public ProximityVoice).
 * Lease it by a stable owner id so one component cleaning up can never stop
 * Bluetooth/call audio that the other component has already acquired.
 * Call before LiveKitRoom's `connect` flips true: the library applies the
 * configuration only to rooms that connect after it.
 */
export function acquireVoiceAudioSession(ownerId: string): Promise<void> {
  const owner = ownerId.trim();
  if (!owner) return Promise.reject(new Error('Voice audio session owner is required.'));
  if (sessionOwners.has(owner)) return sessionOperation;
  sessionOwners.add(owner);

  return serializeSessionOperation(async () => {
    if (!sessionOwners.has(owner)) return;
    try {
      await reconcileSession();
    } catch (error) {
      sessionOwners.delete(owner);
      // Put navigation's prompt session back if voice could not start.
      await reconcileSession().catch(() => {});
      throw error;
    }
  });
}

export function releaseVoiceAudioSession(ownerId: string): Promise<void> {
  const owner = ownerId.trim();
  if (!owner || !sessionOwners.delete(owner)) return sessionOperation;
  return serializeSessionOperation(reconcileSession);
}

/** Held while turn-by-turn navigation runs. */
export function acquireNavigationAudioSession(): Promise<void> {
  navigationActive = true;
  return serializeSessionOperation(reconcileSession);
}

export function releaseNavigationAudioSession(): Promise<void> {
  navigationActive = false;
  return serializeSessionOperation(reconcileSession);
}
