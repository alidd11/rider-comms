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

export type NowPlayingAccess = 'granted' | 'denied' | 'undetermined';

export interface NowPlaying {
  title: string;
  artist: string;
  playing: boolean;
  /** 'apple-music' on iOS; the playing app's package name on Android. */
  source: string;
  appName: string;
  artworkUri?: string;
}

export interface MediaControlsNative {
  isOtherAudioPlaying(): boolean;
  sendMediaKey(key: MediaKey): boolean;
  // Added later; older builds of the module don't have them.
  nowPlayingAccess?(): NowPlayingAccess;
  requestNowPlayingAccess?(): Promise<NowPlayingAccess>;
  getNowPlaying?(): Promise<NowPlaying | null>;
  controlNowPlaying?(key: MediaKey): Promise<boolean>;
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

  /** Whether the build can show what's playing at all. */
  get canShowNowPlaying(): boolean {
    return typeof this.native?.getNowPlaying === 'function';
  }

  nowPlayingAccess(): NowPlayingAccess {
    try {
      return this.native?.nowPlayingAccess?.() ?? 'denied';
    } catch {
      return 'denied';
    }
  }

  async requestNowPlayingAccess(): Promise<NowPlayingAccess> {
    try {
      return (await this.native?.requestNowPlayingAccess?.()) ?? 'denied';
    } catch {
      return 'denied';
    }
  }

  /** The track the rider is listening to, or null when it can't be read. */
  async nowPlaying(): Promise<NowPlaying | null> {
    try {
      const value = await this.native?.getNowPlaying?.();
      if (!value || typeof value.title !== 'string' || !value.title.trim()) return null;
      return {
        title: value.title.trim(),
        artist: typeof value.artist === 'string' ? value.artist.trim() : '',
        playing: value.playing === true,
        source: typeof value.source === 'string' ? value.source : '',
        appName: typeof value.appName === 'string' ? value.appName : '',
        artworkUri: typeof value.artworkUri === 'string' && value.artworkUri.startsWith('data:image/') ? value.artworkUri : undefined,
      };
    } catch {
      return null;
    }
  }

  /** Play/pause or skip the track shown on the card. */
  async control(key: MediaKey): Promise<boolean> {
    try {
      if (typeof this.native?.controlNowPlaying === 'function') return await this.native.controlNowPlaying(key);
    } catch {
      return false;
    }
    return this.send(key);
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
