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

/**
 * Canonical native renderer for the Rider Comms avatar master.
 *
 * PWA riderAvatarSvg() mirrors these exact viewBox coordinates. Profile,
 * social and map variants therefore use the same face, motif, pin tail and
 * status-dot geometry rather than merely looking similar.
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
  const stroke = selected ? '#22D3EE' : '#EAF8FB';
  const tailFill = selected ? '#22D3EE' : '#071015';
  const statusFill = status === 'online' ? '#35E68A' : status === 'stale' ? '#78909A' : null;

  return (
    <View
      style={[styles.root, { width: size, height: renderedHeight }]}
      pointerEvents="none"
    >
      <Svg width={size} height={renderedHeight} viewBox={`0 0 64 ${viewBoxHeight}`}>
        {mapMarker ? (
          <Path
            d="M24 56h16L32 70 24 56Z"
            fill={tailFill}
            stroke="#071015"
            strokeWidth="2"
          />
        ) : null}
        <Circle cx="32" cy="32" r="30" fill="#071015" stroke={stroke} strokeWidth={selected ? 3 : 2} />
        <Circle cx="32" cy="32" r="25.5" fill={preset.bg} />
        <Path
          d="M13 30.5C18 25 46 25 51 30.5L48 42.5C42.5 47 21.5 47 16 42.5L13 30.5Z"
          fill="#071015"
        />
        <Circle cx="24.5" cy="36" r="2.7" fill="#22D3EE" />
        <Circle cx="39.5" cy="36" r="2.7" fill="#22D3EE" />
        <Path
          d="M24 49C28.8 52 35.2 52 40 49"
          fill="none"
          stroke="#071015"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <Path d={preset.motifPath} fill={preset.motifFill ?? '#F4F7F8'} />
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
