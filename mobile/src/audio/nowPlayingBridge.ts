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
 * app (and AudioEngine's `setMusicPlaying`) should call against, so
 * dropping in a real binding later doesn't require touching call sites.
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

export class NowPlayingBridge {
  private listeners = new Set<NowPlayingListener>();

  subscribe(listener: NowPlayingListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // TODO(native): wire to MPRemoteCommandCenter.shared.playCommand / Android MediaController.play()
  play(): void {
    throw new Error('NowPlayingBridge.play() requires a native media-session binding (not available in this sandbox)');
  }

  // TODO(native): wire to the equivalent pause command
  pause(): void {
    throw new Error('NowPlayingBridge.pause() requires a native media-session binding (not available in this sandbox)');
  }

  // TODO(native): wire to the equivalent next-track command
  skipNext(): void {
    throw new Error('NowPlayingBridge.skipNext() requires a native media-session binding (not available in this sandbox)');
  }
}
