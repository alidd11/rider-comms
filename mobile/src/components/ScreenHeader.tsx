import * as React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, spacing, type } from '../theme';

type ScreenHeaderProps = {
  title: string;
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Shared hierarchy for every non-map root screen. */
export function ScreenHeader({ title, action, style }: ScreenHeaderProps): React.JSX.Element {
  return (
    <View style={[styles.header, style]}>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.title}>{title}</Text>
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
  action: { paddingTop: spacing.xs },
});
