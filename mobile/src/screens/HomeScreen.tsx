// Unverified scaffold — see navigation/index.tsx header note.
import * as React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export function HomeScreen({ navigation }: Props): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Rider Comms</Text>
      <Text style={styles.subtitle}>Hands-free voice + navigation for riders</Text>

      <Pressable style={styles.button} onPress={() => navigation.navigate('CreateRide')}>
        <Text style={styles.buttonText}>Start a Private Ride</Text>
      </Pressable>

      <Pressable style={styles.button} onPress={() => navigation.navigate('JoinRide')}>
        <Text style={styles.buttonText}>Join with a Code</Text>
      </Pressable>

      <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => navigation.navigate('PublicZone')}>
        <Text style={styles.buttonText}>Open Public Zone (no code)</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 24, textAlign: 'center' },
  button: { backgroundColor: '#1a73e8', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 12, width: '100%' },
  secondaryButton: { backgroundColor: '#444' },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600', textAlign: 'center' },
});
