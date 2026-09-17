/**
 * Media Playback Control, Tier 1 (spec Section 7): OS-level media session
 * control — MPRemoteCommandCenter/MPNowPlayingInfoCenter on iOS,
 * MediaSession/MediaController on Android — for whatever music app the
 * rider currently has open (Spotify, Apple Music, anything).
 *
 * TODO(native): this needs an actual native module or a library like
 * `react-native-track-player` / `react-native-music-control` to talk to
 * the OS media session APIs — pure JS/TypeScript can't reach those, and
 * this sandbox has no npm registry access to install such a library or a
 * device to test it on. This file defines the interface the rest of the
 * app (and AudioEngine's `setMusicPlaying`) should call against. Unsupported
 * controls report false through capabilities/return values and must be
 * disabled in UI; they never throw merely because a binding is absent.
 */

export interface NowPlayingInfo {
  title: string;
  artist: string;
  artworkUrl?: string;
}

export interface NowPlayingListener {
  onNowPlayingChanged: (info: NowPlayingInfo | null) => void;
  onPlaybackStateChanged: (isPlaying: boolean) => void;
}

export interface MediaSessionBinding {
  play?: () => void;
  pause?: () => void;
  skipNext?: () => void;
}

export interface MediaControlCapabilities {
  play: boolean;
  pause: boolean;
  skipNext: boolean;
}

export class NowPlayingBridge {
  private listeners = new Set<NowPlayingListener>();
  private readonly binding: MediaSessionBinding | null;

  constructor(binding: MediaSessionBinding | null = null) {
    this.binding = binding;
  }

  subscribe(listener: NowPlayingListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get capabilities(): MediaControlCapabilities {
    return {
      play: typeof this.binding?.play === 'function',
      pause: typeof this.binding?.pause === 'function',
      skipNext: typeof this.binding?.skipNext === 'function',
    };
  }

  // Unsupported commands return false so the UI can disable them instead of
  // exposing a control that throws at runtime.
  play(): boolean {
    if (!this.binding?.play) return false;
    this.binding.play();
    return true;
  }

  pause(): boolean {
    if (!this.binding?.pause) return false;
    this.binding.pause();
    return true;
  }

  skipNext(): boolean {
    if (!this.binding?.skipNext) return false;
    this.binding.skipNext();
    return true;
  }
}
