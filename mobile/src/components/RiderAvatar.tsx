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
 * One deterministic avatar renderer for every native surface.
 *
 * Profile/list/map variants all render the exact same 64x64 face geometry.
 * Map state is deliberately outside that geometry: only the pin tail, cyan
 * selection ring and status dot change. This keeps a rider recognisable when
 * the avatar shrinks from a profile card to a live map marker.
 */
export function RiderAvatar({
  avatarId,
  size = 44,
  mapMarker = false,
  selected = false,
  status = 'none',
}: RiderAvatarProps): React.JSX.Element {
  const preset = getAvatarPreset(avatarId);
  const markerTail = Math.max(7, Math.round(size * 0.2));
  const statusSize = Math.max(8, Math.round(size * 0.22));
  const stroke = selected ? '#22D3EE' : '#EAF8FB';

  return (
    <View
      style={[
        styles.root,
        {
          width: size,
          height: mapMarker ? size + Math.round(markerTail * 0.72) : size,
        },
      ]}
      pointerEvents="none"
    >
      {mapMarker ? (
        <View
          style={[
            styles.tail,
            {
              width: markerTail,
              height: markerTail,
              left: (size - markerTail) / 2,
              bottom: 1,
              backgroundColor: selected ? '#22D3EE' : '#071015',
              borderBottomRightRadius: Math.max(1, Math.round(markerTail * 0.12)),
            },
          ]}
        />
      ) : null}

      <View
        style={[
          styles.face,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
          },
          selected && styles.faceSelected,
        ]}
      >
        <Svg width={size} height={size} viewBox="0 0 64 64">
          <Circle cx="32" cy="32" r="30" fill="#071015" stroke={stroke} strokeWidth={selected ? 3 : 2} />
          <Circle cx="32" cy="32" r="25.5" fill={preset.bg} />
          <Path
            d="M13 30.5C18 25 46 25 51 30.5L48 42.5C42.5 47 21.5 47 16 42.5L13 30.5Z"
            fill="#071015"
          />
          <Circle cx="24.5" cy="36" r="2.7" fill="#22D3EE" />
          <Circle cx="39.5" cy="36" r="2.7" fill="#22D3EE" />
          <Path d="M24 49C28.8 52 35.2 52 40 49" fill="none" stroke="#071015" strokeWidth="2.2" strokeLinecap="round" />
          <Path d={preset.motifPath} fill={preset.motifFill ?? '#F4F7F8'} />
        </Svg>
      </View>

      {status !== 'none' ? (
        <View
          style={[
            styles.status,
            {
              width: statusSize,
              height: statusSize,
              borderRadius: statusSize / 2,
              right: -Math.round(statusSize * 0.08),
              top: size - statusSize + Math.round(statusSize * 0.04),
              backgroundColor: status === 'online' ? '#35E68A' : '#78909A',
              borderWidth: Math.max(2, Math.round(size * 0.05)),
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'relative',
    flexShrink: 0,
    alignItems: 'center',
  },
  face: {
    overflow: 'hidden',
    backgroundColor: '#071015',
  },
  faceSelected: {
    shadowColor: '#22D3EE',
    shadowOpacity: 0.55,
    shadowRadius: 8,
    elevation: 5,
  },
  tail: {
    position: 'absolute',
    transform: [{ rotate: '45deg' }],
  },
  status: {
    position: 'absolute',
    borderColor: '#071015',
  },
});
