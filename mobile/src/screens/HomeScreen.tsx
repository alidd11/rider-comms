// Unverified scaffold — see navigation/index.tsx header note.
import * as React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { colors, spacing, radii, type, MIN_TOUCH_TARGET } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

function HomeAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable style={({ pressed }) => [styles.action, pressed && styles.actionPressed]} onPress={onPress}>
      <Ionicons name={icon} size={26} color={colors.accentText} style={styles.actionIcon} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

export function HomeScreen({ navigation }: Props): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <View style={styles.logoBadge}>
          <Ionicons name="headset" size={40} color={colors.accent} />
        </View>
        <Text style={styles.title}>Rider Comms</Text>
        <Text style={styles.subtitle}>Hands-free voice + navigation for riders</Text>
      </View>

      <View style={styles.actions}>
        <HomeAction icon="radio" label="Public" onPress={() => navigation.navigate('PublicZone')} />
        <HomeAction icon="people" label="Group Ride" onPress={() => navigation.navigate('JoinRide')} />

        <Pressable onPress={() => navigation.navigate('CreateRide')} style={styles.createLink}>
          <Text style={styles.createLinkText}>Starting a new group ride? Create one</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, justifyContent: 'space-between' },
  hero: { alignItems: 'center', marginTop: spacing.xxl },
  logoBadge: {
    width: 84,
    height: 84,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { ...type.title, marginBottom: spacing.xs },
  subtitle: { ...type.body, textAlign: 'center', paddingHorizontal: spacing.lg },
  actions: { gap: spacing.md, marginBottom: spacing.lg },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
  },
  actionPressed: { backgroundColor: colors.accentPressed },
  actionIcon: { marginRight: spacing.md },
  actionText: { ...type.button, color: colors.accentText },
  createLink: { alignItems: 'center', paddingVertical: spacing.sm },
  createLinkText: { ...type.caption, color: colors.textSecondary },
});
