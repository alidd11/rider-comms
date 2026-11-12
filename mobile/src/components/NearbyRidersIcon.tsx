import * as React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * Go live: you, broadcasting to riders nearby. A solid dot with two signal
 * arcs either side, drawn at the same weight as the hazard button's icon so
 * the map's controls read as one set. Same drawing as the PWA's #i-nearby
 * symbol in docs/index.html.
 */
export function NearbyRidersIcon({ size = 24, color }: { size?: number; color: string }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round">
      <Circle cx={12} cy={12} r={2.6} fill={color} stroke="none" />
      <Path d="M8.3 8.3a5.2 5.2 0 0 0 0 7.4M15.7 8.3a5.2 5.2 0 0 1 0 7.4" />
      <Path d="M5.2 5.2a9.6 9.6 0 0 0 0 13.6M18.8 5.2a9.6 9.6 0 0 1 0 13.6" />
    </Svg>
  );
}
