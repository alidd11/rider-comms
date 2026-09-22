import * as React from 'react';
import Svg, { Circle, G, Path, Polygon, Rect } from 'react-native-svg';
import type { HazardType } from '@rider-comms/shared';

const BLUE = '#2FB7EB';
const BLUE_DARK = '#159CCF';
const DARK = '#10191F';
const DEEP = '#071015';
const WHITE = '#F4F7F8';
const GREY = '#63727A';
const GREY_DARK = '#303C43';
const RED = '#F0646B';
const ORANGE = '#E2A03D';
const ORANGE_DARK = '#6A4A1D';

function HazardArtwork({ type }: { type: HazardType }): React.JSX.Element {
  switch (type) {
    case 'police':
      return (
        <G>
          <Path d="M8 22C10 14 16 10 24 10s14 4 16 12l-5 5H13Z" fill={BLUE} />
          <Path d="M9 28h30l-2 5c-4 3-8 4-13 4s-9-1-13-4Z" fill={BLUE_DARK} />
          <Path d="M7 32c4 6 30 6 34 0l-2 6c-4 3-9 5-15 5s-11-2-15-5Z" fill={BLUE} />
          <Path d="M24 14l4 2v4c0 3-1.7 5.4-4 6.6-2.3-1.2-4-3.6-4-6.6v-4Z" fill={DARK} />
        </G>
      );
    case 'hidden_police':
      return (
        <G>
          <Path d="M9 23c1.8-7.5 8-11 15-11s13.2 3.5 15 11l-5 4H14Z" fill={BLUE} />
          <Path d="M24 15l3.6 1.8v3.3c0 2.6-1.5 4.4-3.6 5.4-2.1-1-3.6-2.8-3.6-5.4v-3.3Z" fill={DARK} />
          <Path d="M5 29l38-7v15L8 43Z" fill={GREY} />
          <Path d="M7 31l35-6v4L7 35Z" fill={GREY_DARK} />
          <Path d="M11 34c8 3 18 3 26 0l-2 5c-6 3-16 3-22 0Z" fill={BLUE} />
        </G>
      );
    case 'police_checkpoint':
      return (
        <G>
          <Path d="M16 13c1-5 4-8 8-8s7 3 8 8l-3 3H19Z" fill={BLUE} />
          <Path d="M24 8l3 1.5v3c0 2-1.2 3.6-3 4.5-1.8-.9-3-2.5-3-4.5v-3Z" fill={DARK} />
          <Rect x={6} y={24} width={36} height={10} rx={2} fill={WHITE} />
          <Polygon points="6,24 13,24 19,34 12,34" fill={RED} />
          <Polygon points="22,24 29,24 35,34 28,34" fill={RED} />
          <Polygon points="38,24 42,24 42,31" fill={RED} />
          <Rect x={10} y={34} width={4} height={9} rx={1} fill={GREY} />
          <Rect x={34} y={34} width={4} height={9} rx={1} fill={GREY} />
        </G>
      );
    case 'camera':
      return (
        <G>
          <Rect x={13} y={9} width={14} height={10} rx={2} fill={BLUE} />
          <Circle cx={20} cy={14} r={3} fill={DEEP} />
          <Path d="M8 22h25l8 8v10H6a3 3 0 0 1-3-3V27a5 5 0 0 1 5-5Z" fill={WHITE} />
          <Path d="M28 23h5l6 7H28Z" fill="#9EC6D7" />
          <Rect x={9} y={26} width={12} height={7} rx={1.5} fill="#73848D" />
          <Circle cx={12} cy={40} r={4} fill={DARK} />
          <Circle cx={34} cy={40} r={4} fill={DARK} />
          <Path d="M30 10c4 1 7 4 8 8" fill="none" stroke={BLUE} strokeWidth={3} strokeLinecap="round" />
          <Path d="M32 5c7 2 11 6 13 13" fill="none" stroke={BLUE} strokeWidth={3} strokeLinecap="round" />
        </G>
      );
    case 'accident':
      return (
        <G>
          <Polygon points="24,3 28,12 36,7 34,16 43,15 36,22 44,27 33,28 36,38 27,32 24,43 20,32 11,38 15,28 4,27 12,22 5,15 14,16 12,7 20,12" fill={RED} />
          <Path d="M2 31l3-8h11l5 8v9H3a2 2 0 0 1-2-2v-5c0-1 .4-1.5 1-2Z" fill={WHITE} />
          <Path d="M27 31l5-8h11l4 8v7a2 2 0 0 1-2 2H27Z" fill={WHITE} />
          <Rect x={6} y={25} width={8} height={5} rx={1} fill="#87979E" />
          <Rect x={34} y={25} width={7} height={5} rx={1} fill="#87979E" />
          <Circle cx={7} cy={40} r={3} fill={DARK} />
          <Circle cx={17} cy={40} r={3} fill={DARK} />
          <Circle cx={32} cy={40} r={3} fill={DARK} />
          <Circle cx={42} cy={40} r={3} fill={DARK} />
        </G>
      );
    case 'hazard':
      return (
        <G>
          <Polygon points="4,23 10,15 17,14 20,8 28,12 35,10 38,17 45,20 41,28 44,34 35,36 30,42 22,39 14,42 10,35 3,33 7,28" fill={ORANGE} />
          <Path d="M10 25c3-7 9-10 16-9 8 0 13 4 14 10-2 7-8 10-16 10-7 0-12-4-14-11Z" fill={DARK} />
          <Path d="M12 23c4-3 8-5 13-5 6 0 10 2 13 5" fill="none" stroke={ORANGE_DARK} strokeWidth={2} strokeLinecap="round" />
        </G>
      );
    case 'road_closure':
      return (
        <G>
          <Rect x={7} y={31} width={34} height={8} rx={2} fill={WHITE} />
          <Polygon points="7,31 14,31 20,39 13,39" fill={RED} />
          <Polygon points="23,31 30,31 36,39 29,39" fill={RED} />
          <Polygon points="39,31 41,31 41,35" fill={RED} />
          <Rect x={10} y={39} width={4} height={6} rx={1} fill={GREY} />
          <Rect x={34} y={39} width={4} height={6} rx={1} fill={GREY} />
          <Circle cx={24} cy={17} r={13} fill={RED} />
          <Circle cx={24} cy={17} r={9.5} fill={WHITE} />
          <Rect x={14} y={15.2} width={20} height={3.6} rx={1.8} fill={RED} />
        </G>
      );
  }
}

export function HazardIcon({ type, size = 38 }: { type: HazardType; size?: number }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <HazardArtwork type={type} />
    </Svg>
  );
}

export function HazardMarkerIcon({
  type,
  size = 26,
  selected = false,
}: {
  type: HazardType;
  size?: number;
  selected?: boolean;
}): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path
        d="M32 2C17 2 7 12.5 7 26c0 16.5 25 36 25 36s25-19.5 25-36C57 12.5 47 2 32 2Z"
        fill="#0D171C"
        stroke={selected ? '#35D6FF' : '#3C4E58'}
        strokeWidth={selected ? 2.8 : 1.8}
      />
      <G transform="translate(15 7) scale(0.7)">
        <HazardArtwork type={type} />
      </G>
    </Svg>
  );
}
