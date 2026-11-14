import * as React from 'react';
import { View } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { AVATAR_PRESETS, type HazardReport } from '@rider-comms/shared';
import {
  HazardMarker,
  NavigationPuckMarker,
  SmoothRideMemberMarker,
  SmoothSelfMarker,
  bearingDegrees,
  riderMapLabel,
} from '../../src/screens/mapMarkers';

const mockAnimateMarkerToCoordinate = jest.fn();

jest.mock('react-native-maps', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View: RNView } = jest.requireActual<typeof import('react-native')>('react-native');
  const Marker = ReactActual.forwardRef((props: Record<string, unknown>, ref) => {
    ReactActual.useImperativeHandle(ref, () => ({ animateMarkerToCoordinate: mockAnimateMarkerToCoordinate }));
    return ReactActual.createElement(RNView, { ...props, testID: (props.testID as string | undefined) ?? 'marker' });
  });
  return { __esModule: true, default: RNView, Marker };
});

const HERE = { lat: 51.5, lon: -0.1 };
const AHEAD = { lat: 51.5002, lon: -0.1 };

function drawing(view: Awaited<ReturnType<typeof render>>): string {
  // Map artwork is decorative (hidden from screen readers); toJSON takes this
  // option at runtime though its published type omits it.
  const toJSON = view.toJSON as (options: { includeHiddenElements: boolean }) => unknown;
  return JSON.stringify(toJSON({ includeHiddenElements: true }));
}

function puck(coneDegrees: number | null) {
  return (
    <NavigationPuckMarker
      now={HERE}
      target={AHEAD}
      glideMs={1000}
      coneDegrees={coneDegrees}
      avatarId="ember"
      displayName="Sam"
      description="Your location"
    />
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  mockAnimateMarkerToCoordinate.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

test('the navigation puck glides ahead and points its cone the way the rider travels', async () => {
  const view = await render(puck(40));
  expect(mockAnimateMarkerToCoordinate).toHaveBeenCalledWith({ latitude: AHEAD.lat, longitude: AHEAD.lon }, 1000);
  expect(drawing(view)).toContain('navigation-puck-cone');
  // Turning the cone redraws the marker bitmap briefly, then stops tracking.
  expect(view.getByTestId('marker').props.tracksViewChanges).toBe(true);
  await act(async () => { jest.advanceTimersByTime(300); });
  expect(view.getByTestId('marker').props.tracksViewChanges).toBe(false);
  await view.rerender(puck(90));
  expect(view.getByTestId('marker').props.tracksViewChanges).toBe(true);
});

test('the navigation puck hides its cone when the direction is unknown', async () => {
  const view = await render(puck(null));
  expect(drawing(view)).not.toContain('navigation-puck-cone');
});

test('self and ride-member markers glide to each new fix, not on first draw', async () => {
  const self = await render(
    <SmoothSelfMarker location={HERE} avatarId="ember" displayName="Sam" shareRideLocation={false} status="none" />,
  );
  expect(mockAnimateMarkerToCoordinate).not.toHaveBeenCalled();
  await self.rerender(
    <SmoothSelfMarker location={AHEAD} avatarId="ember" displayName="" shareRideLocation status="online" />,
  );
  expect(mockAnimateMarkerToCoordinate).toHaveBeenCalledWith({ latitude: AHEAD.lat, longitude: AHEAD.lon }, expect.any(Number));
  expect(self.getByTestId('marker').props.title).toBe('Your location');

  mockAnimateMarkerToCoordinate.mockClear();
  const member = await render(<SmoothRideMemberMarker location={HERE} avatarId="ember" displayName="Alex Rider" status="online" />);
  expect(mockAnimateMarkerToCoordinate).not.toHaveBeenCalled();
  expect(member.getByText('Alex')).toBeTruthy();
  await member.rerender(<SmoothRideMemberMarker location={AHEAD} avatarId="ember" displayName="Alex Rider" status="stale" lastSeen="3 min ago" />);
  expect(mockAnimateMarkerToCoordinate).toHaveBeenCalledTimes(1);
  // Updates stopped: the label and callout say when they were last seen.
  expect(member.getByText(/Alex.*· 3 min ago/)).toBeTruthy();
  expect(member.getByTestId('marker').props.description).toBe('Last seen 3 min ago');
});

test('a ride member on a low battery says so on their marker', async () => {
  const member = await render(<SmoothRideMemberMarker location={HERE} avatarId="ember" displayName="Alex Rider" status="online" batteryLow />);
  expect(member.getByText(/Alex.*· low battery/)).toBeTruthy();
  expect(member.getByTestId('marker').props.description).toBe('Private ride member · live location · low battery');
});

test('every avatar draws as a ride-member marker', async () => {
  const view = await render(
    <View>
      {AVATAR_PRESETS.map((preset) => (
        <SmoothRideMemberMarker key={preset.id} location={HERE} avatarId={preset.id} displayName={preset.label} status="online" />
      ))}
    </View>,
  );
  expect(drawing(view).match(/"type":"RNSVGSvgView"/g)).toHaveLength(AVATAR_PRESETS.length);
});

test('hazard markers grow and stay redrawn while selected', async () => {
  const hazard = { id: 'h1', type: 'camera', lat: HERE.lat, lon: HERE.lon } as HazardReport;
  const onPress = jest.fn();
  const view = await render(<HazardMarker hazard={hazard} selected={false} onPress={onPress} />);
  expect(view.getByTestId('marker').props.tracksViewChanges).toBe(false);
  await view.rerender(<HazardMarker hazard={hazard} selected onPress={onPress} />);
  expect(view.getByTestId('marker').props.tracksViewChanges).toBe(true);
  expect(view.getByTestId('marker').props.zIndex).toBe(12);
});

test('bearings and map labels', () => {
  expect(bearingDegrees(HERE, AHEAD)).toBeCloseTo(0, 5);
  expect(bearingDegrees(AHEAD, HERE)).toBeCloseTo(180, 5);
  expect(riderMapLabel('  ')).toBe('Rider');
  expect(riderMapLabel('Bartholomew-Jones Smith')).toBe('Bartholomew…');
});
