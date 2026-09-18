// Unverified scaffold — see navigation/index.tsx header note.
//
// Renders inside the Map screen's "Host" segment rather than as its own
// screen/tab — a second screen would mean a second mounted map instance
// once this app has a real map SDK behind it, which costs real money per
// load. One persistent map, switched by a segment, keeps that to one.
import * as React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { useRide } from './RideContext';

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
      const { rideId } = await client.joinRide(normalizedCode);
      await startRide({ rideId, code: normalizedCode, isHost: false }, shareRideLocation);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts — wait a bit before trying again.');
      } else if (err instanceof ApiError && err.status === 404) {
        setError("That code doesn't match an active ride.");
      } else if (err instanceof ApiError && err.status === 409) {
        setError('This ride is full (20 riders max).');
      } else {
        setError('Something went wrong joining the ride.');
      }
    } finally {
      setLoading(false);
    }
  }, [client, code, shareRideLocation, startRide]);

  const canSubmit = !loading && code.length === 6;

  return (
    <View style={styles.form}>
      <View style={[styles.iconBadge, elevation.raised]}>
        <Ionicons name="key" size={32} color={colors.accent} />
      </View>
      <Text style={styles.title}>Join or host a ride</Text>
      <Text style={styles.body}>Enter a 6-character code to join a ride, or host your own.</Text>

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
        accessibilityRole="checkbox"
        accessibilityState={{ checked: shareRideLocation }}
        onPress={() => setShareRideLocation((value) => !value)}
        style={styles.consentRow}
      >
        <View style={[styles.checkbox, shareRideLocation && styles.checkboxChecked]}>
          {shareRideLocation && <Ionicons name="checkmark" size={16} color={colors.accentText} />}
        </View>
        <View style={styles.consentCopy}>
          <Text style={styles.consentTitle}>Share my live location</Text>
          <Text style={styles.consentBody}>
            Optional. Only current ride members can see it, and it is removed when you leave or switch this off.
          </Text>
        </View>
      </Pressable>

      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [
          styles.button,
          pressed && canSubmit && styles.buttonPressed,
          !canSubmit && styles.buttonDisabled,
        ]}
        onPress={handleJoin}
        disabled={!canSubmit}
      >
        {loading ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.buttonText}>Join</Text>}
      </Pressable>

      <Pressable onPress={() => navigation.navigate('CreateRide')} style={styles.hostLink}>
        <Text style={styles.hostLinkText}>Starting a new ride? Host one instead</Text>
      </Pressable>
    </View>
  );
}

function HostRoster(): React.JSX.Element {
  const { activeRide, roster, removeRider } = useRide();
  const { riderId } = useAuth();

  return (
    <View style={styles.form}>
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
  form: { flex: 1 },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { ...type.heading, marginBottom: spacing.sm },
  body: { ...type.body, marginBottom: spacing.lg },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    minHeight: MIN_TOUCH_TARGET,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 8,
    textAlign: 'center',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  inputError: { borderColor: colors.danger },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  consentCopy: { flex: 1 },
  consentTitle: { ...type.label, color: colors.textPrimary },
  consentBody: { ...type.caption, color: colors.textSecondary, marginTop: 3, lineHeight: 18 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerSurface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: { ...type.body, color: colors.danger, flex: 1 },
  hostLink: { alignItems: 'center', paddingVertical: spacing.md },
  hostLinkText: { ...type.caption, color: colors.textSecondary },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { backgroundColor: colors.accentPressed },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { ...type.button, color: colors.accentText },
  codeCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.lg,
    ...elevation.raised,
  },
  codeLabel: { ...type.label },
  codeValue: { fontSize: 32, fontWeight: '800', letterSpacing: 6, color: colors.accent, marginTop: spacing.xs },
  sectionLabel: { ...type.label, marginBottom: spacing.sm },
  rosterCard: { backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden' },
  emptyRoster: { ...type.caption, padding: spacing.md, textAlign: 'center' },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rosterAvatar: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rosterName: { ...type.body, color: colors.textPrimary, flex: 1 },
  removeButton: { padding: spacing.xs },
});
