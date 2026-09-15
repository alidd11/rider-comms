// Unverified scaffold — see navigation/index.tsx header note.
//
// TODO(payments): there's no real payment processor wired up anywhere in
// this app (no Stripe/App Store/Play Billing SDK reachable in this
// sandbox). The "payment method" below is a locally-stored, masked
// stand-in purely to make the upgrade/downgrade flow feel real — swapping
// in a real processor means replacing `savePaymentMethod`/`clearPaymentMethod`
// with real tokenization calls and never storing a full card number
// client-side at all, which this screen already doesn't do (only the
// masked brand + last 4 digits are kept).
import * as React from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Modal, Alert, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ZoneTier } from '@rider-comms/shared';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { useSettings } from '../settings/SettingsContext';
import { PLAN_INFO, PLAN_ORDER, isPaidTier } from '../settings/plans';

const PAYMENT_METHOD_CACHE_KEY = '@rider-comms/settings/paymentMethod';

interface PaymentMethod {
  brand: string;
  last4: string;
}

function detectBrand(cardNumber: string): string {
  if (cardNumber.startsWith('4')) return 'Visa';
  if (cardNumber.startsWith('5')) return 'Mastercard';
  if (cardNumber.startsWith('3')) return 'Amex';
  return 'Card';
}

function AddPaymentMethodModal({
  visible,
  onClose,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (method: PaymentMethod) => void;
}): React.JSX.Element {
  const [cardNumber, setCardNumber] = React.useState('');
  const [expiry, setExpiry] = React.useState('');
  const [cvc, setCvc] = React.useState('');
  const digitsOnly = cardNumber.replace(/\D/g, '');
  const canSubmit = digitsOnly.length >= 12 && expiry.trim().length >= 4 && cvc.trim().length >= 3;

  function handleSave() {
    onSave({ brand: detectBrand(digitsOnly), last4: digitsOnly.slice(-4) });
    setCardNumber('');
    setExpiry('');
    setCvc('');
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Add payment method</Text>
          <Text style={styles.modalSubtitle}>
            This is a demo form — no real card processor is connected. Only a masked brand and last 4 digits are
            ever stored, on this device.
          </Text>

          <TextInput
            style={styles.modalInput}
            placeholder="Card number"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            value={cardNumber}
            onChangeText={setCardNumber}
            maxLength={19}
          />
          <View style={styles.modalRow}>
            <TextInput
              style={[styles.modalInput, styles.modalRowInput]}
              placeholder="MM/YY"
              placeholderTextColor={colors.textMuted}
              value={expiry}
              onChangeText={setExpiry}
              maxLength={5}
            />
            <TextInput
              style={[styles.modalInput, styles.modalRowInput]}
              placeholder="CVC"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              secureTextEntry
              value={cvc}
              onChangeText={setCvc}
              maxLength={4}
            />
          </View>

          <Pressable
            style={[styles.modalDone, !canSubmit && styles.modalDoneDisabled]}
            onPress={handleSave}
            disabled={!canSubmit}
          >
            <Text style={styles.modalDoneText}>Save card</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PlanCard({
  tier,
  current,
  onChoose,
  onCancel,
}: {
  tier: ZoneTier;
  current: boolean;
  onChoose: () => void;
  onCancel?: () => void;
}): React.JSX.Element {
  const plan = PLAN_INFO[tier];
  return (
    <View style={[styles.planCard, current && styles.planCardCurrent, elevation.raised]}>
      <View style={styles.planHeaderRow}>
        <Text style={styles.planName}>{plan.name}</Text>
        <Text style={styles.planPrice}>{plan.priceLabel}{plan.priceLabel !== 'Free' ? '/mo' : ''}</Text>
      </View>
      <Text style={styles.planBillingNote}>{plan.billingNote}</Text>
      <Text style={styles.planBlurb}>{plan.blurb}</Text>
      <View style={styles.planFeatures}>
        {plan.features.map((feature) => (
          <View key={feature} style={styles.planFeatureRow}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            <Text style={styles.planFeatureText}>{feature}</Text>
          </View>
        ))}
      </View>
      {current ? (
        <View style={styles.currentPlanRow}>
          <View style={styles.planCurrentBadge}>
            <Text style={styles.planCurrentBadgeText}>Current plan</Text>
          </View>
          {onCancel && (
            <Pressable onPress={onCancel} hitSlop={8}>
              <Text style={styles.cancelSubscriptionText}>Cancel subscription</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <Pressable style={({ pressed }) => [styles.planChooseButton, pressed && styles.planChooseButtonPressed]} onPress={onChoose}>
          <Text style={styles.planChooseButtonText}>Choose {plan.name}</Text>
        </Pressable>
      )}
    </View>
  );
}

export function BillingScreen({ navigation }: { navigation: { goBack: () => void } }): React.JSX.Element {
  const { zoneTier, setZoneTier } = useSettings();
  const insets = useSafeAreaInsets();
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod | null>(null);
  const [addCardOpen, setAddCardOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    AsyncStorage.getItem(PAYMENT_METHOD_CACHE_KEY)
      .then((raw) => {
        if (raw) {
          try {
            setPaymentMethod(JSON.parse(raw));
          } catch {
            // Malformed cache — treat as no payment method on file.
          }
        }
      })
      .finally(() => setLoaded(true));
  }, []);

  function savePaymentMethod(method: PaymentMethod) {
    setPaymentMethod(method);
    setAddCardOpen(false);
    AsyncStorage.setItem(PAYMENT_METHOD_CACHE_KEY, JSON.stringify(method)).catch(() => {
      // Best-effort — the UI still reflects the card for this session either way.
    });
  }

  function clearPaymentMethod() {
    Alert.alert('Remove payment method?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setPaymentMethod(null);
          AsyncStorage.removeItem(PAYMENT_METHOD_CACHE_KEY).catch(() => {});
        },
      },
    ]);
  }

  function handleChoosePlan(tier: ZoneTier) {
    if (isPaidTier(tier) && !paymentMethod) {
      Alert.alert(
        'Add a payment method first',
        `${PLAN_INFO[tier].name} is ${PLAN_INFO[tier].priceLabel}/mo — add a card to upgrade.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add card', onPress: () => setAddCardOpen(true) },
        ]
      );
      return;
    }

    const plan = PLAN_INFO[tier];
    const downgrade = !isPaidTier(tier) && isPaidTier(zoneTier);
    Alert.alert(
      downgrade ? `Switch to ${plan.name}?` : `Upgrade to ${plan.name}?`,
      downgrade
        ? `You'll lose ${PLAN_INFO[zoneTier].name}'s wider zone radius immediately.`
        : `You'll be charged ${plan.priceLabel}/mo${paymentMethod ? ` on your ${paymentMethod.brand} ending in ${paymentMethod.last4}` : ''}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: downgrade ? 'Switch' : 'Upgrade', onPress: () => setZoneTier(tier) },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Billing</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionLabel}>Payment method</Text>
        {loaded && paymentMethod ? (
          <View style={[styles.section, elevation.raised, styles.cardRow]}>
            <View style={styles.cardIconBadge}>
              <Ionicons name="card" size={18} color={colors.accent} />
            </View>
            <Text style={styles.cardText}>{paymentMethod.brand} •••• {paymentMethod.last4}</Text>
            <Pressable onPress={clearPaymentMethod} hitSlop={8}>
              <Text style={styles.cardRemoveText}>Remove</Text>
            </Pressable>
          </View>
        ) : (
          loaded && (
            <Pressable
              style={({ pressed }) => [styles.section, styles.addCardRow, pressed && styles.tierRowPressed]}
              onPress={() => setAddCardOpen(true)}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
              <Text style={styles.addCardText}>Add a payment method</Text>
            </Pressable>
          )
        )}

        <Text style={styles.sectionLabel}>Plans</Text>
        <View style={styles.plansList}>
          {PLAN_ORDER.map((tier) => (
            <PlanCard
              key={tier}
              tier={tier}
              current={tier === zoneTier}
              onChoose={() => handleChoosePlan(tier)}
              onCancel={tier === zoneTier && isPaidTier(tier) ? () => handleChoosePlan('free') : undefined}
            />
          ))}
        </View>

        <Text style={styles.footnote}>
          Prices shown for demo purposes — no real payment processor is connected in this build.
        </Text>
      </ScrollView>

      <AddPaymentMethodModal visible={addCardOpen} onClose={() => setAddCardOpen(false)} onSave={savePaymentMethod} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { padding: spacing.xs },
  headerTitle: { ...type.subheading, flex: 1 },
  scroll: { padding: spacing.lg },
  sectionLabel: { ...type.label, marginBottom: spacing.sm, marginTop: spacing.lg },
  section: { backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  cardIconBadge: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { ...type.body, color: colors.textPrimary, flex: 1 },
  cardRemoveText: { ...type.caption, color: colors.danger, fontWeight: '700' },
  addCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  addCardText: { ...type.body, color: colors.accent, fontWeight: '700' },
  tierRowPressed: { opacity: 0.85 },
  plansList: { gap: spacing.md },
  planCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  planCardCurrent: { borderColor: colors.accent },
  planHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: spacing.xs },
  planName: { ...type.subheading },
  planPrice: { ...type.subheading, color: colors.accent },
  planBillingNote: { ...type.caption, marginBottom: spacing.sm },
  planBlurb: { ...type.body, marginBottom: spacing.md },
  planFeatures: { gap: spacing.xs, marginBottom: spacing.md },
  planFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  planFeatureText: { ...type.caption, color: colors.textSecondary },
  currentPlanRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  planCurrentBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  planCurrentBadgeText: { ...type.caption, color: colors.accent, fontWeight: '700' },
  cancelSubscriptionText: { ...type.caption, color: colors.danger, fontWeight: '700' },
  planChooseButton: {
    minHeight: MIN_TOUCH_TARGET * 0.8,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planChooseButtonPressed: { backgroundColor: colors.accentPressed },
  planChooseButtonText: { ...type.button, color: colors.accentText },
  footnote: { ...type.caption, textAlign: 'center', marginTop: spacing.lg, marginBottom: spacing.md },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  modalTitle: { ...type.heading, textAlign: 'center', marginBottom: spacing.xs },
  modalSubtitle: { ...type.caption, textAlign: 'center', marginBottom: spacing.lg },
  modalInput: {
    minHeight: MIN_TOUCH_TARGET * 0.7,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    ...type.body,
    color: colors.textPrimary,
  },
  modalRow: { flexDirection: 'row', gap: spacing.sm },
  modalRowInput: { flex: 1 },
  modalDone: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDoneDisabled: { opacity: 0.5 },
  modalDoneText: { ...type.button, color: colors.accentText },
});
