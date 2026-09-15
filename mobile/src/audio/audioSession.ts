/**
 * Device-level audio routing for the voice channel — separate from
 * audioEngine.ts's priority mixer (nav > chat > music), which decides WHAT
 * gets heard; this decides WHERE it's heard. Riders connect any Bluetooth
 * device their OS already pairs as a call/headset audio device — a helmet
 * intercom, a standard Bluetooth headset, AirPods — and this configures the
 * native audio session so that device's mic and speaker are actually used
 * for the voice room, rather than the phone's own mic/speaker.
 *
 * This is real, typed configuration against @livekit/react-native's actual
 * AudioSession API (see node_modules/@livekit/react-native's audio module)
 * — not a guess at its shape. What's unverified is everything downstream:
 * whether a specific real helmet intercom's Bluetooth profile behaves as
 * expected, which only real hardware can confirm.
 */
import { AudioSession } from '@livekit/react-native';
import type { AudioConfiguration } from '@livekit/react-native';

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
      audioMode: 'inCommunication',
      audioAttributesUsageType: 'voiceCommunication',
      // Some Android devices only route to a Bluetooth mic (not just the
      // Bluetooth speaker) when audio mode is forced this way — without
      // it, a paired helmet intercom's speaker can work while its mic
      // silently doesn't.
      forceHandleAudioRouting: true,
    },
  },
};

/**
 * Call once, before LiveKitRoom's `connect` flips true — the library's own
 * docs are explicit that configuration must happen before connecting for it
 * to apply correctly. Idempotent-ish: calling it again just re-applies the
 * same configuration, which is harmless.
 */
export async function startVoiceAudioSession(): Promise<void> {
  await AudioSession.configureAudio(VOICE_AUDIO_CONFIG);
  await AudioSession.startAudioSession();
}

export async function stopVoiceAudioSession(): Promise<void> {
  await AudioSession.stopAudioSession();
}
