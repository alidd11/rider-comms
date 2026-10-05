/**
 * Music controls for whatever app the rider is listening to (Spotify,
 * YouTube Music, a podcast app), backed by the local RiderMediaControls
 * native module (mobile/modules/rider-media-controls).
 *
 * - Android: play/pause, next and previous reach the app that's playing
 *   the same way a headset's media buttons do, and playback state is known.
 * - iOS: Apple offers no way for one app to control another's playback, so
 *   only playback state is known. Riders use their helmet or headset buttons.
 *
 * Pure logic, so it runs under node:test; mediaControlsNative.ts supplies the
 * native module.
 */
export type MediaKey = 'playPause' | 'next' | 'previous';

export interface MediaControlsNative {
  isOtherAudioPlaying(): boolean;
  sendMediaKey(key: MediaKey): boolean;
}

export interface MediaControlCapabilities {
  /** Play/pause, next and previous can be sent. */
  buttons: boolean;
  /** Whether other audio is playing can be read. */
  playbackState: boolean;
}

export class MediaControls {
  private readonly native: MediaControlsNative | null;
  private readonly canSendKeys: boolean;

  constructor(native: MediaControlsNative | null, canSendKeys: boolean) {
    this.native = native;
    this.canSendKeys = canSendKeys;
  }

  get capabilities(): MediaControlCapabilities {
    return { buttons: this.native !== null && this.canSendKeys, playbackState: this.native !== null };
  }

  /** null when the build has no native module, rather than guessing. */
  isMusicPlaying(): boolean | null {
    if (!this.native) return null;
    try {
      return this.native.isOtherAudioPlaying();
    } catch {
      return null;
    }
  }

  /** False when unsupported or refused, so the UI never shows a dead button. */
  send(key: MediaKey): boolean {
    if (!this.capabilities.buttons) return false;
    try {
      return this.native!.sendMediaKey(key);
    } catch {
      return false;
    }
  }
}
