import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNetworkState } from 'expo-network';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, elevation, radii, spacing, type } from '../theme';

export const OFFLINE_MESSAGE = 'No connection. Rider Comms will catch up when you’re back in signal.';

/**
 * Riders lose signal on the road. While the phone reports no connection,
 * say so, so a map or chat that has stopped updating has an explanation.
 * Mounted once above every screen; it never takes touches.
 */
export function ConnectionBanner(): React.JSX.Element | null {
  const network = useNetworkState();
  const insets = useSafeAreaInsets();
  // Unknown (undefined/null) counts as online: only an explicit "no" shows it.
  const offline = network.isConnected === false || network.isInternetReachable === false;
  if (!offline) return null;
  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { top: insets.top + spacing.sm }]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={OFFLINE_MESSAGE}
      testID="connection-banner"
    >
      <View style={[styles.pill, elevation.raised]}>
        <Text style={styles.text}>{OFFLINE_MESSAGE}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
    zIndex: 100,
  },
  pill: {
    maxWidth: 460,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  text: { ...type.caption, color: colors.textPrimary, textAlign: 'center' },
});
