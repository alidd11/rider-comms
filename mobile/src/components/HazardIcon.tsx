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
          <Path d="M6 20C10 13 16 9 24 9C32 9 38 13 42 20L36 24H12Z" fill={BLUE} />
          <Path d="M10 22H38L37 27H11Z" fill="#0E5F80" />
          <Path d="M10 27C14 29 19 30 24 30C29 30 34 29 38 27L40 30C36 35 12 35 8 30Z" fill={BLUE_DARK} />
          <Path
            d="M24 11L27.5 12.6V16.5C27.5 19.3 26.2 21.3 24 22.6C21.8 21.3 20.5 19.3 20.5 16.5V12.6Z"
            fill={WHITE}
            stroke={GREY}
            strokeWidth={0.7}
          />
          <Path d="M24 13.3L26 14.2V16.2C26 17.9 25.3 19.2 24 20.1C22.7 19.2 22 17.9 22 16.2V14.2Z" fill={BLUE_DARK} />
        </G>
      );
    case 'hidden_police':
      return (
        <G>
          <Path d="M8 19C11 13 17 10 24 10C31 10 37 13 40 19L35 23H13Z" fill={BLUE} />
          <Path d="M12 21H36L35 26H13Z" fill="#0E5F80" />
          <Path
            d="M24 11L27.5 12.6V16.5C27.5 19.3 26.2 21.3 24 22.6C21.8 21.3 20.5 19.3 20.5 16.5V12.6Z"
            fill={WHITE}
            stroke={GREY}
            strokeWidth={0.7}
          />
          <Path d="M24 13.3L26 14.2V16.2C26 17.9 25.3 19.2 24 20.1C22.7 19.2 22 17.9 22 16.2V14.2Z" fill={BLUE_DARK} />
          <Path d="M4 27H44V39H4Z" fill={GREY} />
          <Path d="M4 27H44V30H4Z" fill="#AAB5BB" />
          <Circle cx={11} cy={34} r={1.5} fill={DARK} />
          <Circle cx={37} cy={34} r={1.5} fill={DARK} />
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

function HazardMapGlyph({ type }: { type: HazardType }): React.JSX.Element {
  switch (type) {
    case 'police':
      return (
        <G>
          <Path d="M7 22C11 14 17 11 24 11C31 11 37 14 41 22L35 27H13Z" fill={BLUE} />
          <Rect x={10} y={25} width={28} height={5} rx={2.5} fill={BLUE_DARK} />
          <Path d="M24 13L28 15V19C28 22 26.4 24.4 24 25.8C21.6 24.4 20 22 20 19V15Z" fill={WHITE} />
        </G>
      );
    case 'hidden_police':
      return (
        <G>
          <Path d="M8 20C12 14 18 11 24 11C30 11 36 14 40 20L35 25H13Z" fill={BLUE} />
          <Path d="M24 13L27.5 14.6V18.2C27.5 21 26.1 23 24 24.3C21.9 23 20.5 21 20.5 18.2V14.6Z" fill={WHITE} />
          <Rect x={6} y={26} width={36} height={11} rx={2.5} fill={GREY} />
          <Rect x={6} y={26} width={36} height={3} rx={1.5} fill="#AAB5BB" />
        </G>
      );
    case 'police_checkpoint':
      return (
        <G>
          <Path d="M19 11C20 7 22 5 24 5C26 5 28 7 29 11L27 14H21Z" fill={BLUE} />
          <Rect x={5} y={20} width={38} height={10} rx={2} fill={WHITE} />
          <Polygon points="5,20 12,20 18,30 11,30" fill={RED} />
          <Polygon points="21,20 28,20 34,30 27,30" fill={RED} />
          <Polygon points="37,20 43,20 43,29 42,30" fill={RED} />
          <Rect x={9} y={30} width={4} height={10} rx={1} fill={GREY} />
          <Rect x={35} y={30} width={4} height={10} rx={1} fill={GREY} />
        </G>
      );
    case 'camera':
      return (
        <G>
          <Rect x={9} y={18} width={27} height={19} rx={4} fill={WHITE} />
          <Rect x={13} y={13} width={13} height={10} rx={2.5} fill={BLUE} />
          <Circle cx={19.5} cy={18} r={3} fill={DEEP} />
          <Rect x={13} y={23} width={12} height={7} rx={1.5} fill="#73848D" />
          <Circle cx={15} cy={37} r={3.5} fill={DARK} />
          <Circle cx={31} cy={37} r={3.5} fill={DARK} />
          <Path d="M30 12C34 13 37 16 38 20" fill="none" stroke={BLUE} strokeWidth={3.2} strokeLinecap="round" />
          <Path d="M32 7C39 9 43 13 45 20" fill="none" stroke={BLUE} strokeWidth={3.2} strokeLinecap="round" />
        </G>
      );
    case 'accident':
      return (
        <G>
          <Polygon points="24,5 28,13 35,8 34,16 43,15 37,22 44,25 35,29 38,37 29,32 24,41 19,32 10,37 13,29 4,25 11,22 5,15 14,16 13,8 20,13" fill={RED} />
          <Rect x={5} y={29} width={16} height={10} rx={3} fill={WHITE} />
          <Rect x={27} y={29} width={16} height={10} rx={3} fill={WHITE} />
          <Circle cx={9} cy={40} r={2.5} fill={DARK} />
          <Circle cx={18} cy={40} r={2.5} fill={DARK} />
          <Circle cx={30} cy={40} r={2.5} fill={DARK} />
          <Circle cx={39} cy={40} r={2.5} fill={DARK} />
        </G>
      );
    case 'road_closure':
      return (
        <G>
          <Circle cx={24} cy={21} r={15} fill={RED} />
          <Circle cx={24} cy={21} r={10.5} fill={WHITE} />
          <Rect x={13} y={18.5} width={22} height={5} rx={2.5} fill={RED} />
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
  size = 36,
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
      <G transform="translate(10 8) scale(0.92)">
        <HazardMapGlyph type={type} />
      </G>
    </Svg>
  );
}

export function HazardNavigationIcon({ type, size = 22 }: { type: HazardType; size?: number }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <HazardMapGlyph type={type} />
    </Svg>
  );
}
