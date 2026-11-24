import * as React from 'react';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import { AuthSplash } from '../auth/AuthContext';

/** The longest the cover stays, so a slow map or GPS never holds the rider on it. */
export const LAUNCH_COVER_MAX_MS = 3500;
/** With no location yet, how long after the map draws before showing it anyway. */
export const LAUNCH_COVER_NO_FIX_MS = 1500;

let shownThisLaunch = false;

/** Tests only: behave as if the app had just started. */
export function resetLaunchCoverForTests(): void {
  shownThisLaunch = false;
}

/**
 * Keeps the start-up splash over the map, once per app launch, until the
 * map has drawn at the rider's own position rather than the default view of
 * London. It goes after `ready`, or `LAUNCH_COVER_NO_FIX_MS` after the map
 * draws without a fix, or after `LAUNCH_COVER_MAX_MS` at most.
 */
export function LaunchCover({ mapReady, hasFix }: { mapReady: boolean; hasFix: boolean }): React.JSX.Element | null {
  const [visible, setVisible] = React.useState(() => !shownThisLaunch);
  const opacity = React.useRef(new Animated.Value(1)).current;
  const leaving = React.useRef(false);

  const leave = React.useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => true).then((reduce) => {
      if (reduce) return setVisible(false);
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setVisible(false));
    });
  }, [opacity]);

  React.useEffect(() => {
    shownThisLaunch = true;
    if (!visible) return;
    const timer = setTimeout(leave, LAUNCH_COVER_MAX_MS);
    return () => clearTimeout(timer);
    // Only on mount: the cover is a one-off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!visible || !mapReady) return;
    // Give the camera a moment to move to the rider before revealing it.
    const timer = setTimeout(leave, hasFix ? 300 : LAUNCH_COVER_NO_FIX_MS);
    return () => clearTimeout(timer);
  }, [hasFix, leave, mapReady, visible]);

  if (!visible) return null;
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.cover, { opacity }]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="launch-cover"
    >
      <AuthSplash />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cover: { zIndex: 1000, elevation: 1000 },
});
