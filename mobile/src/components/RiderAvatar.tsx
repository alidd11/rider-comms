import * as React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { getAvatarPreset, type AvatarPreset } from '../settings/avatars';

export type RiderAvatarStatus = 'none' | 'online' | 'stale';

interface RiderAvatarProps {
  avatarId: string;
  size?: number;
  mapMarker?: boolean;
  selected?: boolean;
  status?: RiderAvatarStatus;
}

// Shared side-on artwork geometry (64px master). docs/avatar-system.js
// mirrors these constants; scripts/check-avatar-system.mjs keeps them equal.
const MAP_TAIL_PATH = 'M24 56h16L32 70 24 56Z';
const HELMET_SHELL_PATH = 'M14 46C11 40 10.5 33 12 27C14.5 17 23 11 33 11C43 11 51 16 54 25L56.5 35C57.2 38.5 56 42 53 44.5L47 48.5C44.5 50 41.5 49.6 39.5 47.5C37 45 33 43.6 29 44.2L20 46C18 46.4 15.5 46.8 14 46Z';
const HELMET_VISOR_PATH = 'M32.5 21.5C40 19.2 48 19.6 53.6 22.6L55.6 31.2C49 33.2 40.5 33.3 34.5 31.2C31.4 28.6 31 24.2 32.5 21.5Z';
const HELMET_TRIM_PATH = 'M14 46C16 44 22 42.5 29 42.3C33.5 42.2 37 43.5 39.5 45.7V47.5C37 45 33 43.6 29 44.2L20 46C18 46.4 15.5 46.8 14 46ZM12.5 27.5C10.4 26.4 9 24.6 9.2 22.4L13.8 21.2C14.2 23.4 13.7 25.6 12.5 27.5Z';
const HELMET_VENT_PATH = 'M46.5 38.2L53.2 36.6M46.4 41.6L51.6 40.2M13.2 35.6L31.6 31.4';
const HELMET_GLOSS_PATH = 'M18.5 19C22 15.2 27 13.2 33 13.2';
const HELMET_VISOR_GLINT_PATH = 'M35 24C41 22.4 47.5 22.8 52.5 25';
const HELMET_MOTIF_TRANSFORM = 'translate(8.5 15) scale(.42)';
const GROUND_Y = 49.5;
const REAR_WHEEL_X = 19;
const FRONT_WHEEL_X = 45;

export function mixColour(hex: string, toward: string, amount: number): string {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(toward.slice(1), 16);
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount);
  return `#${((1 << 24) | (channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).slice(1).toUpperCase()}`;
}

function Wheel({ cx, radius }: { cx: number; radius: number }): React.JSX.Element {
  const cy = GROUND_Y - radius;
  return (
    <>
      <Circle cx={cx} cy={cy} r={radius} fill="#0A1014" stroke="#2C3A41" strokeWidth="1" />
      <Circle cx={cx} cy={cy} r={Number((radius * 0.6).toFixed(2))} fill="#1A262C" stroke="#B4C3C9" strokeWidth="1.1" />
      <Circle cx={cx} cy={cy} r="1.6" fill="#DCE6EA" />
    </>
  );
}

function HelmetArtwork({ preset, uid }: { preset: AvatarPreset; uid: string }): React.JSX.Element {
  return (
    <>
      <Ellipse cx="32" cy="50.5" rx="19" ry="2.2" fill="#000" opacity="0.35" />
      <Path d={HELMET_SHELL_PATH} fill={`url(#rc-paint-${uid})`} stroke={preset.secondary} strokeWidth="1" />
      <Path d={HELMET_TRIM_PATH} fill={preset.secondary} />
      {preset.motifPath ? <G transform={HELMET_MOTIF_TRANSFORM}><Path d={preset.motifPath} fill={preset.motifFill ?? '#F4F7F8'} /></G> : null}
      <Path d={HELMET_VISOR_PATH} fill={`url(#rc-glass-${uid})`} stroke="#071015" strokeWidth="1.2" />
      <Path d={HELMET_VISOR_GLINT_PATH} fill="none" stroke="#FFFFFF" strokeWidth="1.3" strokeLinecap="round" opacity="0.45" />
      <Circle cx="32.2" cy="27.6" r="1.8" fill={preset.accent} />
      <Path d={HELMET_VENT_PATH} fill="none" stroke={preset.secondary} strokeWidth="1.6" strokeLinecap="round" />
      <Path d={HELMET_GLOSS_PATH} fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" opacity="0.5" />
    </>
  );
}

