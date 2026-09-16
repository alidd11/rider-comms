import * as React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ZoneTier } from '@rider-comms/shared';
import { colors, MIN_TOUCH_TARGET, radii, spacing, type } from '../theme';
import { useSettings } from '../settings/SettingsContext';
import { PLAN_INFO, PLAN_ORDER, isPaidTier } from '../settings/plans';

function PlanRow({ tier, current, onReturnToFree }: { tier: ZoneTier; current: boolean; onReturnToFree?: () => void }) {
  const plan = PLAN_INFO[tier];
  return (
    <View style={[styles.planRow, current && styles.planRowCurrent]}>
      <View style={styles.planHeading}>
        <View style={styles.planCopy}>
          <Text style={styles.planName}>{plan.name}</Text>
          <Text style={styles.planPrice}>{plan.priceLabel}{plan.priceLabel !== 'Free' ? '/month' : ''}</Text>
        </View>
        <View style={[styles.statusBadge, current && styles.statusBadgeCurrent]}>
          <Text style={[styles.statusText, current && styles.statusTextCurrent]}>{current ? 'Current' : 'Unavailable'}</Text>
        </View>
      </View>
      <Text style={styles.planBlurb}>{plan.blurb}</Text>
      <View style={styles.featureList}>
        {plan.features.map((feature) => (
          <View key={feature} style={styles.featureRow}>
            <Ionicons name="checkmark" size={17} color={colors.success} />
            <Text style={styles.featureText}>{feature}</Text>
          </View>
        ))}
      </View>
      {onReturnToFree ? (
        <Pressable accessibilityRole="button" onPress={onReturnToFree} style={styles.returnButton}>
          <Text style={styles.returnButtonText}>Return to Free</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function BillingScreen({ navigation }: { navigation: { goBack: () => void } }): React.JSX.Element {
  const { zoneTier, setZoneTier } = useSettings();
  const insets = useSafeAreaInsets();

  function confirmReturnToFree() {
    Alert.alert(
      'Return to Free?',
      `Your nearby radius will change from ${PLAN_INFO[zoneTier].name} to the Free plan.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Return to Free', style: 'destructive', onPress: () => setZoneTier('free') },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={navigation.goBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Plan and billing</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>Your plan controls the mutual nearby-rider radius. Private Group Rides remain available on every plan.</Text>

        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={21} color={colors.textSecondary} />
          <Text style={styles.noticeText}>Paid plans are shown for transparency but cannot be purchased until verified App Store and Google Play billing is connected. Rider Comms does not collect card details.</Text>
        </View>

        <Text style={styles.sectionLabel}>Plans</Text>
        <View style={styles.planList}>
          {PLAN_ORDER.map((tier) => (
            <PlanRow
              key={tier}
              tier={tier}
              current={tier === zoneTier}
              onReturnToFree={tier === zoneTier && isPaidTier(tier) ? confirmReturnToFree : undefined}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backButton: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...type.subheading, flex: 1, textAlign: 'center' },
  headerSpacer: { width: MIN_TOUCH_TARGET },
  scroll: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: spacing.lg },
  intro: { ...type.body, color: colors.textSecondary, marginBottom: spacing.lg },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceRaised,
  },
  noticeText: { ...type.caption, color: colors.textSecondary, flex: 1, fontSize: 13, lineHeight: 19 },
  sectionLabel: { ...type.label, marginTop: spacing.xl, marginBottom: spacing.sm },
  planList: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.lg },
  planRow: { padding: spacing.md, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  planRowCurrent: { borderLeftWidth: 3, borderLeftColor: colors.accent },
  planHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  planCopy: { flex: 1 },
  planName: { ...type.subheading },
  planPrice: { ...type.caption, color: colors.textSecondary, marginTop: 2 },
  statusBadge: { minHeight: 28, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised },
  statusBadgeCurrent: { backgroundColor: colors.accentSoft },
  statusText: { ...type.caption, color: colors.textMuted },
  statusTextCurrent: { color: colors.accent, fontWeight: '800' },
  planBlurb: { ...type.body, color: colors.textSecondary, marginTop: spacing.md },
  featureList: { gap: spacing.xs, marginTop: spacing.md },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  featureText: { ...type.caption, color: colors.textSecondary, flex: 1 },
  returnButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  returnButtonText: { ...type.button, color: colors.danger },
});
