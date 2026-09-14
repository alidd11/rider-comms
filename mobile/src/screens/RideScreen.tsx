// Unverified scaffold — see navigation/index.tsx header note.
//
// TODO(native): the actual voice connection (LiveKit room join/publish/
// subscribe) isn't wired in here — that needs livekit-react-native, a
// running LiveKit server, and a real device, none of which this sandbox
// has. This screen wires up the AudioEngine's priority/ducking state
// (real, tested logic) around where that connection would plug in.
import * as React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { AudioEngine } from '../audio/audioEngine';
import { colors, spacing, radii, type, MIN_TOUCH_TARGET } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Ride'>;

const CHANNELS: Array<{ key: 'nav' | 'chat' | 'music'; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'nav', label: 'Navigation', icon: 'navigate' },
  { key: 'chat', label: 'Group Chat', icon: 'people' },
  { key: 'music', label: 'Music', icon: 'musical-notes' },
];

function GainBar({ value }: { value: number }): React.JSX.Element {
  return (
    <View style={styles.gainTrack}>
      <View style={[styles.gainFill, { width: `${Math.round(value * 100)}%` }]} />
    </View>
  );
}

export function RideScreen({ route, navigation }: Props): React.JSX.Element {
  const { rideId, code } = route.params;
  const audioEngineRef = React.useRef(new AudioEngine());
  const [gains, setGains] = React.useState(audioEngineRef.current.getGains());
  const [talking, setTalking] = React.useState(false);

  React.useEffect(() => {
    return audioEngineRef.current.onGainsChanged(setGains);
  }, []);

  const handleLeave = React.useCallback(() => {
    navigation.popToTop();
  }, [navigation]);

  return (
    <View style={styles.container}>
      <View style={styles.statusRow}>
        <View style={styles.liveDot} />
        <Text style={styles.statusText}>In ride</Text>
      </View>

      {code && (
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>Share code</Text>
          <Text style={styles.codeValue}>{code}</Text>
        </View>
      )}
      <Text style={styles.rideId}>Ride ID: {rideId}</Text>

      <View style={styles.mixerCard}>
        <Text style={styles.mixerLabel}>Audio priority — nav overrides chat overrides music</Text>
        {CHANNELS.map(({ key, label, icon }) => (
          <View key={key} style={styles.gainRow}>
            <Ionicons name={icon} size={18} color={colors.textSecondary} style={styles.gainIcon} />
            <Text style={styles.gainLabel}>{label}</Text>
            <GainBar value={gains[key]} />
          </View>
        ))}
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.talkButton,
          talking && styles.talkButtonActive,
          pressed && styles.talkButtonPressed,
        ]}
        onPress={() => {
          setTalking((t) => !t);
          audioEngineRef.current.setChatActive(!talking);
        }}
      >
        <Ionicons name={talking ? 'mic' : 'mic-outline'} size={22} color={colors.textPrimary} />
        <Text style={styles.talkButtonText}>{talking ? 'Talking (test)' : 'Simulate someone talking'}</Text>
      </Pressable>

      <Pressable style={({ pressed }) => [styles.leaveButton, pressed && styles.leaveButtonPressed]} onPress={handleLeave}>
        <Ionicons name="exit-outline" size={20} color={colors.danger} />
        <Text style={styles.leaveButtonText}>Leave Ride</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success },
  statusText: { ...type.caption, color: colors.success, textTransform: 'uppercase', letterSpacing: 1 },
  codeCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    alignItems: 'center',
  },
  codeLabel: { ...type.caption },
  codeValue: { fontSize: 32, fontWeight: '800', letterSpacing: 6, color: colors.accent, marginTop: spacing.xs },
  rideId: { ...type.caption },
  mixerCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radii.lg,
    gap: spacing.md,
  },
  mixerLabel: { ...type.caption, marginBottom: spacing.xs },
  gainRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  gainIcon: { width: 18 },
  gainLabel: { ...type.body, color: colors.textPrimary, width: 90 },
  gainTrack: { flex: 1, height: 8, borderRadius: radii.pill, backgroundColor: colors.border, overflow: 'hidden' },
  gainFill: { height: '100%', backgroundColor: colors.accent, borderRadius: radii.pill },
  talkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    marginTop: 'auto',
  },
  talkButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  talkButtonPressed: { opacity: 0.85 },
  talkButtonText: { ...type.button, color: colors.textPrimary },
  leaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  leaveButtonPressed: { backgroundColor: colors.dangerSurface },
  leaveButtonText: { ...type.button, color: colors.danger },
});
