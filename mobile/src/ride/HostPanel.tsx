// Unverified scaffold — see navigation/index.tsx header note.
//
// Renders inside the Map screen's "Host" segment rather than as its own
// screen/tab — a second screen would mean a second mounted map instance
// once this app has a real map SDK behind it, which costs real money per
// load. One persistent map, switched by a segment, keeps that to one.
import * as React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ImageBackground, ScrollView } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
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
  const { startRide } = useRide();
  const { client } = useAuth();
  const [code, setCode] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [shareRideLocation, setShareRideLocation] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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
    <ScrollView contentContainerStyle={styles.form} showsVerticalScrollIndicator={false}>
      <Text style={styles.rootTitle}>Ride</Text>
      <ImageBackground source={{ uri: RIDE_HERO_IMAGE }} style={styles.hero} imageStyle={styles.heroImage}>
        <View style={styles.heroShade} />
        <Text style={styles.heroTitle}>{'Ride further.\ntogether.'}</Text>
      </ImageBackground>

      <View style={styles.joinCard}>
        <Text style={styles.joinTitle}>Join a ride</Text>
        <TextInput
          style={[styles.input, error && styles.inputError]}
          placeholder="ABCDEF"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          value={code}
          onChangeText={(text) => {
            setCode(text);
            if (error) setError(null);
          }}
        />
        <Pressable
          style={({ pressed }) => [styles.button, pressed && canSubmit && styles.buttonPressed, !canSubmit && styles.buttonDisabled]}
          onPress={handleJoin}
          disabled={!canSubmit}
        >
          {loading ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.buttonText}>Join Ride</Text>}
        </Pressable>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: shareRideLocation }}
          onPress={() => setShareRideLocation((value) => !value)}
          style={styles.consentRow}
        >
          <View style={[styles.checkbox, shareRideLocation && styles.checkboxChecked]}>
            {shareRideLocation && <Ionicons name="checkmark" size={14} color={colors.accentText} />}
          </View>
          <View style={styles.consentCopy}>
            <Text style={styles.consentTitle}>Share live location</Text>
            <Text style={styles.consentBody}>Optional · visible only to current ride members.</Text>
          </View>
        </Pressable>
        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>

      <Pressable
        onPress={() => navigation.navigate('CreateRide')}
        style={({ pressed }) => [styles.hostLink, pressed && styles.hostLinkPressed]}
      >
        <View style={styles.hostLinkIcon}><Ionicons name="people" size={20} color={colors.textPrimary} /></View>
        <View style={styles.hostLinkCopy}>
          <Text style={styles.hostLinkTitle}>Start a ride</Text>
          <Text style={styles.hostLinkText}>Create a new ride and invite your friends.</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </Pressable>
    </ScrollView>
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

  if (!activeRide) return <JoinOrHostForm />;
  return activeRide.isHost ? <HostRoster /> : <MemberCard />;
}

const styles = StyleSheet.create({
  form: { flexGrow: 1, gap: spacing.md },
  rootTitle: { ...type.title, color: colors.textPrimary, fontSize: 28, lineHeight: 32, letterSpacing: -0.8 },
  hero: { height: 188, justifyContent: 'flex-end', overflow: 'hidden', borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
  heroImage: { borderRadius: radii.lg },
  heroShade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(5,9,12,0.32)' },
  heroTitle: { color: '#FFFFFF', fontSize: 26, lineHeight: 25, fontWeight: '800', letterSpacing: -0.8, padding: spacing.md, textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 8 },
  joinCard: { gap: spacing.sm, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface },
  joinTitle: { ...type.subheading, color: colors.textPrimary, fontWeight: '800' },
  iconBadge: { width: 48, height: 48, borderRadius: radii.lg, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  title: { ...type.heading, marginBottom: spacing.sm },
  body: { ...type.body, marginBottom: spacing.lg },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, borderRadius: radii.md, minHeight: 48, fontSize: 21, fontWeight: '700', letterSpacing: 7, textAlign: 'center', color: colors.textPrimary },
  inputError: { borderColor: colors.danger },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  checkbox: { width: 20, height: 20, borderRadius: radii.md, borderWidth: 1.5, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  consentCopy: { flex: 1 },
  consentTitle: { ...type.caption, color: colors.textPrimary, fontWeight: '700' },
  consentBody: { ...type.caption, color: colors.textSecondary, marginTop: 2, lineHeight: 17 },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.dangerSurface, borderRadius: radii.md, padding: spacing.sm },
  errorText: { ...type.caption, color: colors.danger, flex: 1 },
  hostLink: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface },
  hostLinkPressed: { opacity: 0.82 },
  hostLinkIcon: { width: 40, height: 40, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  hostLinkCopy: { flex: 1, minWidth: 0 },
  hostLinkTitle: { ...type.body, color: colors.textPrimary, fontWeight: '700' },
  hostLinkText: { ...type.caption, color: colors.textSecondary, marginTop: 2 },
  button: { minHeight: MIN_TOUCH_TARGET, backgroundColor: colors.accent, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  buttonPressed: { backgroundColor: colors.accentPressed },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { ...type.button, color: colors.accentText },
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