function MotorbikeArtwork({ preset, uid }: { preset: AvatarPreset; uid: string }): React.JSX.Element {
  const radius = preset.wheelRadius ?? 7.5;
  return (
    <>
      <Ellipse cx="32" cy="50.5" rx="22" ry="2" fill="#000" opacity="0.35" />
      <Wheel cx={REAR_WHEEL_X} radius={radius} />
      <Wheel cx={FRONT_WHEEL_X} radius={radius} />
      {preset.detailPath ? <Path d={preset.detailPath} fill="none" stroke="#9FB0B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {preset.trimPath ? <Path d={preset.trimPath} fill="#27343B" stroke="#4A5A62" strokeWidth="0.8" strokeLinejoin="round" /> : null}
      {preset.bodyPath ? <Path d={preset.bodyPath} fill={`url(#rc-paint-${uid})`} stroke={preset.secondary} strokeWidth="1" strokeLinejoin="round" /> : null}
      {preset.seatPath ? <Path d={preset.seatPath} fill="#0E171C" /> : null}
      {preset.glassPath ? <Path d={preset.glassPath} fill={`url(#rc-glass-${uid})`} stroke="#9FD9E6" strokeWidth="0.6" opacity="0.95" /> : null}
      {preset.accentPath ? <Path d={preset.accentPath} fill={preset.accent} /> : null}
    </>
  );
}

// Headlights stay light even where a preset's accent is the dark ink.
function carLampColour(preset: AvatarPreset): string {
  return preset.accent === '#071015' ? '#EAF8FB' : preset.accent;
}

function CarArtwork({ preset, uid }: { preset: AvatarPreset; uid: string }): React.JSX.Element {
  const radius = preset.wheelRadius ?? 5.5;
  return (
    <>
      <Ellipse cx="32" cy="50" rx="24" ry="2" fill="#000" opacity="0.35" />
      {preset.trimPath ? <Path d={preset.trimPath} fill="#1C272D" stroke="#3E4D55" strokeWidth="0.7" /> : null}
      {preset.bodyPath ? <Path d={preset.bodyPath} fill={`url(#rc-paint-${uid})`} stroke={preset.secondary} strokeWidth="1" strokeLinejoin="round" /> : null}
      {preset.glassPath ? <Path d={preset.glassPath} fill={`url(#rc-glass-${uid})`} stroke="#071015" strokeWidth="0.6" /> : null}
      {preset.detailPath ? <Path d={preset.detailPath} fill="none" stroke={preset.secondary} strokeWidth="1" strokeLinecap="round" opacity="0.8" /> : null}
      {preset.accentPath ? <Path d={preset.accentPath} fill={carLampColour(preset)} /> : null}
      {preset.tailPath ? <Path d={preset.tailPath} fill="#FF4D55" /> : null}
      <Wheel cx={REAR_WHEEL_X} radius={radius} />
      <Wheel cx={FRONT_WHEEL_X} radius={radius} />
    </>
  );
}

/**
 * Canonical native renderer for every Rider Comms avatar family.
 *
 * PWA riderAvatarSvg() mirrors these exact viewBox coordinates, layers and
 * path constants. The selected/live/stale decoration is outside the master
 * artwork so the rider identity remains the same in Settings, social surfaces
 * and map markers.
 */
export function RiderAvatar({
  avatarId,
  size = 44,
  mapMarker = false,
  selected = false,
  status = 'none',
}: RiderAvatarProps): React.JSX.Element {
  const preset = getAvatarPreset(avatarId);
  // Gradient ids only need to be unique inside this Svg.
  const uid = preset.id;
  const viewBoxHeight = mapMarker ? 72 : 64;
  const renderedHeight = size * (viewBoxHeight / 64);
  const stroke = selected ? '#22D3EE' : preset.bg;
  const tailFill = selected ? '#22D3EE' : '#071015';
  const statusFill = status === 'online' ? '#35E68A' : status === 'stale' ? '#78909A' : null;

  return (
    <View style={[styles.root, { width: size, height: renderedHeight }]} pointerEvents="none">
      <Svg width={size} height={renderedHeight} viewBox={`0 0 64 ${viewBoxHeight}`}>
        <Defs>
          <RadialGradient id={`rc-disc-${uid}`} cx="32" cy="20" r="36" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={mixColour(preset.bg, '#0B1419', 0.78)} />
            <Stop offset="1" stopColor="#060D11" />
          </RadialGradient>
          <LinearGradient id={`rc-paint-${uid}`} x1="0" y1="10" x2="0" y2="50" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={mixColour(preset.bg, '#FFFFFF', 0.38)} />
            <Stop offset="0.5" stopColor={preset.bg} />
            <Stop offset="1" stopColor={preset.secondary} />
          </LinearGradient>
          <LinearGradient id={`rc-glass-${uid}`} x1="0" y1="12" x2="0" y2="36" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#7FA9B8" />
            <Stop offset="0.45" stopColor="#1B3540" />
            <Stop offset="1" stopColor="#071015" />
          </LinearGradient>
          <ClipPath id={`rc-clip-${uid}`}>
            <Circle cx="32" cy="32" r="28.5" />
          </ClipPath>
        </Defs>
        {mapMarker ? <Path d={MAP_TAIL_PATH} fill={tailFill} stroke="#071015" strokeWidth="2" /> : null}
        <Circle cx="32" cy="32" r="30" fill={`url(#rc-disc-${uid})`} stroke={stroke} strokeWidth={selected ? 3 : 2} />
        {selected ? <Circle cx="32" cy="32" r="27.5" fill="none" stroke="#22D3EE" strokeWidth="1" opacity="0.55" /> : null}

        <G clipPath={`url(#rc-clip-${uid})`}>
          {preset.family === 'helmet' ? <HelmetArtwork preset={preset} uid={uid} /> : null}
          {preset.family === 'motorbike' ? <MotorbikeArtwork preset={preset} uid={uid} /> : null}
          {preset.family === 'car' ? <CarArtwork preset={preset} uid={uid} /> : null}
        </G>

        {status === 'stale' ? <Circle cx="32" cy="32" r="26.5" fill="#071015" opacity="0.44" /> : null}
        {statusFill ? (
          <>
            <Circle cx="51" cy="49" r="7" fill="#071015" />
            <Circle cx="51" cy="49" r="4.8" fill={statusFill} />
          </>
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexShrink: 0,
  },
});
