import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { PlaceResult } from '../../src/api/places';
import { recentPlacesStorageKey } from '../../src/search/recentPlaces';
import { MapDrawer } from '../../src/screens/MapDrawer';
import type { MapDrawerProps } from '../../src/screens/MapDrawer';

const SAFE_AREA_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 34 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

// One stable client: a new object per render would re-run the search bar's
// effects forever.
const mockAuth = { riderId: 'rider-1', client: { searchPlaces: jest.fn(), searchNearbyPlaces: jest.fn() } };
jest.mock('../../src/auth/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('../../src/settings/SettingsContext', () => ({
  useSettings: () => ({ unitSystem: 'km' }),
}));

const ACE: PlaceResult = { id: 'ace', name: 'Ace Cafe London', address: 'North Circular Rd', lat: 51.541, lon: -0.277, distanceMeters: 0 };

function Harness(overrides: Partial<MapDrawerProps>): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
      <MapDrawer
        near={{ lat: 51.5, lon: -0.1 }}
        onRequestLocation={async () => undefined}
        onSelectPlace={jest.fn()}
        onRide={jest.fn()}
        onFriends={jest.fn()}
        onRoutes={jest.fn()}
        rideLive={false}
        friendsCount={0}
        open={open}
        onOpenChange={setOpen}
        onPeekHeight={jest.fn()}
        bottomInset={34}
        {...overrides}
      />
    </SafeAreaProvider>
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('rests with Where to? and the Ride, Friends and Routes shortcuts', async () => {
  const onRide = jest.fn();
  const onFriends = jest.fn();
  const onRoutes = jest.fn();
  await render(<Harness onRide={onRide} onFriends={onFriends} onRoutes={onRoutes} rideLive friendsCount={3} />);

  expect(screen.getByLabelText('Where to?')).toBeTruthy();
  expect(screen.getByText('Live')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  expect(screen.queryByTestId('map-drawer-recent')).toBeNull();

  await fireEvent.press(screen.getByLabelText('Ride, live'));
  await fireEvent.press(screen.getByLabelText('Friends, 3 new'));
  await fireEvent.press(screen.getByLabelText('Routes'));
  expect(onRide).toHaveBeenCalledTimes(1);
  expect(onFriends).toHaveBeenCalledTimes(1);
  expect(onRoutes).toHaveBeenCalledTimes(1);
});

it('opens to recent places, and a chosen place closes it again', async () => {
  await AsyncStorage.setItem(recentPlacesStorageKey('rider-1'), JSON.stringify([ACE]));
  const onSelectPlace = jest.fn();
  await render(<Harness onSelectPlace={onSelectPlace} />);

  await fireEvent.press(screen.getByLabelText('Show recent places'));
  await act(async () => {});
  expect(screen.getByLabelText('Hide recent places')).toBeTruthy();
  expect(screen.getByText('Ace Cafe London')).toBeTruthy();

  await fireEvent.press(screen.getByLabelText('Recent place: Ace Cafe London, North Circular Rd'));
  expect(onSelectPlace).toHaveBeenCalledWith(expect.objectContaining({ id: 'ace' }));
  expect(screen.queryByTestId('map-drawer-recent')).toBeNull();
});

it('says where recent places will appear before there are any', async () => {
  await render(<Harness />);
  await fireEvent.press(screen.getByLabelText('Show recent places'));
  await act(async () => {});
  expect(screen.getByText('Places you search for show up here.')).toBeTruthy();
  expect(screen.getByLabelText('Friends')).toBeTruthy();
  expect(screen.getByLabelText('Ride')).toBeTruthy();
});

it('reports its resting height so the map controls can sit above it', async () => {
  const onPeekHeight = jest.fn();
  await render(<Harness onPeekHeight={onPeekHeight} />);
  // The drawer carries pan handlers, which the testing library reads as
  // touch-disabled, so call its layout handler directly.
  await act(async () => {
    screen.getByTestId('map-drawer').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 190 } } });
  });
  expect(onPeekHeight).toHaveBeenCalledWith(190);
});
