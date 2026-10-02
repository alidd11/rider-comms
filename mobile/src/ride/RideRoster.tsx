import * as React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { colors, elevation, radii, spacing, type } from '../theme';
import { useRide } from './RideContext';
import { useRideProfiles } from '../screens/useRideProfiles';
import { openRiderSafetyMenu } from '../safety/riderSafetyActions';

/** Ride members with report/block for each other rider, and remove for the host. */
export function RideRoster({ canRemove }: { canRemove: boolean }): React.JSX.Element {
  const { roster, removeRider } = useRide();
  const { client, riderId } = useAuth();
  const profiles = useRideProfiles(client, riderId, roster);
  const nameOf = (id: string) => id === riderId ? 'You' : profiles[id]?.displayName || 'Rider';

  const confirmRemove = (id: string) => Alert.alert(`Remove ${nameOf(id)}?`, 'They leave the ride and its voice channel straight away.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => {
      void removeRider(id).catch(() => Alert.alert('Couldn’t remove rider', 'Please try again when you have a connection.'));
    } },
  ]);

  return (
    <View style={[styles.rosterCard, elevation.raised]}>
      {roster.length <= 1 ? (
        <Text style={styles.emptyRoster}>No one else has joined yet. Share the code above.</Text>
      ) : (
        roster.map((id) => (
          <View key={id} style={styles.rosterRow}>
            <View style={styles.rosterAvatar}>
              <MaterialCommunityIcons name="motorbike" size={16} color={colors.textPrimary} />
            </View>
            <View style={styles.rosterNameColumn}>
              <Text style={styles.rosterName} numberOfLines={1}>{nameOf(id)}</Text>
              {id !== riderId && profiles[id]?.handle ? <Text style={styles.rosterHandle} numberOfLines={1}>{profiles[id].handle}</Text> : null}
            </View>
            {id !== riderId && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Report or block ${nameOf(id)}`}
                onPress={() => openRiderSafetyMenu(client, { riderId: id, name: nameOf(id), source: 'the ride roster' })}
                style={styles.removeButton}
                hitSlop={8}
              >
                <Ionicons name="ellipsis-horizontal-circle-outline" size={22} color={colors.textSecondary} />
              </Pressable>
            )}
            {canRemove && id !== riderId && (
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${nameOf(id)} from ride`} onPress={() => confirmRemove(id)} style={styles.removeButton} hitSlop={8}>
                <Ionicons name="close-circle" size={22} color={colors.danger} />
              </Pressable>
            )}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rosterCard: { backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden' },
  emptyRoster: { ...type.caption, padding: spacing.md, textAlign: 'center' },
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  rosterAvatar: { width: 32, height: 32, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  rosterNameColumn: { flex: 1, minWidth: 0 },
  rosterName: { ...type.body, color: colors.textPrimary },
  rosterHandle: { ...type.caption, color: colors.textMuted },
  removeButton: { padding: spacing.xs },
});
