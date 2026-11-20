import * as React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * Go live: a rider broadcasting to riders nearby — a rider with signal
 * arcs either side, drawn at the same weight as the hazard button's icon so
 * the map's controls read as one set. Same drawing as the PWA's #i-nearby
 * symbol in docs/index.html.
 */
export function NearbyRidersIcon({ size = 24, color }: { size?: number; color: string }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={12} cy={8.4} r={2.5} fill={color} stroke="none" />
      <Path d="M7.9 17.4c.5-2.5 2.1-3.9 4.1-3.9s3.6 1.4 4.1 3.9" />
      <Path d="M5.1 6.6a8 8 0 0 0 0 9.8M18.9 6.6a8 8 0 0 1 0 9.8" />
    </Svg>
  );
}
