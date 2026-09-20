import * as React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { getAvatarPreset } from '../settings/avatars';

export type RiderAvatarStatus = 'none' | 'online' | 'stale';

interface RiderAvatarProps {
  avatarId: string;
  size?: number;
  mapMarker?: boolean;
  selected?: boolean;
  status?: RiderAvatarStatus;
}

const MAP_TAIL_PATH = 'M24 56h16L32 70 24 56Z';
const HELMET_LOWER_SHELL_PATH = 'M9 32c1 16 9 25 23 29 14-4 22-13 23-29l-8 13-15 8-15-8-8-13Z';
const HELMET_VISOR_PATH = 'M10 27c5-6 39-6 44 0l-3 16c-7 5-31 5-38 0l-3-16Z';
const HELMET_GLOSS_PATH = 'M17 16c7-7 19-9 29-4';
const MOTORBIKE_HANDLEBAR_PATH = 'M14 25c7-2 10-2 14 0M36 25c4-2 7-2 14 0';
const MOTORBIKE_WHEEL_PATH = 'M28 36c0 10 1 20 4 22 3-2 4-12 4-22Z';
const CAR_WHEELS_PATH = 'M14 20h4v10h-4ZM46 20h4v10h-4ZM14 36h4v10h-4ZM46 36h4v10h-4Z';

function HelmetArtwork({ preset }: { preset: ReturnType<typeof getAvatarPreset> }): React.JSX.Element {
  return (
    <>
      <Circle cx="32" cy="32" r="25.5" fill={preset.bg} />
      <Path d={HELMET_LOWER_SHELL_PATH} fill={preset.secondary} />
      <Path d={HELMET_GLOSS_PATH} fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" opacity="0.28" />
      <Path d={HELMET_VISOR_PATH} fill="#020A0E" stroke="#162A31" strokeWidth="1.4" />
      <Path d="M18 34c3-3 6-3 8 1-2 5-5 6-8-1ZM46 34c-3-3-6-3-8 1 2 5 5 6 8-1Z" fill={preset.accent} />
      <Path d="M18 47c8 6 20 6 28 0" fill="none" stroke="#071015" strokeWidth="2.4" strokeLinecap="round" />
      {preset.motifPath ? <Path d={preset.motifPath} fill={preset.motifFill ?? '#F4F7F8'} /> : null}
    </>
  );
}

function MotorbikeArtwork({ preset }: { preset: ReturnType<typeof getAvatarPreset> }): React.JSX.Element {
  return (
    <>
      <Circle cx="32" cy="32" r="25" fill="#0B1419" stroke={preset.bg} strokeWidth="1.8" />
      <Path d={MOTORBIKE_HANDLEBAR_PATH} fill="none" stroke="#B9C8CF" strokeWidth="2.1" strokeLinecap="round" />
      <Path d={MOTORBIKE_WHEEL_PATH} fill="#070C10" stroke="#A7B5BC" strokeWidth="1.2" />
      {preset.bodyPath ? <Path d={preset.bodyPath} fill={preset.bg} stroke={preset.secondary} strokeWidth="1.6" strokeLinejoin="round" /> : null}
      {preset.glassPath ? <Path d={preset.glassPath} fill="#071015" stroke="#A8DDE8" strokeWidth="1" opacity="0.96" /> : null}
      {preset.detailPath ? <Path d={preset.detailPath} fill="none" stroke={preset.accent} strokeWidth="1.6" strokeLinecap="round" /> : null}
      <Circle cx="32" cy="32" r="2.8" fill={preset.accent} />
      <Path d="M24 17c5-5 11-5 16 0" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.22" />
    </>
  );
}

function CarArtwork({ preset }: { preset: ReturnType<typeof getAvatarPreset> }): React.JSX.Element {
  return (
    <>
      <Circle cx="32" cy="32" r="25" fill="#0B1419" stroke={preset.bg} strokeWidth="1.8" />
      <Path d={CAR_WHEELS_PATH} fill="#05090C" stroke="#62717A" strokeWidth="0.9" />
      {preset.bodyPath ? <Path d={preset.bodyPath} fill={preset.bg} stroke={preset.secondary} strokeWidth="1.6" strokeLinejoin="round" /> : null}
      {preset.glassPath ? <Path d={preset.glassPath} fill="#071015" stroke="#9FDCE8" strokeWidth="1" opacity="0.95" /> : null}
      {preset.detailPath ? <Path d={preset.detailPath} fill="none" stroke={preset.accent} strokeWidth="1.35" strokeLinecap="round" /> : null}
      <Path d="M24 12c5-3 11-3 16 0" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.24" />
    </>
  );
}

/**
 * Canonical native renderer for every Rider Comms avatar family.
 *
 * PWA riderAvatarSvg() mirrors these exact viewBox coordinates and path
 * constants. The selected/live/stale decoration is outside the master artwork
 * so the rider identity remains the same in Settings, social surfaces and map
 * markers.
 */
export function RiderAvatar({
  avatarId,
  size = 44,
  mapMarker = false,
  selected = false,
  status = 'none',
}: RiderAvatarProps): React.JSX.Element {
  const preset = getAvatarPreset(avatarId);
  const viewBoxHeight = mapMarker ? 72 : 64;
  const renderedHeight = size * (viewBoxHeight / 64);
  const normalStroke = preset.family === 'helmet' ? '#DFF7FB' : preset.bg;
  const stroke = selected ? '#22D3EE' : normalStroke;
  const tailFill = selected ? '#22D3EE' : '#071015';
  const statusFill = status === 'online' ? '#35E68A' : status === 'stale' ? '#78909A' : null;

  return (
    <View style={[styles.root, { width: size, height: renderedHeight }]} pointerEvents="none">
      <Svg width={size} height={renderedHeight} viewBox={`0 0 64 ${viewBoxHeight}`}>
        {mapMarker ? <Path d={MAP_TAIL_PATH} fill={tailFill} stroke="#071015" strokeWidth="2" /> : null}
        <Circle cx="32" cy="32" r="30" fill="#071015" stroke={stroke} strokeWidth={selected ? 3 : 2} />
        {selected ? <Circle cx="32" cy="32" r="27.5" fill="none" stroke="#22D3EE" strokeWidth="1" opacity="0.55" /> : null}

        {preset.family === 'helmet' ? <HelmetArtwork preset={preset} /> : null}
        {preset.family === 'motorbike' ? <MotorbikeArtwork preset={preset} /> : null}
        {preset.family === 'car' ? <CarArtwork preset={preset} /> : null}

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
