/**
 * The Audio Engine (spec Sections 4 & 7): decides who/what gets to be
 * heard right now — nav prompt > group chat > music — and hands the
 * resulting gain levels to native audio code.
 *
 * WHAT'S REAL HERE: the priority decision itself (`computeAudioGains`,
 * imported from @rider-comms/shared) is genuine, tested logic — see
 * shared/tests/audioPriority.test.ts. `setChatActive()` is now driven by
 * real hands-free voice detection (../audio/useVoiceActivity.ts, wired in
 * from ride/RideBar.tsx's VoiceActivityBridge) rather than a manual test
 * button — VAD (voice activity detection) is real, not a stub; see that
 * file for exactly how and its own honest caveats (unverified on real
 * hardware, threshold/hangtime not tuned against a real riding
 * environment).
 *
 * WHAT'S STILL STUBBED: applying `currentGains` to actual audio output
 * (ducking real nav/music volume) still needs native module wiring — see
 * the TODO below. That's a separate gap from voice *detection*, which is
 * done.
 */
import { computeAudioGains } from '@rider-comms/shared';
import type { AudioGainLevels, AudioSourceState } from '@rider-comms/shared';

export class AudioEngine {
  private state: AudioSourceState = {
    navPromptActive: false,
    chatActive: false,
    musicPlaying: false,
  };

  private currentGains: AudioGainLevels = { nav: 0, chat: 0, music: 0 };
  private gainChangeListeners = new Set<(gains: AudioGainLevels) => void>();

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


/**
 * One process-wide mixer state shared by ride voice and navigation prompts.
 * Keeping separate AudioEngine instances would make nav speech invisible to
 * the ride mixer even though both are part of the same audio bus.
 */
export const audioEngine = new AudioEngine();
