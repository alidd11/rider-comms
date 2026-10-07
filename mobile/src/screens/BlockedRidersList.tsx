import * as React from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { BlockedRider, RiderCommsClient } from '../api/client';
import { colors, MIN_TOUCH_TARGET, spacing, type } from '../theme';

/** Settings → Communication → Blocked riders: review and undo blocks. */
export function BlockedRidersList({ client }: { client: Pick<RiderCommsClient, 'getBlockedRiders' | 'unblockRider'> }): React.JSX.Element {
  const [blocked, setBlocked] = React.useState<BlockedRider[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setError(null);
    client.getBlockedRiders()
      .then((response) => setBlocked(response.blocked))
      .catch(() => setError('Couldn’t load blocked riders. Check your connection and try again.'));
  }, [client]);

  React.useEffect(() => { load(); }, [load]);

  const confirmUnblock = (rider: BlockedRider) => Alert.alert(`Unblock ${rider.displayName}?`, 'They’ll be able to find you in Nearby and send you a friend request again. Your previous friendship isn’t restored.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Unblock', onPress: () => {
      void client.unblockRider(rider.riderId)
        .then(() => setBlocked((current) => current?.filter((entry) => entry.riderId !== rider.riderId) ?? null))
        .catch(() => Alert.alert('Couldn’t unblock', 'Please try again when you have a connection.'));
    } },
  ]);

  if (error) {
    return (
      <View style={styles.state}>
        <Text style={styles.stateText}>{error}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading blocked riders"
          accessibilityHint="Reloads your blocked riders"
          onPress={load}
          style={styles.retry}
        >
          <Text style={styles.action}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (!blocked) {
    return (
      <View style={styles.loader} accessibilityLabel="Loading blocked riders" accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (blocked.length === 0) {
    return <View style={styles.state}><Text style={styles.stateText}>You haven’t blocked anyone. Block a rider from their profile, a chat or the ride roster.</Text></View>;
  }
  return (
    <View>
      {blocked.map((rider, index) => (
        <View key={rider.riderId} style={[styles.row, index > 0 && styles.divider]}>
          <View style={styles.identity}>
            <Text style={styles.name} numberOfLines={1}>{rider.displayName}</Text>
            {rider.handle ? <Text style={styles.handle} numberOfLines={1}>{rider.handle}</Text> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Unblock ${rider.displayName}`} onPress={() => confirmUnblock(rider)} style={styles.retry}>
            <Text style={styles.action}>Unblock</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  loader: { marginVertical: spacing.lg },
  state: { paddingVertical: spacing.md, gap: spacing.sm },
  stateText: { ...type.body, color: colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  identity: { flex: 1, minWidth: 0 },
  name: { ...type.body, color: colors.textPrimary },
  handle: { ...type.caption, color: colors.textMuted },
  retry: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: spacing.sm },
  action: { ...type.body, color: colors.accentInk, fontWeight: '700' },
});
