// Unverified scaffold — see navigation/index.tsx header note.
//
// Renders inside the Map screen's "Host" segment rather than as its own
// screen/tab — a second screen would mean a second mounted map instance
// once this app has a real map SDK behind it, which costs real money per
// load. One persistent map, switched by a segment, keeps that to one.
import * as React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ImageBackground, ScrollView, StatusBar, useWindowDimensions } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { useRide } from './RideContext';
import { microphoneErrorMessage, preflightVoiceMicrophone } from '../audio/microphone';

const RIDE_HERO_IMAGE = 'https://images.unsplash.com/photo-1770614956862-a143fb5e4921?auto=format&fit=crop&q=80&w=1200';

function JoinOrHostForm(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { height: viewportHeight } = useWindowDimensions();
  const heroHeight = viewportHeight <= 760
    ? 194
    : viewportHeight >= 820
      ? Math.min(232, viewportHeight * 0.26)
      : 210;
  const { startRide } = useRide();
  const { client } = useAuth();
  const [code, setCode] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [shareRideLocation, setShareRideLocation] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const codeInputRef = React.useRef<TextInput>(null);

  const handleJoin = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const normalizedCode = code.trim().toUpperCase();
      try {
        await preflightVoiceMicrophone();
      } catch (microphoneError) {
        setError(microphoneErrorMessage(microphoneError));
        return;
      }
      const { rideId } = await client.joinRide(normalizedCode);
      await startRide({ rideId, code: normalizedCode, isHost: false }, shareRideLocation);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setError('Too many attempts — wait a bit before trying again.');
      else if (err instanceof ApiError && err.status === 404) setError("That code doesn't match an active ride.");
      else if (err instanceof ApiError && err.status === 409) setError('This ride is full (20 riders max).');
      else setError('Something went wrong joining the ride.');
    } finally {
      setLoading(false);
    }
  }, [client, code, shareRideLocation, startRide]);

  const canSubmit = !loading && code.length === 6;

  return (
    <>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <ScrollView
        style={styles.joinScreen}
        contentContainerStyle={[styles.joinScroll, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
      >
        <Text style={[styles.screenTitle, { marginTop: insets.top + 18 }]}>Ride</Text>
        <ImageBackground
          source={{ uri: RIDE_HERO_IMAGE }}
          style={[styles.hero, { height: heroHeight }]}
          imageStyle={styles.heroImage}
          accessibilityRole="image"
          accessibilityLabel="Motorcyclists riding together on a winding mountain road"
        >
          <View style={styles.heroShade} />
          <View style={styles.heroFade} />
          <Text style={styles.heroTitle}>{'Ride further.\ntogether.'}</Text>
        </ImageBackground>

        <View style={styles.joinBody}>
          <View style={styles.joinCard}>
            <Text style={styles.joinTitle}>Join a ride</Text>
            <Text style={styles.fieldLabel}>Enter invite code</Text>
            <Pressable
              style={[styles.codeSlots, error && styles.codeSlotsError]}
              onPress={() => codeInputRef.current?.focus()}
              accessibilityRole="button"
              accessibilityLabel="Enter six character ride code"
            >
              {Array.from({ length: 6 }, (_, index) => (
                <View key={index} style={[styles.codeSlot, index > 0 && styles.codeSlotDivider, index === code.length && code.length < 6 && styles.codeSlotActive]}>
                  <Text style={[styles.codeSlotText, !code[index] && styles.codeSlotEmpty]}>{code[index] ?? '—'}</Text>
                </View>
              ))}
              <TextInput
                ref={codeInputRef}
                style={styles.codeInputOverlay}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={6}
                value={code}
                onChangeText={(text) => {
                  setCode(text.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6));
                  if (error) setError(null);
                }}
                accessibilityLabel="Ride invite code"
              />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.button, pressed && canSubmit && styles.buttonPressed, !canSubmit && styles.buttonDisabled]}
              onPress={handleJoin}
              disabled={!canSubmit}
            >
              {loading ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.buttonText}>Join Ride</Text>}
            </Pressable>
            <Text style={styles.joinHelp}>Ask the host for their six-character code.</Text>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: shareRideLocation }}
              onPress={() => setShareRideLocation((value) => !value)}
              style={styles.consentRow}
            >
              <View style={[styles.checkbox, shareRideLocation && styles.checkboxChecked]}>
                {shareRideLocation && <Ionicons name="checkmark" size={13} color={colors.accentText} />}
              </View>
              <View style={styles.consentCopy}>
                <Text style={styles.consentTitle}>Share my live location</Text>
                <Text style={styles.consentBody}>Ride members only · cleared when you leave or switch this off.</Text>
              </View>
            </Pressable>
            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={17} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
          </View>

          <Pressable
            onPress={() => navigation.navigate('CreateRide')}
            style={({ pressed }) => [styles.hostLink, pressed && styles.hostLinkPressed]}
          >
            <View style={styles.hostLinkIcon}><Ionicons name="people" size={19} color={colors.textSecondary} /></View>
            <View style={styles.hostLinkCopy}>
              <Text style={styles.hostLinkTitle}>Start a ride</Text>
              <Text style={styles.hostLinkText}>Create a new ride and invite your friends.</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
          </Pressable>
        </View>
      </ScrollView>
    </>
  );
}

