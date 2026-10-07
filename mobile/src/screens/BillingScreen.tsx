import * as React from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, MIN_TOUCH_TARGET, radii, spacing, type } from '../theme';
import { useSettings } from '../settings/SettingsContext';
import { isPaidTier, planOptions, renewalLabel, type PlanOption } from '../settings/plans';
import { useBilling } from '../billing/BillingContext';
import { LEGAL_LINKS } from '../legalLinks';
import { useMovementSafety } from '../safety/MovementSafetyContext';
import { RideSafeSurface } from '../safety/RideSafeSurface';

const ACTION_LABEL: Record<PlanOption['action'], string> = {
  current: 'Current plan',
  subscribe: 'Subscribe',
  upgrade: 'Upgrade',
  downgrade: 'Switch plan',
  manage: 'Cancel in subscription settings',
};

function PlanCard({
  option,
  renewal,
  disabled,
  busy,
  onChoose,
}: {
  option: PlanOption;
  renewal: string | null;
  disabled: boolean;
  busy: boolean;
  onChoose: () => void;
}) {
  const current = option.action === 'current';
  const label = `${option.info.name}, ${option.priceLabel}${current ? ', current plan' : ''}`;
  return (
    <View style={[styles.planCard, current && styles.planCardCurrent]} accessibilityLabel={label}>
      <View style={styles.planHeading}>
        <View style={styles.planCopy}>
          <Text style={styles.planName}>{option.info.name}</Text>
          <Text style={styles.planPrice}>{option.priceLabel}</Text>
        </View>
        {current ? (
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>Current</Text>
          </View>
        ) : null}
      </View>
      {current && renewal ? <Text style={styles.renewal}>{renewal}</Text> : null}
      <Text style={styles.planBlurb}>{option.info.blurb}</Text>
      <View style={styles.featureList}>
        {option.info.features.map((feature) => (
          <View key={feature} style={styles.featureRow}>
            <Ionicons name="checkmark" size={17} color={colors.success} />
            <Text style={styles.featureText}>{feature}</Text>
          </View>
        ))}
      </View>
      {current ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={option.action === 'manage' ? 'Return to Free: cancel in subscription settings' : `${ACTION_LABEL[option.action]} to ${option.info.name}, ${option.priceLabel}`}
          accessibilityState={{ disabled, busy }}
          disabled={disabled}
          onPress={onChoose}
          style={({ pressed }) => [
            option.action === 'manage' ? styles.secondaryButton : styles.primaryButton,
            disabled && styles.buttonDisabled,
            pressed && !disabled && styles.buttonPressed,
          ]}
        >
          {busy ? <ActivityIndicator color={colors.accentInk} /> : (
            <Text style={option.action === 'manage' ? styles.secondaryButtonText : styles.primaryButtonText}>{ACTION_LABEL[option.action]}</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

type BillingProps = { navigation: { goBack: () => void } };

export function BillingScreen(props: BillingProps): React.JSX.Element {
  const { lockedForSafety } = useMovementSafety();
  return lockedForSafety ? <RideSafeSurface /> : <BillingScreenContent {...props} />;
}

function BillingScreenContent({ navigation }: BillingProps): React.JSX.Element {
  const { zoneTier } = useSettings();
  const billing = useBilling();
  const insets = useSafeAreaInsets();
  const [choosing, setChoosing] = React.useState<string | null>(null);
  // The server's answer is the truth; the profile copy covers the moment
  // before it arrives.
  const tier = billing.status?.tier ?? zoneTier;
  const options = planOptions(tier, billing.prices);
  const renewal = billing.status ? renewalLabel(billing.status) : null;
  const storeName = Platform.OS === 'android' ? 'Google Play' : 'App Store';
  const accountName = Platform.OS === 'android' ? 'Google Play account' : 'Apple Account';
  const unavailable = !billing.storeAvailable;
  React.useEffect(() => { if (billing.busy === null) setChoosing(null); }, [billing.busy]);

  const choose = (option: PlanOption) => {
    if (option.action === 'manage') {
      void billing.manage();
      return;
    }
    if (!isPaidTier(option.tier)) return;
    setChoosing(option.tier);
    void billing.subscribe(option.tier);
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={navigation.goBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">Your plan</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>Your plan sets how far away other riders can be and still appear in Nearby. Private group rides work at any distance, on every plan.</Text>

        {billing.message ? (
          <Pressable accessibilityRole="alert" accessibilityHint="Dismisses the message" onPress={billing.clearMessage} style={styles.message}>
            <Ionicons name="information-circle-outline" size={20} color={colors.textPrimary} />
            <Text style={styles.messageText}>{billing.message}</Text>
          </Pressable>
        ) : null}
        {unavailable ? (
          <Text style={styles.unavailable}>Subscriptions can’t be bought right now. Check your connection, or try again later.</Text>
        ) : null}

        <View style={styles.plans}>
          {options.map((option) => (
            <PlanCard
              key={option.tier}
              option={option}
              renewal={renewal}
              disabled={billing.busy !== null || (option.action !== 'manage' && unavailable)}
              busy={billing.busy === 'purchase' && choosing === option.tier}
              onChoose={() => choose(option)}
            />
          ))}
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: billing.busy !== null, busy: billing.busy === 'restore' }}
            disabled={billing.busy !== null}
            onPress={() => void billing.restore()}
            style={({ pressed }) => [styles.linkButton, pressed && styles.buttonPressed]}
          >
            {billing.busy === 'restore' ? <ActivityIndicator color={colors.textPrimary} /> : <Text style={styles.linkButtonText}>Restore purchases</Text>}
          </Pressable>
          {isPaidTier(tier) ? (
            <Pressable accessibilityRole="button" onPress={() => void billing.manage()} style={({ pressed }) => [styles.linkButton, pressed && styles.buttonPressed]}>
              <Text style={styles.linkButtonText}>Manage subscription</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.terms}>
          Premium and Premium+ are monthly subscriptions. Payment is charged to your {accountName} when you confirm the purchase. A subscription renews automatically at the same price each month unless it’s cancelled at least 24 hours before the end of the current period, and your account is charged for the renewal within 24 hours before that. You can manage or cancel it any time in your {storeName} account settings; cancelling keeps your plan until the end of the period you’ve paid for. Deleting your Rider Comms account doesn’t cancel a subscription.
        </Text>
        <View style={styles.legalLinks}>
          <Text accessibilityRole="link" style={styles.legalLink} onPress={() => void Linking.openURL(LEGAL_LINKS.terms)}>Terms of Use</Text>
          <Text style={styles.legalDot}>·</Text>
          <Text accessibilityRole="link" style={styles.legalLink} onPress={() => void Linking.openURL(LEGAL_LINKS.privacy)}>Privacy Policy</Text>
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
  message: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    padding: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceRaised,
  },
  messageText: { ...type.body, flex: 1 },
  unavailable: { ...type.caption, color: colors.warning, marginBottom: spacing.md },
  plans: { gap: spacing.md },
  planCard: {
    padding: spacing.md,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  planCardCurrent: { borderWidth: 2, borderColor: colors.accent },
  planHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  planCopy: { flex: 1 },
  planName: { ...type.subheading },
  planPrice: { ...type.body, color: colors.textSecondary, marginTop: 2 },
  statusBadge: { minHeight: 28, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.accentSoft },
  statusText: { ...type.caption, color: colors.accentText, fontWeight: '800' },
  renewal: { ...type.caption, color: colors.textSecondary, marginTop: spacing.xs },
  planBlurb: { ...type.body, color: colors.textSecondary, marginTop: spacing.md },
  featureList: { gap: spacing.xs, marginTop: spacing.md },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  featureText: { ...type.caption, color: colors.textSecondary, flex: 1 },
  primaryButton: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  primaryButtonText: { ...type.button, color: colors.accentInk },
  secondaryButton: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  secondaryButtonText: { ...type.button, color: colors.textSecondary },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.75 },
  actions: { marginTop: spacing.lg, gap: spacing.xs },
  linkButton: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  linkButtonText: { ...type.button, color: colors.textPrimary },
  terms: { ...type.caption, color: colors.textMuted, marginTop: spacing.lg },
  legalLinks: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.md },
  legalLink: { ...type.caption, color: colors.textPrimary, textDecorationLine: 'underline', paddingVertical: spacing.sm },
  legalDot: { ...type.caption, color: colors.textMuted, paddingVertical: spacing.sm },
});
