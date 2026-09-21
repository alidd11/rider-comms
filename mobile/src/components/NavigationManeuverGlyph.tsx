import React from 'react';
import Svg, { G, Path } from 'react-native-svg';
import { navigationManeuverKind } from '../navigationManeuver';

interface NavigationManeuverGlyphProps {
  maneuver?: string;
  size?: number;
  color: string;
  secondaryColor?: string;
}

const routeStroke = {
  fill: 'none',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function NavigationManeuverGlyph({
  maneuver,
  size = 56,
  color,
  secondaryColor = 'rgba(255,255,255,0.26)',
}: NavigationManeuverGlyphProps): React.JSX.Element {
  const kind = navigationManeuverKind(maneuver);
  const main = { ...routeStroke, stroke: color, strokeWidth: 5.5 };
  const secondary = { ...routeStroke, stroke: secondaryColor, strokeWidth: 4.2 };

  const mirror = (children: React.ReactNode): React.JSX.Element => (
    <G transform="translate(64 0) scale(-1 1)">{children}</G>
  );

  const straight = (
    <>
      <Path d="M32 54V15" {...main} />
      <Path d="M21 26 32 15 43 26" {...main} />
    </>
  );

  const slightLeft = (
    <>
      <Path d="M40 54V43c0-9-4-13-12-18l-9-5" {...main} />
      <Path d="M31 18 19 20 23 32" {...main} />
    </>
  );

  const left = (
    <>
      <Path d="M42 54V35c0-8-4-12-12-12H18" {...main} />
      <Path d="M27 14 18 23 27 32" {...main} />
    </>
  );

  const sharpLeft = (
    <>
      <Path d="M43 54V42c0-9-4-14-12-20L20 14" {...main} />
      <Path d="M32 12 20 14 23 26" {...main} />
    </>
  );

  const uturnLeft = (
    <>
      <Path d="M43 54V31c0-11-6-17-15-17-9 0-14 7-14 17v6" {...main} />
      <Path d="M8 29 14 37 21 30" {...main} />
    </>
  );

  const merge = (
    <>
      <Path d="M32 54V15" {...main} />
      <Path d="M21 26 32 15 43 26" {...main} />
      <Path d="M15 51c0-11 5-16 17-22" {...secondary} />
    </>
  );

  const forkLeft = (
    <>
      <Path d="M35 54V42c0-8-4-13-11-18l-7-5" {...main} />
      <Path d="M28 17 17 19 21 30" {...main} />
      <Path d="M35 42c0-8 4-13 12-19" {...secondary} />
    </>
  );

  const rampLeft = (
    <>
      <Path d="M39 54V15" {...secondary} />
      <Path d="M39 43c-1-9-7-15-18-20" {...main} />
      <Path d="M32 19 21 23 26 34" {...main} />
    </>
  );

  const roundaboutLeft = (
    <>
      <Path d="M32 54V43c0-5-4-9-9-9" {...main} />
      <Path d="M23 34c-7 0-12-5-12-12 0-8 6-13 14-13 9 0 15 6 15 15 0 8-6 14-14 14H12" {...main} />
      <Path d="M20 30 12 38 20 46" {...main} />
    </>
  );

  const arrive = (
    <>
      <Path d="M23 54V13" {...main} />
      <Path d="M23 15h22l-6 8 6 8H23" {...main} />
    </>
  );

  let content: React.ReactNode;
  switch (kind) {
    case 'slight-left': content = slightLeft; break;
    case 'left': content = left; break;
    case 'sharp-left': content = sharpLeft; break;
    case 'uturn-left': content = uturnLeft; break;
    case 'slight-right': content = mirror(slightLeft); break;
    case 'right': content = mirror(left); break;
    case 'sharp-right': content = mirror(sharpLeft); break;
    case 'uturn-right': content = mirror(uturnLeft); break;
    case 'merge': content = merge; break;
    case 'fork-left': content = forkLeft; break;
    case 'fork-right': content = mirror(forkLeft); break;
    case 'ramp-left': content = rampLeft; break;
    case 'ramp-right': content = mirror(rampLeft); break;
    case 'roundabout-left': content = roundaboutLeft; break;
    case 'roundabout-right': content = mirror(roundaboutLeft); break;
    case 'arrive': content = arrive; break;
    default: content = straight; break;
  }

  return <Svg width={size} height={size} viewBox="0 0 64 64">{content}</Svg>;
}
