import * as React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, spacing, type } from '../theme';

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Shared hierarchy for every non-map root screen. */
export function ScreenHeader({ title, subtitle, action, style }: ScreenHeaderProps): React.JSX.Element {
  return (
    <View style={[styles.header, style]}>
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
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
    marginBottom: spacing.md,
  },
  copy: { flex: 1, minWidth: 0 },
  title: { ...type.title, fontSize: 30, lineHeight: 35 },
  subtitle: {
    ...type.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    maxWidth: 420,
  },
  action: { paddingTop: spacing.xs },
});
