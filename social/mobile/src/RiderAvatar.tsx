import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import {
  FRONT_WHEEL_X, getAvatarPreset, GROUND_Y, HELMET_GLOSS_PATH, HELMET_MOTIF_TRANSFORM, HELMET_SHELL_PATH,
  HELMET_TRIM_PATH, HELMET_VENT_PATH, HELMET_VISOR_GLINT_PATH, HELMET_VISOR_PATH, REAR_WHEEL_X,
} from '../../../shared/src/avatars.ts';
import type { AvatarPreset } from '../../../shared/src/avatars.ts';

/**
 * The rider's Rider Comms avatar, drawn from the same artwork as the main
 * app (shared/src/avatars.ts; native: mobile/src/components/RiderAvatar.tsx,
 * PWA: docs/avatar-system.js). Same layers and coordinates, so a rider looks
 * the same in both apps.
 */
export function mixColour(hex: string, toward: string, amount: number): string {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(toward.slice(1), 16);
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount);
  return `#${((1 << 24) | (channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).slice(1).toUpperCase()}`;
}

function Wheel({ cx, radius }: { cx: number; radius: number }) {
  const cy = GROUND_Y - radius;
  return <>
    <Circle cx={cx} cy={cy} r={radius} fill="#0A1014" stroke="#2C3A41" strokeWidth="1"/>
    <Circle cx={cx} cy={cy} r={Number((radius * 0.6).toFixed(2))} fill="#1A262C" stroke="#B4C3C9" strokeWidth="1.1"/>
    <Circle cx={cx} cy={cy} r="1.6" fill="#DCE6EA"/>
  </>;
}

function Artwork({ preset, uid }: { preset: AvatarPreset; uid: string }) {
  if (preset.family === 'helmet') return <>
    <Ellipse cx="32" cy="50.5" rx="19" ry="2.2" fill="#000" opacity="0.35"/>
    <Path d={HELMET_SHELL_PATH} fill={`url(#rc-paint-${uid})`} stroke={preset.secondary} strokeWidth="1"/>
    <Path d={HELMET_TRIM_PATH} fill={preset.secondary}/>
    {preset.motifPath ? <G transform={HELMET_MOTIF_TRANSFORM}><Path d={preset.motifPath} fill={preset.motifFill ?? '#F4F7F8'}/></G> : null}
    <Path d={HELMET_VISOR_PATH} fill={`url(#rc-glass-${uid})`} stroke="#071015" strokeWidth="1.2"/>
    <Path d={HELMET_VISOR_GLINT_PATH} fill="none" stroke="#FFFFFF" strokeWidth="1.3" strokeLinecap="round" opacity="0.45"/>
    <Circle cx="32.2" cy="27.6" r="1.8" fill={preset.accent}/>
    <Path d={HELMET_VENT_PATH} fill="none" stroke={preset.secondary} strokeWidth="1.6" strokeLinecap="round"/>
    <Path d={HELMET_GLOSS_PATH} fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" opacity="0.5"/>
  </>;
  const car = preset.family === 'car';
  const radius = preset.wheelRadius ?? (car ? 5.5 : 7.5);
  const wheels = <><Wheel cx={REAR_WHEEL_X} radius={radius}/><Wheel cx={FRONT_WHEEL_X} radius={radius}/></>;
  if (!car) return <>
    <Ellipse cx="32" cy="50.5" rx="22" ry="2" fill="#000" opacity="0.35"/>
    {wheels}
    {preset.detailPath ? <Path d={preset.detailPath} fill="none" stroke="#9FB0B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/> : null}
    {preset.trimPath ? <Path d={preset.trimPath} fill="#27343B" stroke="#4A5A62" strokeWidth="0.8" strokeLinejoin="round"/> : null}
    {preset.bodyPath ? <Path d={preset.bodyPath} fill={`url(#rc-paint-${uid})`} stroke={preset.secondary} strokeWidth="1" strokeLinejoin="round"/> : null}
    {preset.seatPath ? <Path d={preset.seatPath} fill="#0E171C"/> : null}
    {preset.glassPath ? <Path d={preset.glassPath} fill={`url(#rc-glass-${uid})`} stroke="#9FD9E6" strokeWidth="0.6" opacity="0.95"/> : null}
    {preset.accentPath ? <Path d={preset.accentPath} fill={preset.accent}/> : null}
  </>;
  // Headlights stay light even where a preset's accent is the dark ink.
  const lamp = preset.accent === '#071015' ? '#EAF8FB' : preset.accent;
  return <>
    <Ellipse cx="32" cy="50" rx="24" ry="2" fill="#000" opacity="0.35"/>
    {preset.trimPath ? <Path d={preset.trimPath} fill="#1C272D" stroke="#3E4D55" strokeWidth="0.7"/> : null}
    {preset.bodyPath ? <Path d={preset.bodyPath} fill={`url(#rc-paint-${uid})`} stroke={preset.secondary} strokeWidth="1" strokeLinejoin="round"/> : null}
    {preset.glassPath ? <Path d={preset.glassPath} fill={`url(#rc-glass-${uid})`} stroke="#071015" strokeWidth="0.6"/> : null}
    {preset.detailPath ? <Path d={preset.detailPath} fill="none" stroke={preset.secondary} strokeWidth="1" strokeLinecap="round" opacity="0.8"/> : null}
    {preset.accentPath ? <Path d={preset.accentPath} fill={lamp}/> : null}
    {preset.tailPath ? <Path d={preset.tailPath} fill="#FF4D55"/> : null}
    {wheels}
  </>;
}

export function RiderAvatar({ avatarId, size = 44 }: { avatarId: string; size?: number }) {
  const preset = getAvatarPreset(avatarId);
  const uid = preset.id;
  return <View style={{ width: size, height: size, flexShrink: 0 }} pointerEvents="none">
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <RadialGradient id={`rc-disc-${uid}`} cx="32" cy="20" r="36" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={mixColour(preset.bg, '#0B1419', 0.78)}/>
          <Stop offset="1" stopColor="#060D11"/>
        </RadialGradient>
        <LinearGradient id={`rc-paint-${uid}`} x1="0" y1="10" x2="0" y2="50" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={mixColour(preset.bg, '#FFFFFF', 0.38)}/>
          <Stop offset="0.5" stopColor={preset.bg}/>
          <Stop offset="1" stopColor={preset.secondary}/>
        </LinearGradient>
        <LinearGradient id={`rc-glass-${uid}`} x1="0" y1="12" x2="0" y2="36" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#7FA9B8"/>
          <Stop offset="0.45" stopColor="#1B3540"/>
          <Stop offset="1" stopColor="#071015"/>
        </LinearGradient>
        <ClipPath id={`rc-clip-${uid}`}><Circle cx="32" cy="32" r="28.5"/></ClipPath>
      </Defs>
      <Circle cx="32" cy="32" r="30" fill={`url(#rc-disc-${uid})`} stroke={preset.bg} strokeWidth="2"/>
      <G clipPath={`url(#rc-clip-${uid})`}><Artwork preset={preset} uid={uid}/></G>
    </Svg>
  </View>;
}
