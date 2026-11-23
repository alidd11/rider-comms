import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { navigationManeuverKind } from '../navigationManeuver';
import { MATERIAL_NAVIGATION_PATHS } from './materialNavigationPaths';

interface NavigationManeuverGlyphProps {
  maneuver?: string;
  size?: number;
  color: string;
  // Retained for callers using the previous route-line glyph API.
  secondaryColor?: string;
}

/** Google Material Symbols Rounded, locally bundled for offline guidance.
 * Keep the PWA symbols in docs/index.html identical to these path definitions.
 */
export function NavigationManeuverGlyph({
  maneuver,
  size = 56,
  color,
}: NavigationManeuverGlyphProps): React.JSX.Element {
  const kind = navigationManeuverKind(maneuver);
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960">
      <Path d={MATERIAL_NAVIGATION_PATHS[kind]} fill={color} />
    </Svg>
  );
}
