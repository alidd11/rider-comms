/**
 * The Audio Engine (spec Sections 4 & 7): owns the shared priority model for
 * navigation prompts, incoming voice chat and music.
 *
 * The pure priority decision comes from @rider-comms/shared. Native LiveKit
 * rooms subscribe to this engine through LiveKitAudioPriorityBridge so a
 * spoken navigation prompt can reduce real remote-chat playout volume.
 *
 * External music is still OS-managed: audioSession.ts configures coexistence
 * with other apps, but Rider Comms does not yet have a verified media-session
 * binding that can apply currentGains.music to Spotify/Apple Music.
 */
import { computeAudioGains } from '@rider-comms/shared';
import type { AudioGainLevels, AudioSourceState } from '@rider-comms/shared';

const LEGACY_CHAT_SOURCE = 'legacy';

export class AudioEngine {
  private state: AudioSourceState = {
    navPromptActive: false,
    chatActive: false,
    musicPlaying: false,
  };

  /**
   * More than one LiveKit room can be active for public proximity voice.
   * Track speaking state per room so one quiet room cannot clear another
   * room's active speaker state.
   */
  private activeChatSources = new Set<string>();

  private currentGains: AudioGainLevels = { nav: 0, chat: 0, music: 0 };
  private gainChangeListeners = new Set<(gains: AudioGainLevels) => void>();

  setNavPromptActive(active: boolean): void {
    if (this.state.navPromptActive === active) return;
    this.state = { ...this.state, navPromptActive: active };
    this.recomputeGains();
  }

  /**
   * Backwards-compatible single-source setter. New LiveKit integrations
   * should use setChatSourceActive() with a stable room/source identifier.
   */
  setChatActive(active: boolean): void {
    this.setChatSourceActive(LEGACY_CHAT_SOURCE, active);
  }

  setChatSourceActive(sourceId: string, active: boolean): void {
    const id = sourceId.trim();
    if (!id) return;

    const hadSource = this.activeChatSources.has(id);
    if (active === hadSource) return;

    if (active) this.activeChatSources.add(id);
    else this.activeChatSources.delete(id);

    const chatActive = this.activeChatSources.size > 0;
    if (this.state.chatActive === chatActive) return;
    this.state = { ...this.state, chatActive };
    this.recomputeGains();
  }

  clearChatSource(sourceId: string): void {
    this.setChatSourceActive(sourceId, false);
  }

  setMusicPlaying(playing: boolean): void {
    if (this.state.musicPlaying === playing) return;
    this.state = { ...this.state, musicPlaying: playing };
    this.recomputeGains();
  }

  getGains(): AudioGainLevels {
    return this.currentGains;
  }

  /**
   * Remote chat needs a playout gain even before anyone starts speaking.
   * Force chatActive=true through the same shared priority function so a
   * newly audible speaker starts at full volume normally, or ducked volume
   * immediately when a navigation prompt is already playing.
   */
  getIncomingChatPlaybackGain(): number {
    return computeAudioGains({ ...this.state, chatActive: true }).chat;
  }

  onGainsChanged(listener: (gains: AudioGainLevels) => void): () => void {
    this.gainChangeListeners.add(listener);
    return () => this.gainChangeListeners.delete(listener);
  }

  private recomputeGains(): void {
    this.currentGains = computeAudioGains(this.state);
    for (const listener of this.gainChangeListeners) {
      listener(this.currentGains);
    }
  }
}

/** Shared process-wide engine so every voice room and navigation prompt uses
 * the same priority state. */
export const audioEngine = new AudioEngine();
