// Unverified scaffold — see navigation/index.tsx header note.
//
// TODO(native): the actual voice connection (LiveKit room join/publish/
// subscribe) isn't wired in here — that needs livekit-react-native, a
// running LiveKit server, and a real device, none of which this sandbox
// has. This screen wires up the AudioEngine's priority/ducking state
// (real, tested logic) around where that connection would plug in.
import * as React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { AudioEngine } from '../audio/audioEngine';

type Props = NativeStackScreenProps<RootStackParamList, 'Ride'>;

export function RideScreen({ route }: Props): React.JSX.Element {
  const { rideId, code } = route.params;
  const audioEngineRef = React.useRef(new AudioEngine());
  const [gains, setGains] = React.useState(audioEngineRef.current.getGains());
  const [muted, setMuted] = React.useState(false);

  React.useEffect(() => {
    return audioEngineRef.current.onGainsChanged(setGains);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>In Ride</Text>
      {code && <Text style={styles.code}>Share code: {code}</Text>}
      <Text style={styles.rideId}>Ride ID: {rideId}</Text>

      <View style={styles.gainsBox}>
        <Text style={styles.gainsLabel}>Audio mixer (nav {'>'} chat {'>'} music)</Text>
        <Text>nav: {gains.nav.toFixed(2)}</Text>
        <Text>chat: {gains.chat.toFixed(2)}</Text>
        <Text>music: {gains.music.toFixed(2)}</Text>
      </View>

      <Pressable
        style={[styles.muteButton, muted && styles.muteButtonActive]}
        onPress={() => {
          setMuted((m) => !m);
          audioEngineRef.current.setChatActive(!muted);
        }}
      >
        <Text style={styles.buttonText}>{muted ? 'Unmute (test)' : 'Simulate someone talking'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  title: { fontSize: 22, fontWeight: '700' },
  code: { fontSize: 16, color: '#1a73e8' },
  rideId: { fontSize: 12, color: '#999' },
  gainsBox: { backgroundColor: '#f4f4f4', padding: 16, borderRadius: 12, gap: 4 },
  gainsLabel: { fontWeight: '600', marginBottom: 4 },
  muteButton: { backgroundColor: '#444', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  muteButtonActive: { backgroundColor: '#1a73e8' },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});
