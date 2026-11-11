import * as React from 'react';
import Svg, { Circle } from 'react-native-svg';

/**
 * Nearby riders: you at the centre of a radar, riders as dots around you.
 * Same drawing as the PWA's #i-nearby symbol in docs/index.html.
 */
export function NearbyRidersIcon({ size = 24, color }: { size?: number; color: string }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
      <Circle cx={12} cy={12} r={10} opacity={0.45} />
      <Circle cx={12} cy={12} r={5.6} />
      <Circle cx={12} cy={12} r={2} fill={color} stroke="none" />
      <Circle cx={19.1} cy={4.9} r={2.1} fill={color} stroke="none" />
      <Circle cx={4.9} cy={19.1} r={2.1} fill={color} stroke="none" />
    </Svg>
  );
}
