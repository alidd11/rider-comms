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

function HazardArtwork({ type }: { type: HazardType }): React.JSX.Element {
  switch (type) {
    case 'police':
      return (
        <G>
          <Path d="M7 22c2-7.5 8.5-12 17-12s15 4.5 17 12l-6 5H13Z" fill={BLUE} />
          <Path d="M11 27c4 2 22 2 26 0l-2 5c-3 3-7 4-11 4s-8-1-11-4Z" fill={BLUE_DARK} />
          <Path d="M24 14l4 2v4c0 3-1.7 5.4-4 6.6-2.3-1.2-4-3.6-4-6.6v-4Z" fill={DARK} />
        </G>
      );
    case 'hidden_police':
      return (
        <G>
          <Path d="M8 22c2-7 8-11 16-11s14 4 16 11l-5 5H13Z" fill={BLUE} />
          <Path d="M24 14l4 2v4c0 3-1.7 5.2-4 6.4-2.3-1.2-4-3.4-4-6.4v-4Z" fill={DARK} />
          <Path d="M6 31c5-5 11-8 18-8 8 0 14 3 18 8l-2 10H8Z" fill={GREY_DARK} />
          <Path d="M9 31c5-3 10-4 15-4 6 0 11 1 15 4l-1 4H10Z" fill={GREY} />
        </G>
      );
    case 'police_checkpoint':
      return (
        <G>
          <Path d="M14 13c1.5-6 5-9 10-9s8.5 3 10 9l-4 4H18Z" fill={BLUE} />
          <Path d="M24 7l3.5 1.7v3.2c0 2.3-1.4 4.1-3.5 5.1-2.1-1-3.5-2.8-3.5-5.1V8.7Z" fill={DARK} />
          <Rect x={4} y={22} width={40} height={11} rx={2} fill={WHITE} />
          <Polygon points="4,22 11,22 18,33 11,33" fill={RED} />
          <Polygon points="20,22 27,22 34,33 27,33" fill={RED} />
          <Polygon points="36,22 43,22 44,24 44,33 43,33" fill={RED} />
          <Rect x={8} y={33} width={5} height={11} rx={1} fill={GREY} />
          <Rect x={35} y={33} width={5} height={11} rx={1} fill={GREY} />
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
          <Polygon points="24,4 28,12 35,7 34,15 43,14 37,21 45,24 36,28 39,35 30,31 24,40 18,31 9,35 12,28 3,24 11,21 5,14 14,15 13,7 20,12" fill={RED} />
          <Path d="M1 31l4-9h12l5 9v9H3a2 2 0 0 1-2-2Z" fill={WHITE} />
          <Path d="M26 31l5-9h12l4 9v7a2 2 0 0 1-2 2H26Z" fill={WHITE} />
          <Rect x={6} y={25} width={9} height={5} rx={1} fill="#87979E" />
          <Rect x={33} y={25} width={9} height={5} rx={1} fill="#87979E" />
          <Circle cx={7} cy={40} r={3} fill={DARK} />
          <Circle cx={18} cy={40} r={3} fill={DARK} />
          <Circle cx={31} cy={40} r={3} fill={DARK} />
          <Circle cx={43} cy={40} r={3} fill={DARK} />
        </G>
      );
    case 'road_closure':
      return (
        <G>
          <Circle cx={24} cy={16} r={14} fill={RED} />
          <Circle cx={24} cy={16} r={10.5} fill={WHITE} />
          <Rect x={13} y={14} width={22} height={4} rx={2} fill={RED} />
          <Rect x={4} y={29} width={40} height={9} rx={2} fill={WHITE} />
          <Polygon points="4,29 12,29 19,38 11,38" fill={RED} />
          <Polygon points="21,29 29,29 36,38 28,38" fill={RED} />
          <Polygon points="38,29 44,29 44,36 43,38" fill={RED} />
          <Rect x={8} y={38} width={5} height={7} rx={1} fill={GREY} />
          <Rect x={35} y={38} width={5} height={7} rx={1} fill={GREY} />
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
