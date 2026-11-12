import * as React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, MIN_TOUCH_TARGET, spacing, type, pressedFeedback } from '../theme';

type ScreenHeaderProps = {
  title: string;
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Shows a back chevron before the title (screens pushed on the stack). */
  onBack?: () => void;
  /** What the back chevron says to screen readers. */
  backLabel?: string;
};

/** Shared hierarchy for every non-map root screen. */
export function ScreenHeader({ title, action, style, onBack, backLabel = 'Go back' }: ScreenHeaderProps): React.JSX.Element {
  return (
    <View style={[styles.header, style]}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} hitSlop={8} style={({ pressed }) => [styles.back, pressed && pressedFeedback]}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
      ) : null}
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.title} accessibilityRole="header">{title}</Text>
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: 13,
  },
  copy: { flex: 1, minWidth: 0 },
  title: { ...type.title, fontSize: 28, lineHeight: 31, letterSpacing: -0.9 },
  action: { paddingTop: 0 },
  back: { width: MIN_TOUCH_TARGET - 8, height: 31, marginLeft: -spacing.sm, alignItems: 'center', justifyContent: 'center' },
});
