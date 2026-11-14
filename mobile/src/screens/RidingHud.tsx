// The riding HUD (PWA: #ridingHud): with Ride Safe on and moving, the map's
// controls give way to speed, a group chip and two glove-sized buttons.
import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { UnitSystem } from '../settings/SettingsContext';
import { colors, spacing } from '../theme';
import { HUD_ACTION_HEIGHT, styles } from './MapScreen.styles';
import { GLANCE_TEXT_MAX_SCALE } from '../navigationTone';

export function RidingHud({
  top,
  bottom,
  inRide,
  rosterCount,
  speed,
  unitSystem,
  voiceConnected,
  voiceMuted,
  onToggleMute,
  onReport,
}: {
  top: number;
  bottom: number;
  inRide: boolean;
  rosterCount: number;
  speed: number | null;
  unitSystem: UnitSystem;
  voiceConnected: boolean;
  voiceMuted: boolean;
  onToggleMute: () => void;
  onReport: () => void;
}): React.JSX.Element {
  return (
    <>
      <View style={[styles.hudChips, { top }]} pointerEvents="none">
        <View style={styles.hudChip} accessible accessibilityRole="text" accessibilityLabel="Ride Safe is on. Distracting controls are locked while moving.">
          <Ionicons name="lock-closed" size={15} color={colors.accent} />
          <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={styles.hudChipText}>Ride Safe</Text>
        </View>
        {inRide && (
          <View style={styles.hudChip} accessible accessibilityRole="text">
            <MaterialCommunityIcons name="account-group" size={16} color={colors.textPrimary} />
            <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={styles.hudChipText}>{rosterCount ? `${rosterCount} in ride` : 'Group ride'}</Text>
          </View>
        )}
      </View>
      <View
        style={[styles.hudSpeed, { bottom: bottom + HUD_ACTION_HEIGHT + spacing.sm }]}
        accessible
        accessibilityRole="text"
        accessibilityLabel={speed == null ? 'Current speed unavailable' : `Current speed ${speed} ${unitSystem === 'km' ? 'kilometres per hour' : 'miles per hour'}`}
      >
        <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={styles.hudSpeedValue}>{speed == null ? '—' : speed}</Text>
        <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={styles.hudSpeedUnit}>{unitSystem === 'km' ? 'km/h' : 'mph'}</Text>
      </View>
      <View style={[styles.hudActions, { bottom }]} testID="riding-hud">
        {voiceConnected && (
          <Pressable
            style={({ pressed }) => [styles.hudButton, voiceMuted && styles.hudButtonActive, pressed && styles.mapActionButtonPressed]}
            onPress={onToggleMute}
            accessibilityRole="button"
            accessibilityState={{ selected: voiceMuted }}
            accessibilityLabel={voiceMuted ? 'Unmute your microphone' : 'Mute your microphone'}
          >
            <Ionicons name={voiceMuted ? 'mic-off' : 'mic'} size={28} color={colors.textPrimary} />
            <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={styles.hudButtonText}>{voiceMuted ? 'Unmute' : 'Mute'}</Text>
          </Pressable>
        )}
        <Pressable
          style={({ pressed }) => [styles.hudButton, styles.hudHazardButton, pressed && styles.mapActionButtonPressed]}
          onPress={onReport}
          accessibilityRole="button"
          accessibilityLabel="Report on the road"
        >
          <MaterialCommunityIcons name="alert-outline" size={28} color="#1F1300" />
          <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={[styles.hudButtonText, styles.hudHazardText]}>Hazard</Text>
        </Pressable>
      </View>
    </>
  );
}
