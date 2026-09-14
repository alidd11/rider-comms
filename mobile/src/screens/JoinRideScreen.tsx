// Unverified scaffold — see navigation/index.tsx header note.
import * as React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { ApiError, RiderCommsClient } from '../api/client';

type Props = NativeStackScreenProps<RootStackParamList, 'JoinRide'>;

const API_BASE_URL = 'http://localhost:4000';

export function JoinRideScreen({ navigation }: Props): React.JSX.Element {
  const [code, setCode] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleJoin = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = new RiderCommsClient(API_BASE_URL);
      const { rideId } = await client.joinRide(code.trim().toUpperCase(), 'me');
      navigation.replace('Ride', { rideId });
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
  }, [code, navigation]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Join a ride</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter ride code"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={6}
        value={code}
        onChangeText={setCode}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.button} onPress={handleJoin} disabled={loading || code.length < 6}>
        {loading ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Join</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 12,
    padding: 14,
    fontSize: 20,
    letterSpacing: 4,
    textAlign: 'center',
  },
  error: { color: '#c0392b', fontSize: 14 },
  button: { backgroundColor: '#1a73e8', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});