function HostRoster(): React.JSX.Element {
  const { activeRide, roster, removeRider } = useRide();
  const { riderId } = useAuth();

  return (
    <View style={styles.form}>
      <Text style={styles.rootTitle}>Ride</Text>
      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>Share code</Text>
        <Text style={styles.codeValue}>{activeRide?.code}</Text>
      </View>

      <Text style={styles.sectionLabel}>Riders ({roster.length})</Text>
      <View style={[styles.rosterCard, elevation.raised]}>
        {roster.length === 0 ? (
          <Text style={styles.emptyRoster}>No one has joined yet — share the code above.</Text>
        ) : (
          roster.map((id) => (
            <View key={id} style={styles.rosterRow}>
              <View style={styles.rosterAvatar}>
                <MaterialCommunityIcons name="motorbike" size={16} color={colors.textPrimary} />
              </View>
              <Text style={styles.rosterName}>{id}</Text>
              {id !== riderId && <Pressable onPress={() => void removeRider(id)} style={styles.removeButton} hitSlop={8}>
                <Ionicons name="close-circle" size={22} color={colors.danger} />
              </Pressable>}
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function MemberCard(): React.JSX.Element {
  const { activeRide } = useRide();
  return (
    <View style={styles.form}>
      <Text style={styles.rootTitle}>Ride</Text>
      <View style={[styles.iconBadge, elevation.raised]}>
        <MaterialCommunityIcons name="motorbike" size={32} color={colors.accent} />
      </View>
      <Text style={styles.title}>You're in this ride</Text>
      <Text style={styles.body}>Ride ID: {activeRide?.rideId} — only the host can add or remove riders.</Text>
    </View>
  );
}

export function HostPanel(): React.JSX.Element {
  const { activeRide } = useRide();
  const insets = useSafeAreaInsets();

  if (!activeRide) return <JoinOrHostForm />;
  return (
    <View style={[styles.activePanel, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
      {activeRide.isHost ? <HostRoster /> : <MemberCard />}
    </View>
  );
}

const styles = StyleSheet.create({
  joinScreen: { flex: 1, backgroundColor: colors.background },
  joinScroll: { flexGrow: 1, backgroundColor: colors.background },
  joinBody: { gap: 8, paddingHorizontal: 20, paddingTop: 10 },
  activePanel: { flex: 1, paddingHorizontal: spacing.lg, backgroundColor: colors.background },
  form: { flexGrow: 1, gap: spacing.md },
  rootTitle: { ...type.title, color: colors.textPrimary, fontSize: 28, lineHeight: 32, letterSpacing: -0.8 },
  screenTitle: { ...type.title, color: colors.textPrimary, fontSize: 28, lineHeight: 30, letterSpacing: -0.9, marginHorizontal: 20, marginBottom: 13 },
  hero: { marginHorizontal: 20, justifyContent: 'flex-end', overflow: 'hidden', borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
  heroImage: { borderRadius: radii.lg },
  heroShade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(3,7,9,0.18)' },
  heroFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 62, backgroundColor: 'rgba(3,7,9,0.30)' },
  heroTitle: { color: '#FFFFFF', fontSize: 24, lineHeight: 23, fontWeight: '800', letterSpacing: -0.9, paddingHorizontal: 14, paddingBottom: 14, textShadowColor: 'rgba(0,0,0,0.48)', textShadowRadius: 8 },
  joinCard: { gap: 7, padding: 11, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface },
  joinTitle: { ...type.subheading, color: colors.textPrimary, fontSize: 14, lineHeight: 17, fontWeight: '800', marginBottom: 0 },
  fieldLabel: { ...type.caption, color: colors.textSecondary, fontSize: 10, lineHeight: 13, fontWeight: '700' },
  iconBadge: { width: 48, height: 48, borderRadius: radii.lg, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  title: { ...type.heading, marginBottom: spacing.sm },
  body: { ...type.body, marginBottom: spacing.lg },
  codeSlots: { position: 'relative', minHeight: 38, flexDirection: 'row', gap: 0, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surfaceRaised },
  codeSlotsError: { borderColor: colors.danger },
  codeSlot: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 0, borderRadius: 0, backgroundColor: 'transparent' },
  codeSlotDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  codeSlotActive: { backgroundColor: colors.accentSoft, borderBottomWidth: 2, borderBottomColor: colors.accent },
  codeSlotText: { fontSize: 15, lineHeight: 18, fontWeight: '800', color: colors.textPrimary },
  codeSlotEmpty: { color: colors.textMuted, fontWeight: '500' },
  codeInputOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.01, color: 'transparent' },
  joinHelp: { ...type.caption, color: colors.textMuted, fontSize: 9, lineHeight: 12, marginTop: -1 },
  consentRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  checkbox: { width: 17, height: 17, borderRadius: radii.md, borderWidth: 1.5, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center', marginTop: 0 },
  checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  consentCopy: { flex: 1 },
  consentTitle: { ...type.caption, color: colors.textPrimary, fontSize: 10, lineHeight: 13, fontWeight: '700' },
  consentBody: { ...type.caption, color: colors.textMuted, fontSize: 9, lineHeight: 12, marginTop: 1 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.dangerSurface, borderRadius: radii.lg, paddingHorizontal: 7, paddingVertical: 5 },
  errorText: { ...type.caption, color: colors.danger, flex: 1, fontSize: 9, lineHeight: 12 },
  hostLink: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface },
  hostLinkPressed: { opacity: 0.82 },
  hostLinkIcon: { width: 34, height: 34, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  hostLinkCopy: { flex: 1, minWidth: 0 },
  hostLinkTitle: { ...type.body, color: colors.textPrimary, fontSize: 12, lineHeight: 15, fontWeight: '700' },
  hostLinkText: { ...type.caption, color: colors.textMuted, fontSize: 9, lineHeight: 12, marginTop: 1 },
  button: { minHeight: 42, backgroundColor: colors.accent, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center', marginTop: -1 },
  buttonPressed: { backgroundColor: colors.accentPressed },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { ...type.button, color: colors.accentText, fontSize: 12 },
  codeCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, alignItems: 'center', marginBottom: spacing.lg, ...elevation.raised },
  codeLabel: { ...type.label },
  codeValue: { fontSize: 32, fontWeight: '800', letterSpacing: 6, color: colors.accent, marginTop: spacing.xs },
  sectionLabel: { ...type.label, marginBottom: spacing.sm },
  rosterCard: { backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden' },
  emptyRoster: { ...type.caption, padding: spacing.md, textAlign: 'center' },
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  rosterAvatar: { width: 32, height: 32, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  rosterName: { ...type.body, color: colors.textPrimary, flex: 1 },
  removeButton: { padding: spacing.xs },
});
