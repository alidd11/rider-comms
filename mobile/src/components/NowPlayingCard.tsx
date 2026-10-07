import * as React from 'react';
import { AppState, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { mediaControls } from '../audio/mediaControlsNative';
import type { MediaKey, NowPlaying, NowPlayingAccess } from '../audio/mediaControls';
import { colors, elevation, MIN_TOUCH_TARGET, spacing, type } from '../theme';

const POLL_MS = 3000;

function sameTrack(a: NowPlaying | null, b: NowPlaying | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.title === b.title && a.artist === b.artist && a.playing === b.playing
    && a.source === b.source && a.appName === b.appName && a.artworkUri === b.artworkUri;
}

/**
 * What's playing, polled while the map is on screen and the app is in the
 * foreground. Null when nothing is playing, the rider hasn't allowed it, or
 * the build has no support.
 */
export function useNowPlaying(enabled: boolean): {
  nowPlaying: NowPlaying | null;
  access: NowPlayingAccess;
  refresh: () => void;
} {
  const [nowPlaying, setNowPlaying] = React.useState<NowPlaying | null>(null);
  const [access, setAccess] = React.useState<NowPlayingAccess>(() => mediaControls.nowPlayingAccess());
  const [appActive, setAppActive] = React.useState(AppState.currentState === 'active');
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
      // Android grants access in system settings; pick it up on return.
      if (state === 'active') setAccess(mediaControls.nowPlayingAccess());
    });
    return () => subscription.remove();
  }, []);

  React.useEffect(() => {
    if (!enabled || !appActive || access !== 'granted' || !mediaControls.canShowNowPlaying) {
      setNowPlaying(null);
      return undefined;
    }
    let cancelled = false;
    const read = () => {
      // Keep the same object while nothing changed, so the card (and its
      // artwork image) doesn't re-render on every poll.
      void mediaControls.nowPlaying().then((value) => {
        if (!cancelled) setNowPlaying((current) => (sameTrack(current, value) ? current : value));
      });
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, appActive, access, version]);

  const refresh = React.useCallback(() => {
    setAccess(mediaControls.nowPlayingAccess());
    setVersion((value) => value + 1);
  }, []);

  return { nowPlaying, access, refresh };
}

/**
 * Waze-style music card on the map. While Ride Safe has the controls locked
 * it shows only the track, so there's nothing to tap; helmet or headset
 * buttons still work.
 */
export function NowPlayingCard({
  nowPlaying,
  controlsLocked,
  onChanged,
  style,
}: {
  nowPlaying: NowPlaying;
  controlsLocked: boolean;
  onChanged: () => void;
  style?: React.ComponentProps<typeof View>['style'];
}): React.JSX.Element {
  const press = (key: MediaKey) => {
    void mediaControls.control(key).then((sent) => { if (sent) setTimeout(onChanged, 500); });
  };
  const controls: Array<{ key: MediaKey; icon: keyof typeof Ionicons.glyphMap; label: string }> = [
    { key: 'previous', icon: 'play-skip-back', label: 'Previous track' },
    { key: 'playPause', icon: nowPlaying.playing ? 'pause' : 'play', label: nowPlaying.playing ? 'Pause music' : 'Play music' },
    { key: 'next', icon: 'play-skip-forward', label: 'Next track' },
  ];
  const subtitle = [nowPlaying.artist, nowPlaying.appName].filter(Boolean).join(' · ');
  return (
    <View
      style={[styles.card, style]}
      accessibilityLabel={`Now playing: ${nowPlaying.title}${nowPlaying.artist ? ` by ${nowPlaying.artist}` : ''}`}
    >
      {nowPlaying.artworkUri ? (
        <Image source={{ uri: nowPlaying.artworkUri }} style={styles.artwork} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.artwork, styles.artworkPlaceholder]}>
          <Ionicons name="musical-notes" size={20} color={colors.textSecondary} />
        </View>
      )}
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.title}>{nowPlaying.title}</Text>
        {subtitle ? <Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {!controlsLocked && controls.map(({ key, icon, label }) => (
        <Pressable
          key={key}
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={() => press(key)}
          hitSlop={4}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Ionicons name={icon} size={key === 'playPause' ? 24 : 20} color={colors.textPrimary} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 60,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...elevation.raised,
  },
  artwork: { width: 44, height: 44, borderRadius: 8 },
  artworkPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  copy: { flex: 1, minWidth: 0 },
  title: { ...type.subheading, fontSize: 15, lineHeight: 19 },
  subtitle: { ...type.caption },
  button: {
    width: 40,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  buttonPressed: { backgroundColor: colors.surfaceRaised },
});
