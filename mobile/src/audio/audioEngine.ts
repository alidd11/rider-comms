/**
 * The Audio Engine (spec Sections 4 & 7): decides who/what gets to be
 * heard right now — nav prompt > group chat > music — and hands the
 * resulting gain levels to native audio code.
 *
 * WHAT'S REAL HERE: the priority decision itself (`computeAudioGains`,
 * imported from @rider-comms/shared) is genuine, tested logic — see
 * shared/tests/audioPriority.test.ts.
 *
 * WHAT'S STUBBED: everything below marked TODO needs native modules
 * (VAD/noise-suppression models, real audio session routing to a
 * Bluetooth helmet headset) that can't be installed or run in this
 * sandbox at all — no device, no npm registry access for
 * react-native-webrtc/livekit-react-native, no native build tooling.
 * This class is written to the shape those libraries expect so wiring
 * them in later is a matter of filling in the TODOs, not restructuring.
 */
import { computeAudioGains } from '@rider-comms/shared';
import type { AudioGainLevels, AudioSourceState } from '@rider-comms/shared';

export type VoiceActivityListener = (isSpeaking: boolean) => void;

export class AudioEngine {
  private state: AudioSourceState = {
    navPromptActive: false,
    chatActive: false,
    musicPlaying: false,
  };

  private currentGains: AudioGainLevels = { nav: 0, chat: 0, music: 0 };
  private gainChangeListeners = new Set<(gains: AudioGainLevels) => void>();

  /**
   * TODO(native): replace this with a real on-device VAD pipeline —
   * mic -> acoustic echo cancellation -> wind/road noise suppression
   * (RNNoise or Krisp SDK) -> VAD gate (Silero VAD / WebRTC VAD), per
   * Section 4 of the spec. This method currently only exists so the rest
   * of the app has a stable interface to call against.
   */
  onLocalVoiceActivity(_listener: VoiceActivityListener): () => void {
    // No-op until native VAD is wired in. Returns an unsubscribe fn to
    // match the shape real implementations (and tests) will expect.
    return () => {};
  }

  setNavPromptActive(active: boolean): void {
    this.state = { ...this.state, navPromptActive: active };
    this.recomputeGains();
  }

  setChatActive(active: boolean): void {
    this.state = { ...this.state, chatActive: active };
    this.recomputeGains();
  }

  setMusicPlaying(playing: boolean): void {
    this.state = { ...this.state, musicPlaying: playing };
    this.recomputeGains();
  }

  getGains(): AudioGainLevels {
    return this.currentGains;
  }

  onGainsChanged(listener: (gains: AudioGainLevels) => void): () => void {
    this.gainChangeListeners.add(listener);
    return () => this.gainChangeListeners.delete(listener);
  }

  private recomputeGains(): void {
    this.currentGains = computeAudioGains(this.state);
    // TODO(native): apply currentGains.nav/chat/music to the actual audio
    // session (e.g. via react-native-webrtc's track enable/gain APIs and
    // whatever the media-control bridge exposes for music volume).
    for (const listener of this.gainChangeListeners) {
      listener(this.currentGains);
    }
  }
}
