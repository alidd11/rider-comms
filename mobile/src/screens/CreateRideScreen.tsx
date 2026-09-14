// Unverified scaffold — see navigation/index.tsx header note.
import * as React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { RiderCommsClient } from '../api/client';
import { API_BASE_URL } from '../config';

type Props = NativeStackScreenProps<RootStackParamList, 'CreateRide'>;

export function CreateRideScreen({ navigation }: Props): React.JSX.Element {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleCreate = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = new RiderCommsClient(API_BASE_URL);
      // TODO: replace 'me' with the real signed-in rider id once auth exists.
      const { rideId, code } = await client.createRide('me');
      navigation.replace('Ride', { rideId, code });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong creating the ride.');
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Start a private ride</Text>
      <Text style={styles.body}>
        You'll get a code to share with the riders joining you. It expires automatically after 12 hours of
        inactivity.
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.button} onPress={handleCreate} disabled={loading}>
        {loading ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Create Ride</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 14, color: '#666' },
  error: { color: '#c0392b', fontSize: 14 },
  button: { backgroundColor: '#1a73e8', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});
