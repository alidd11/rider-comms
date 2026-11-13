import * as React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import { NavigationManeuverGlyph } from '../../src/components/NavigationManeuverGlyph';
import { NavigationRoadAhead } from '../../src/components/NavigationRoadAhead';

const MANEUVERS = [
  'straight', 'turn-slight-left', 'turn-left', 'turn-sharp-left', 'uturn-left',
  'turn-slight-right', 'turn-right', 'turn-sharp-right', 'uturn-right', 'merge',
  'fork-left', 'fork-right', 'ramp-left', 'ramp-right', 'roundabout-left', 'roundabout-right',
  'ferry', 'arrive', undefined,
];

test('every maneuver draws its own arrow', async () => {
  const view = await render(
    <View>
      {MANEUVERS.map((maneuver) => (
        <NavigationManeuverGlyph key={maneuver ?? 'none'} maneuver={maneuver} size={66} color="#fff" secondaryColor="#888" />
      ))}
    </View>,
  );
  const toJSON = view.toJSON as (options: { includeHiddenElements: boolean }) => unknown;
  const drawing = JSON.stringify(toJSON({ includeHiddenElements: true }));
  expect(drawing.match(/"type":"RNSVGSvgView"/g)).toHaveLength(MANEUVERS.length);
});

test('road ahead shows the two nearest reports with their distance, or nothing', async () => {
  const alert = (id: string, type: string, distanceAheadMeters: number) => ({
    hazard: { id, type, lat: 0, lon: 0 }, distanceAheadMeters,
  }) as never;
  const view = await render(
    <NavigationRoadAhead alerts={[alert('a', 'camera', 965), alert('b', 'road_closure', 2250), alert('c', 'police', 4000)]} unit="mi" />,
  );
  expect(view.getByText('Reports ahead')).toBeTruthy();
  expect(view.getByText('0.6 mi')).toBeTruthy();
  expect(view.getByText('1.4 mi')).toBeTruthy();
  expect(view.queryByText('2.5 mi')).toBeNull();

  const empty = await render(<NavigationRoadAhead alerts={[]} unit="km" />);
  expect(empty.toJSON()).toBeNull();
});
