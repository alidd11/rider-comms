//
// Renders inside the Map screen's "Host" segment rather than as its own
// screen/tab — a second screen would mean a second mounted map instance
// once this app has a real map SDK behind it, which costs real money per
// load. One persistent map, switched by a segment, keeps that to one.
import * as React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ImageBackground, ScrollView, StatusBar, Switch, useWindowDimensions } from 'react-native';
import type { TextInputInstance } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { ApiError } from '../api/client';
import { rideRefusalMessage } from './rideErrors';
import { useAuth } from '../auth/AuthContext';
import { RIDE_HERO_IMAGE } from '../brandAssets';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET, pressedFeedback } from '../theme';
import { useRide } from './RideContext';
import { RideRoster } from './RideRoster';
import { isCompleteRideCode, normalizeRideCodeInput } from './rideInvite';
import { microphoneErrorMessage, preflightVoiceMicrophone } from '../audio/microphone';


function JoinOrHostForm({ inviteCode, onBack }: { inviteCode?: string | null; onBack?: () => void }): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { height: viewportHeight } = useWindowDimensions();
  // About a third shorter than before, so Join and Start sit higher.
  const heroHeight = viewportHeight <= 760 ? 124 : viewportHeight >= 820 ? 152 : 136;
  const { startRide } = useRide();
  const { client } = useAuth();
  const [code, setCode] = React.useState(inviteCode ?? '');
  const [loading, setLoading] = React.useState(false);
  const [codeFocused, setCodeFocused] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const codeInputRef = React.useRef<TextInputInstance>(null);

  // An invite link opened while the app is running fills in its code.
  React.useEffect(() => {
    if (inviteCode) {
      setCode(inviteCode);
      setError(null);
    }
  }, [inviteCode]);

  const handleJoin = React.useCallback(async () => {
    if (!isCompleteRideCode(code)) return;
    setLoading(true);
    setError(null);
    try {
      try {
        await preflightVoiceMicrophone();
      } catch (microphoneError) {
        setError(microphoneErrorMessage(microphoneError));
        return;
      }
      const { rideId } = await client.joinRide(code);
      // Location sharing is chosen inside the ride, once the rider can see
      // who is in it; it always starts off.
      await startRide({ rideId, code, isHost: false }, false);
    } catch (err) {
      // The code stays in the field so the rider can fix one character.
      if (err instanceof ApiError && err.status === 429) setError('Too many attempts. Wait a minute before trying again.');
      else if (err instanceof ApiError && err.status === 404) setError("That code doesn’t match an active ride. Check it with your host.");
      else if (err instanceof ApiError && err.status === 409) setError('This ride is full (20 riders max). Ask the host to start another.');
      else if (err instanceof ApiError && err.status === 403) setError(rideRefusalMessage(err));
      else setError('Couldn’t reach Rider Comms. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [client, code, startRide]);

  const complete = isCompleteRideCode(code);
  const canSubmit = !loading && complete;

  return (
    <>
      <StatusBar barStyle="light-content" />
      <ScrollView
        style={styles.joinScreen}
        contentContainerStyle={[styles.joinScroll, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
      >
        <View style={[styles.titleRow, { marginTop: insets.top + 18 }]}>
          <BackToMap onBack={onBack} />
          <Text style={styles.screenTitle} accessibilityRole="header">Ride</Text>
        </View>
        <ImageBackground
          source={RIDE_HERO_IMAGE}
          style={[styles.hero, { height: heroHeight }]}
          imageStyle={styles.heroImage}
          accessibilityRole="image"
          accessibilityLabel="Motorcyclists riding together on a winding mountain road"
        >
        </ImageBackground>

        <View style={styles.joinBody}>
          <View style={styles.card}>
            <Text style={styles.cardTitle} accessibilityRole="header">Join a ride</Text>
            <Text style={styles.cardBody}>Enter the six-character code from your host.</Text>
            <Pressable
              style={[styles.codeSlots, codeFocused && styles.codeSlotsFocused, error && styles.codeSlotsError]}
              onPress={() => codeInputRef.current?.focus()}
              accessibilityRole="button"
              accessibilityLabel={`Invite code, ${code.length} of 6 characters entered`}
              accessibilityHint="Opens the keyboard to enter or paste the six-character code"
            >
              {Array.from({ length: 6 }, (_, index) => (
                <View
                  key={index}
                  style={[
                    styles.codeSlot,
                    index === 3 && styles.codeSlotGroupGap,
                    codeFocused && index === code.length && styles.codeSlotActive,
                  ]}
                >
                  <Text style={[styles.codeSlotText, !code[index] && styles.codeSlotEmpty]}>{code[index] ?? '·'}</Text>
                </View>
              ))}
              {/* One real field over the boxes: typing, pasting a whole code
                  or a whole invite message all land here. No maxLength, so a
                  pasted "ABC 234" isn't cut short before it is cleaned up. */}
              <TextInput
                ref={codeInputRef}
                style={styles.codeInputOverlay}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                keyboardType="ascii-capable"
                returnKeyType="go"
                value={code}
                onFocus={() => setCodeFocused(true)}
                onBlur={() => setCodeFocused(false)}
                onChangeText={(text) => {
                  setCode(normalizeRideCodeInput(text));
                  if (error) setError(null);
                }}
                onSubmitEditing={() => { if (canSubmit) void handleJoin(); }}
                accessibilityLabel="Ride invite code"
                accessibilityHint="Enter or paste the six-character code from the ride host"
              />
            </Pressable>
            {error ? (
              <View style={styles.errorBox} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                <Ionicons name="alert-circle" size={18} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
            <Pressable accessibilityRole="button"
              accessibilityLabel={loading ? 'Joining ride' : 'Join ride'}
              accessibilityHint={complete ? undefined : 'Enter all six characters of the code first'}
              accessibilityState={{ disabled: !canSubmit, busy: loading }}
              style={({ pressed }) => [
                styles.primaryButton,
                !complete && !loading && styles.primaryButtonDisabled,
                pressed && canSubmit && styles.primaryButtonPressed,
              ]}
              onPress={() => void handleJoin()}
              disabled={!canSubmit}
            >
              {loading ? (
                <View style={styles.buttonBusy}>
                  <ActivityIndicator color={colors.accentText} />
                  <Text style={styles.primaryButtonText}>Joining…</Text>
                </View>
              ) : (
                <Text style={[styles.primaryButtonText, !complete && styles.primaryButtonTextDisabled]}>Join ride</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle} accessibilityRole="header">Start a ride</Text>
            <Text style={styles.cardBody}>Create a group and invite your friends with a code.</Text>
            <Pressable accessibilityRole="button"
              accessibilityLabel="Start a ride"
              accessibilityHint="Create a private ride and invite your friends"
              onPress={() => navigation.navigate('CreateRide')}
              style={({ pressed }) => [styles.primaryButton, styles.buttonWithIcon, pressed && styles.primaryButtonPressed]}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.accentText} />
              <Text style={styles.primaryButtonText}>Start a ride</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </>
  );
}

/** Live-location consent for the ride the rider is in: chosen here, where
 * they can see who is in the ride, rather than before joining. */
function RideLocationSharing(): React.JSX.Element {
  const { shareRideLocation, setRideLocationSharing } = useRide();
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const toggle = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await setRideLocationSharing(!shareRideLocation);
    if (!ok) setFailed(true);
    setBusy(false);
  };

  return (
    <View style={styles.card}>
      <View style={styles.locationRow}>
        <View style={styles.locationCopy}>
          <Text style={styles.locationTitle}>Share your live location with this ride</Text>
          <Text style={styles.cardBody}>
            {shareRideLocation
              ? 'On. Riders in this ride can see where you are. It stops when you switch it off, leave the ride or the ride ends.'
              : 'Off. Riders in this ride can’t see where you are.'}
          </Text>
        </View>
        <Switch
          value={shareRideLocation}
          onValueChange={() => void toggle()}
          disabled={busy}
          trackColor={{ false: colors.switchTrackOff, true: colors.accent }}
          ios_backgroundColor={colors.switchTrackOff}
          accessibilityLabel="Share your live location with this ride"
        />
      </View>
      {failed ? (
        <Text style={styles.errorText} accessibilityRole="alert">Couldn’t change location sharing. Try again.</Text>
      ) : null}
    </View>
  );
}

/** Everyone in the ride by name, with report/block on each other rider and
 * (for the host) a confirmed remove. */
function HostRoster(): React.JSX.Element {
  const { activeRide, roster } = useRide();

  return (
    <View style={styles.form}>
      <Text style={styles.rootTitle} accessibilityRole="header">Ride</Text>
      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>Share code</Text>
        <Text style={styles.codeValue}>{activeRide?.code}</Text>
      </View>
      <RideLocationSharing />
      <Text style={styles.sectionLabel}>Riders ({roster.length})</Text>
      <RideRoster canRemove />
    </View>
  );
}

function MemberCard(): React.JSX.Element {
  const { roster } = useRide();
  return (
    <View style={styles.form}>
      <Text style={styles.rootTitle} accessibilityRole="header">Ride</Text>
      <View style={styles.memberHeader}>
        <View style={[styles.iconBadge, elevation.raised]}>
          <MaterialCommunityIcons name="motorbike" size={28} color={colors.accent} />
        </View>
        <View style={styles.locationCopy}>
          <Text style={styles.title}>You’re in this ride</Text>
          <Text style={styles.cardBody}>Only the host can add or remove riders.</Text>
        </View>
      </View>
      <RideLocationSharing />
      <Text style={styles.sectionLabel}>Riders ({roster.length})</Text>
      <RideRoster canRemove={false} />
    </View>
  );
}

/** Back to the map (PWA: the Ride page's back arrow). */
function BackToMap({ onBack }: { onBack?: () => void }): React.JSX.Element | null {
  if (!onBack) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Back to map" onPress={onBack} hitSlop={8} style={({ pressed }) => [styles.backToMap, pressed && pressedFeedback]} testID="ride-back">
      <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
    </Pressable>
  );
}

export function HostPanel({ inviteCode, onBack }: { inviteCode?: string | null; onBack?: () => void } = {}): React.JSX.Element {
  const { activeRide } = useRide();
  const insets = useSafeAreaInsets();

  if (!activeRide) return <JoinOrHostForm inviteCode={inviteCode} onBack={onBack} />;
  return (
    <ScrollView
      style={styles.activeScroll}
      contentContainerStyle={[styles.activePanel, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}
    >
      <BackToMap onBack={onBack} />
      {activeRide.isHost ? <HostRoster /> : <MemberCard />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  joinScreen: { flex: 1, backgroundColor: colors.background },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  backToMap: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, marginLeft: spacing.sm, marginRight: -spacing.xs, alignItems: 'center', justifyContent: 'center' },
  joinScroll: { flexGrow: 1, backgroundColor: colors.background },
  joinBody: { gap: spacing.md, paddingHorizontal: 20, paddingTop: spacing.md },
  activeScroll: { flex: 1, backgroundColor: colors.background },
  activePanel: { flexGrow: 1, paddingHorizontal: spacing.lg },
  form: { flexGrow: 1, gap: spacing.md },
  rootTitle: { ...type.title, color: colors.textPrimary, fontSize: 28, lineHeight: 32, letterSpacing: -0.8 },
  screenTitle: { ...type.title, color: colors.textPrimary, fontSize: 28, lineHeight: 30, letterSpacing: -0.9, marginHorizontal: 20, marginBottom: 12 },
  hero: { marginHorizontal: 20, justifyContent: 'flex-end', overflow: 'hidden', borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
  heroImage: { borderRadius: radii.lg },
  card: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface },
  cardTitle: { ...type.subheading, color: colors.textPrimary, fontSize: 18, lineHeight: 22, fontWeight: '800' },
  cardBody: { ...type.body, color: colors.textSecondary, fontSize: 14, lineHeight: 19 },
  iconBadge: { width: 48, height: 48, borderRadius: radii.lg, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  memberHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { ...type.heading, fontSize: 18, lineHeight: 22 },
  codeSlots: { position: 'relative', minHeight: 56, flexDirection: 'row', gap: 6, marginTop: spacing.xs, padding: 4, borderWidth: 1.5, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surfaceRaised },
  codeSlotsFocused: { borderColor: colors.accent },
  codeSlotsError: { borderColor: colors.danger },
  codeSlot: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.surface },
  codeSlotGroupGap: { marginLeft: 8 },
  codeSlotActive: { borderWidth: 2, borderColor: colors.accent },
  codeSlotText: { fontSize: 22, lineHeight: 26, fontWeight: '800', letterSpacing: 0.5, color: colors.textPrimary },
  codeSlotEmpty: { color: colors.textMuted, fontWeight: '600' },
  codeInputOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.01, color: 'transparent' },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.dangerSurface, borderRadius: radii.md, padding: spacing.sm },
  errorText: { ...type.body, color: colors.danger, flex: 1, fontSize: 14, lineHeight: 19 },
  primaryButton: { minHeight: 50, marginTop: spacing.xs, backgroundColor: colors.accent, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center' },
  primaryButtonPressed: { backgroundColor: colors.accentPressed },
  primaryButtonDisabled: { backgroundColor: colors.surfaceRaised },
  primaryButtonText: { ...type.button, color: colors.accentText, fontSize: 16 },
  primaryButtonTextDisabled: { color: colors.textMuted },
  buttonBusy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  buttonWithIcon: { flexDirection: 'row', gap: spacing.sm },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  locationCopy: { flex: 1, gap: 4 },
  locationTitle: { ...type.body, color: colors.textPrimary, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  codeCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, alignItems: 'center', ...elevation.raised },
  codeLabel: { ...type.label },
  codeValue: { fontSize: 32, fontWeight: '800', letterSpacing: 6, color: colors.accentInk, marginTop: spacing.xs },
  sectionLabel: { ...type.label, marginTop: spacing.sm },
});
