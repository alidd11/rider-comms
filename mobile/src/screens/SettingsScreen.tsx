// Unverified scaffold — see navigation/index.tsx header note.
import * as React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { TIER_RADIUS_MILES } from '@rider-comms/shared';
import type { ZoneTier } from '@rider-comms/shared';
import { colors, spacing, radii, type } from '../theme';
import { useSettings } from '../settings/SettingsContext';
import { RideBar } from '../ride/RideBar';

const TIER_LABELS: Record<ZoneTier, { name: string; blurb: string }> = {
  free: { name: 'Free', blurb: 'The default — good for a stoplight-to-stoplight ride.' },
  premium: { name: 'Premium', blurb: 'Wider net for group rides that spread out on the highway.' },
  premium_plus: { name: 'Premium+', blurb: 'Widest range — for a convoy that has stretched way out.' },
};
const TIER_ORDER: ZoneTier[] = ['free', 'premium', 'premium_plus'];

function TierRow({ tier, selected, onSelect }: { tier: ZoneTier; selected: boolean; onSelect: () => void }): React.JSX.Element {
  const { name, blurb } = TIER_LABELS[tier];
  return (
    <Pressable
      style={({ pressed }) => [styles.tierRow, selected && styles.tierRowSelected, pressed && styles.tierRowPressed]}
      onPress={onSelect}
    >
      <View style={styles.tierRadio}>
        {selected && <View style={styles.tierRadioDot} />}
      </View>
      <View style={styles.tierInfo}>
        <View style={styles.tierNameRow}>
          <Text style={styles.tierName}>{name}</Text>
          <Text style={styles.tierRadius}>{TIER_RADIUS_MILES[tier]} mi</Text>
        </View>
        <Text style={styles.tierBlurb}>{blurb}</Text>
      </View>
    </Pressable>
  );
}

export function SettingsScreen(): React.JSX.Element {
  const { zoneTier, setZoneTier, loaded } = useSettings();
  const appVersion = Constants.expoConfig?.version ?? '0.1.0';

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.avatarSection}>
          <View style={styles.avatarRing}>
            <Ionicons name="person" size={32} color={colors.textSecondary} />
          </View>
          <Text style={styles.name}>Signed in as: me</Text>
          <Text style={styles.caption}>Accounts aren't built yet — riderId is hardcoded for this prototype.</Text>
        </View>

        <Text style={styles.sectionLabel}>Zone Radius</Text>
        <View style={styles.section}>
          {loaded &&
            TIER_ORDER.map((tier) => (
              <TierRow key={tier} tier={tier} selected={zoneTier === tier} onSelect={() => setZoneTier(tier)} />
            ))}
        </View>

        <Text style={styles.sectionLabel}>About</Text>
        <View style={styles.section}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Version</Text>
            <Text style={styles.aboutValue}>{appVersion}</Text>
          </View>
        </View>
      </ScrollView>

      <RideBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg },
  avatarSection: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xl },
  avatarRing: {
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
  sectionLabel: {
    ...type.caption,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  section: { backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden' },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tierRowSelected: { backgroundColor: colors.surfaceRaised },
  tierRowPressed: { opacity: 0.85 },
  tierRadio: {
    width: 22,
    height: 22,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  tierRadioDot: { width: 10, height: 10, borderRadius: radii.pill, backgroundColor: colors.accent },
  tierInfo: { flex: 1, gap: spacing.xs },
  tierNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  tierName: { ...type.body, color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  tierRadius: { ...type.caption, color: colors.accent, fontWeight: '700' },
  tierBlurb: { ...type.caption },
  aboutRow: { flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md },
  aboutLabel: { ...type.body, color: colors.textPrimary },
  aboutValue: { ...type.caption },
});
