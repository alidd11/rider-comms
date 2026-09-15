// Unverified scaffold — see navigation/index.tsx header note.
import * as React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { useAuth } from '../auth/AuthContext';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { useRide } from '../ride/RideContext';

type Props = NativeStackScreenProps<RootStackParamList, 'CreateRide'>;

export function CreateRideScreen({ navigation }: Props): React.JSX.Element {
  const { startRide } = useRide();
  const { client } = useAuth();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleCreate = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { rideId, code } = await client.createRide();
      startRide({ rideId, code, isHost: true });
      navigation.goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong creating the ride.');
    } finally {
      setLoading(false);
    }
  }, [navigation, startRide]);

  return (
    <View style={styles.container}>
      <View style={styles.iconBadge}>
        <MaterialCommunityIcons name="motorbike" size={32} color={colors.accent} />
      </View>
      <Text style={styles.title}>Host a ride</Text>
      <Text style={styles.body}>
        You'll get a code to share with the riders joining you, and can add or remove riders as host. It
        expires automatically after 12 hours of inactivity.
      </Text>

      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, loading && styles.buttonDisabled]}
        onPress={handleCreate}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={colors.accentText} />
        ) : (
          <Text style={styles.buttonText}>Create Ride</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, justifyContent: 'center' },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    ...elevation.raised,
  },
  title: { ...type.heading, marginBottom: spacing.sm },
  body: { ...type.body, marginBottom: spacing.lg },
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
  button: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { backgroundColor: colors.accentPressed },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { ...type.button, color: colors.accentText },
});
