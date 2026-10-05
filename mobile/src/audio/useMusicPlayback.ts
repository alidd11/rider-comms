import * as React from 'react';
import { audioEngine } from './audioEngine';
import { mediaControls } from './mediaControlsNative';

const POLL_MS = 3_000;

/**
 * Whether the rider's music app is playing, checked every few seconds while
 * `active`, and fed to the audio engine so the ride's audio levels are
 * accurate. null when this build can't tell.
 */
export function useMusicPlayback(active: boolean): { playing: boolean | null; refresh: () => void } {
  const [playing, setPlaying] = React.useState<boolean | null>(null);

  const refresh = React.useCallback(() => {
    const next = mediaControls.isMusicPlaying();
    setPlaying(next);
    audioEngine.setMusicPlaying(next === true);
  }, []);

  React.useEffect(() => {
    if (!active || !mediaControls.capabilities.playbackState) return;
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      clearInterval(timer);
      audioEngine.setMusicPlaying(false);
    };
  }, [active, refresh]);

  return { playing, refresh };
}
