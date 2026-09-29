import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, MIN_TOUCH_TARGET, radii, spacing, type } from '../theme';
import { reportClientError } from './errorReporting';

interface State {
  failed: boolean;
}

/**
 * Catches render errors anywhere below it, reports them, and shows a calm
 * recovery screen instead of a blank app. "Try again" remounts the tree.
 */
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    reportClientError({ error, fatal: true, context: 'render' });
  }

  private retry = (): void => {
    this.setState({ failed: false });
  };

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.container} accessibilityRole="alert">
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          Rider Comms hit an unexpected problem and has reported it. If you're riding, pull over somewhere safe before trying again.
        </Text>
        <Pressable accessibilityRole="button" onPress={this.retry} style={styles.button}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md, backgroundColor: colors.background },
  title: { ...type.heading, color: colors.textPrimary, textAlign: 'center' },
  body: { ...type.body, color: colors.textSecondary, textAlign: 'center' },
  button: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.accent },
  buttonText: { ...type.subheading, color: colors.accentText },
});
