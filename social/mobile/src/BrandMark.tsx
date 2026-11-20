import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { BRAND, BRAND_MARK } from '../../../shared/src/brand.ts';
import { C } from './styles';

/**
 * The Rider Comms mark in a round badge, the same artwork as the app icon,
 * wherever Social shows Rider Comms itself (its Story, its featured posts).
 */
export function BrandMark({ size, ring = false }: { size: number; ring?: boolean }) {
  const mark = Math.round(size * 0.62);
  return <View accessible accessibilityRole="image" accessibilityLabel={BRAND.name + ' logo'} style={{
    width: size, height: size, borderRadius: size / 2, backgroundColor: C.accentDark,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: ring ? 2 : 0, borderColor: C.accent,
  }}>
    <Svg width={mark} height={mark} viewBox={BRAND_MARK.viewBox}>
      {BRAND_MARK.strokes.map(stroke => <Path key={stroke.d} d={stroke.d} fill="none" stroke={C.accent}
        strokeWidth={stroke.width} strokeLinecap="round"/>)}
      {BRAND_MARK.blocks.map(block => <Rect key={`${block.x}-${block.y}`} {...block} fill={C.accent}/>)}
    </Svg>
  </View>;
}
