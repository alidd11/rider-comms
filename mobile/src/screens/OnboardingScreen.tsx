// First-launch, 2-screen onboarding flow — gated on a persisted AsyncStorage
// flag (see navigation/index.tsx) so it's shown once, before the user is
// ever dropped straight into MapScreen. Screen 2 makes the foreground
// location request only after the rider taps the explicit enable action.
import * as React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import * as Location from 'expo-location';

export const ONBOARDING_COMPLETED_KEY = '@rider-comms/onboarding/completed';

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
      onPress={onPress}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
      <Ionicons name="arrow-forward" size={20} color={colors.accentText} />
    </Pressable>
  );
}

function ValuePropStep({ onNext }: { onNext: () => void }): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.step, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.iconBadge}>
        <MaterialCommunityIcons name="motorbike" size={40} color={colors.accent} />
      </View>
      <View style={styles.copyBlock}>
        <Text style={styles.title}>Rider Comms</Text>
        <Text style={styles.body}>
          See which riders in your group are nearby, host or join a ride, and talk over group audio while you ride.
        </Text>
      </View>
      <PrimaryButton label="Get Started" onPress={onNext} />
    </View>
  );
}

function LocationPrimingStep({ onContinue }: { onContinue: () => Promise<void> }): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.step, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.iconBadge}>
        <Ionicons name="location" size={40} color={colors.accent} />
      </View>
      <View style={styles.copyBlock}>
        <Text style={styles.title}>Your location</Text>
        <Text style={styles.body}>
          Rider Comms needs your location to show you which riders are nearby and to share your position during a
          ride.
        </Text>
      </View>
      <PrimaryButton label="Enable location" onPress={() => { void onContinue(); }} />
    </View>
  );
}

export function OnboardingScreen({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [step, setStep] = React.useState<0 | 1>(0);

  const handleContinue = React.useCallback(async () => {
    await Location.requestForegroundPermissionsAsync().catch(() => undefined);
    AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true').catch(() => {
      // Best-effort — if this write fails, onboarding just shows again next
      // launch, which is a minor annoyance, not a broken app.
    });
    onDone();
  }, [onDone]);

  return (
    <View style={styles.container}>
      {step === 0 ? (
        <ValuePropStep onNext={() => setStep(1)} />
      ) : (
        <LocationPrimingStep onContinue={handleContinue} />
      )}

      <View style={styles.dots}>
        <View style={[styles.dot, step === 0 && styles.dotActive]} />
        <View style={[styles.dot, step === 1 && styles.dotActive]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  step: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    gap: spacing.xl,
  },
  iconBadge: {
    width: 88,
    height: 88,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...elevation.raised,
  },
  copyBlock: { gap: spacing.md },
  title: { ...type.display, textAlign: 'center' },
  body: { ...type.body, fontSize: 17, lineHeight: 24, textAlign: 'center', color: colors.textSecondary },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonPressed: { backgroundColor: colors.accentPressed },
  primaryButtonText: { ...type.button, color: colors.accentText },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.lg,
  },
  dot: { width: 8, height: 8, borderRadius: radii.pill, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.accent },
});
