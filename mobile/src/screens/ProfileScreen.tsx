// Unverified scaffold — see navigation/index.tsx header note.
//
// TODO: no account system exists yet (see spec — auth is out of scope for
// this prototype). This is a placeholder for where profile/settings will
// live once one does, not a finished feature.
import * as React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radii, type } from '../theme';
import { RideBar } from '../ride/RideBar';

export function ProfileScreen(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={32} color={colors.textSecondary} />
        </View>
        <Text style={styles.name}>Signed in as: me</Text>
        <Text style={styles.caption}>Accounts aren't built yet — this is a placeholder for settings later.</Text>
      </View>
      <RideBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, justifyContent: 'space-between' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  name: { ...type.heading },
  caption: { ...type.caption, textAlign: 'center', paddingHorizontal: spacing.lg },
});
