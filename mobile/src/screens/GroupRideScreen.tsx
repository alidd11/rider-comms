// Unverified scaffold — see navigation/index.tsx header note.
import * as React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { ApiError, RiderCommsClient } from '../api/client';
import { API_BASE_URL } from '../config';
import { colors, spacing, radii, type, MIN_TOUCH_TARGET } from '../theme';
import { useRide } from '../ride/RideContext';
import { RideBar } from '../ride/RideBar';

export function GroupRideScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { activeRide, startRide } = useRide();
  const [code, setCode] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleJoin = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = new RiderCommsClient(API_BASE_URL);
      const { rideId } = await client.joinRide(code.trim().toUpperCase(), 'me');
      startRide({ rideId });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts — wait a bit before trying again.');
      } else if (err instanceof ApiError && err.status === 404) {
        setError("That code doesn't match an active ride.");
      } else {
        setError('Something went wrong joining the ride.');
      }
    } finally {
      setLoading(false);
    }
  }, [code, startRide]);

  const canSubmit = !loading && code.length === 6;

  return (
    <View style={styles.container}>
      <View style={styles.form}>
        <View style={styles.iconBadge}>
          <Ionicons name="key" size={32} color={colors.accent} />
        </View>
        <Text style={styles.title}>Group Ride</Text>
        <Text style={styles.body}>Enter the 6-character code shared by the ride's organizer.</Text>

        <TextInput
          style={[styles.input, error && styles.inputError]}
          placeholder="ABCDEF"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          value={code}
          editable={!activeRide}
          onChangeText={(text) => {
            setCode(text);
            if (error) setError(null);
          }}
        />

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {activeRide ? (
          <Text style={styles.alreadyInRide}>You're already in a ride — leave it first to join another.</Text>
        ) : (
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
        )}

        {!activeRide && (
          <Pressable onPress={() => navigation.navigate('CreateRide')} style={styles.createLink}>
            <Text style={styles.createLinkText}>Starting a new group ride? Create one</Text>
          </Pressable>
        )}
      </View>

      <RideBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, justifyContent: 'space-between' },
  form: { justifyContent: 'center', flex: 1 },
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
  alreadyInRide: { ...type.caption, textAlign: 'center' },
  createLink: { alignItems: 'center', paddingVertical: spacing.md },
  createLinkText: { ...type.caption, color: colors.textSecondary },
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
});
