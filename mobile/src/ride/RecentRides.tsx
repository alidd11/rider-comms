import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { rideHistoryLine } from '@rider-comms/shared';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../settings/SettingsContext';
import { colors, radii, spacing, type } from '../theme';
import { useRideHistory } from './rideHistory';

/** The rider's last few finished rides, kept on this device (PWA:
 * #recentRides on the Ride screen). Nothing shows until there's one. */
export function RecentRides(): React.JSX.Element | null {
  const { riderId } = useAuth();
  const { unitSystem } = useSettings();
  const history = useRideHistory(riderId);
  if (history.length === 0) return null;
  const now = Date.now();
  return (
    <View style={styles.card} testID="recent-rides">
      <Text style={styles.title} accessibilityRole="header">Recent rides</Text>
      {history.map((entry) => (
        <Text key={entry.endedAt} style={styles.row}>
          {rideHistoryLine(entry, unitSystem === 'km' ? 'km' : 'mi', now)}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface },
  title: { ...type.subheading, color: colors.textPrimary, fontSize: 18, lineHeight: 22, fontWeight: '800' },
  row: { ...type.body, color: colors.textSecondary, fontSize: 14, lineHeight: 19 },
});
