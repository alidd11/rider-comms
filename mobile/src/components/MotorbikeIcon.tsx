import * as React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

/** A motorbike, the same drawing as the PWA's #i-bike symbol. */
export function MotorbikeIcon({ size = 22, color }: { size?: number; color: string }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={6.5} cy={17} r={3.5} />
      <Circle cx={17.5} cy={17} r={3.5} />
      <Path d="M10 17h4.5l2.2-6H12l-2 3H6.5M11 8.5h3M14 8.5l2.7 2.5M8.5 10.5h2.2" />
    </Svg>
  );
}
