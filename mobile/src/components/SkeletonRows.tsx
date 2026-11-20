// Placeholder rows shown while a list loads, in the shape of what's coming
// (avatar and two lines, or chat bubbles), as big apps do instead of a lone
// spinner. They pulse gently; with Reduce Motion on they stay still.
import * as React from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';
import { colors, spacing } from '../theme';

function usePulse(): Animated.Value {
  const opacity = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!active || reduce) return;
      loop = Animated.loop(Animated.sequence([
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]));
      loop.start();
    }).catch(() => {});
    return () => {
      active = false;
      loop?.stop();
    };
  }, [opacity]);
  return opacity;
}

/** List rows: an avatar and two lines of text. */
export function SkeletonRows({ count = 4, label }: { count?: number; label: string }): React.JSX.Element {
  const opacity = usePulse();
  return (
    <Animated.View style={{ opacity }} accessible accessibilityLabel={label} accessibilityLiveRegion="polite" testID="skeleton-rows">
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.row}>
          <View style={styles.avatar} />
          <View style={styles.lines}>
            <View style={[styles.line, { width: `${62 - (index % 3) * 9}%` }]} />
            <View style={[styles.line, styles.lineShort]} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

/** A conversation: bubbles on alternating sides. */
export function SkeletonBubbles({ label }: { label: string }): React.JSX.Element {
  const opacity = usePulse();
  const widths = ['58%', '42%', '66%', '36%'] as const;
  return (
    <Animated.View style={[styles.bubbles, { opacity }]} accessible accessibilityLabel={label} accessibilityLiveRegion="polite" testID="skeleton-bubbles">
      {widths.map((width, index) => (
        <View key={index} style={[styles.bubble, { width, alignSelf: index % 2 ? 'flex-end' : 'flex-start' }]} />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12, paddingHorizontal: spacing.md },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceRaised },
  lines: { flex: 1, gap: 8 },
  line: { height: 12, borderRadius: 6, backgroundColor: colors.surfaceRaised },
  lineShort: { width: '34%' },
  bubbles: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.lg, width: '100%' },
  bubble: { height: 38, borderRadius: 16, backgroundColor: colors.surfaceRaised },
});
