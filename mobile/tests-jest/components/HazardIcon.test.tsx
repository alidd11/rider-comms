import * as React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import type { HazardType } from '@rider-comms/shared';
import { HazardIcon, HazardMarkerIcon, HazardNavigationIcon } from '../../src/components/HazardIcon';

const TYPES: HazardType[] = ['police', 'hidden_police', 'police_checkpoint', 'camera', 'accident', 'road_closure'];

describe('hazard icons', () => {
  it.each(TYPES)('draws the %s artwork for the report sheet, the map and turn-by-turn', async (type) => {
    const view = await render(
      <View>
        <HazardIcon type={type} />
        <HazardMarkerIcon type={type} />
        <HazardMarkerIcon type={type} selected size={44} />
        <HazardNavigationIcon type={type} />
      </View>,
    );
    // Decorative (hidden from screen readers), so look past accessibility.
    // toJSON takes this option at runtime; its published type omits it.
    const toJSON = view.toJSON as (options: { includeHiddenElements: boolean }) => unknown;
    const drawing = JSON.stringify(toJSON({ includeHiddenElements: true }));
    expect(drawing.match(/"type":"RNSVGSvgView"/g)).toHaveLength(4);
    expect(drawing.match(/"type":"RNSVG(?:Path|Rect|Circle|Polygon)"/g)!.length).toBeGreaterThan(8);
  });
});
