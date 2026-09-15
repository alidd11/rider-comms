// Unverified scaffold — see navigation/index.tsx header note.
//
// TODO(native): the actual voice connection (LiveKit room join/publish/
// subscribe) isn't wired in here — that needs livekit-react-native, a
// running LiveKit server, and a real device, none of which this sandbox
// has. This wires up the AudioEngine's priority/ducking state (real,
// tested logic) around where that connection would plug in.
import * as React from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { AudioEngine } from '../audio/audioEngine';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { useRide } from './RideContext';

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

/**
 * Floating "mini-player"-style bar for an active ride, visible over every
 * tab (à la a music app's now-playing bar) instead of taking over the whole
 * screen — tap it to expand the full mixer + leave-ride controls.
 */
export function RideBar(): React.JSX.Element | null {
  const { activeRide, leaveRide } = useRide();
  const [expanded, setExpanded] = React.useState(false);
  const audioEngineRef = React.useRef(new AudioEngine());
  const [gains, setGains] = React.useState(audioEngineRef.current.getGains());
  const [talking, setTalking] = React.useState(false);

  React.useEffect(() => {
    return audioEngineRef.current.onGainsChanged(setGains);
  }, []);

  if (!activeRide) return null;

  const handleLeave = () => {
    setExpanded(false);
    void leaveRide();
  };

  return (
    <>
      <Pressable style={({ pressed }) => [styles.bar, pressed && styles.barPressed]} onPress={() => setExpanded(true)}>
        <View style={styles.liveDot} />
        <MaterialCommunityIcons name="motorbike" size={18} color={colors.accent} />
        <Text style={styles.barText}>In ride{activeRide.code ? ` · ${activeRide.code}` : ''}</Text>
        <Ionicons name="chevron-up" size={18} color={colors.textSecondary} />
      </Pressable>

      <Modal visible={expanded} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setExpanded(false)}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View style={styles.statusRow}>
              <View style={styles.liveDot} />
              <Text style={styles.statusText}>In ride</Text>
            </View>
            <Pressable onPress={() => setExpanded(false)} style={styles.closeButton}>
              <Ionicons name="chevron-down" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          {activeRide.code && (
            <View style={styles.codeCard}>
              <Text style={styles.codeLabel}>Share code</Text>
              <Text style={styles.codeValue}>{activeRide.code}</Text>
            </View>
          )}
          <Text style={styles.rideId}>Ride ID: {activeRide.rideId}</Text>

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
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    ...elevation.raised,
  },
  barPressed: { opacity: 0.85 },
  barText: { ...type.body, color: colors.textPrimary, flex: 1 },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success },
  sheet: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeButton: { padding: spacing.xs },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusText: { ...type.label, color: colors.success },
  codeCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    alignItems: 'center',
    ...elevation.raised,
  },
  codeLabel: { ...type.caption },
  codeValue: { fontSize: 32, fontWeight: '800', letterSpacing: 6, color: colors.accent, marginTop: spacing.xs },
  rideId: { ...type.caption },
  mixerCard: { backgroundColor: colors.surface, padding: spacing.md, borderRadius: radii.lg, gap: spacing.md },
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
