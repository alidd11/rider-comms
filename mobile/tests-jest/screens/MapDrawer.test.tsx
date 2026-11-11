import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { PlaceResult } from '../../src/api/places';
import { recentPlacesStorageKey } from '../../src/search/recentPlaces';
import { savedPlacesStorageKey } from '../../src/search/savedPlaces';
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

it('rests with Where to? and the Home, Work and Petrol shortcuts', async () => {
  await render(<Harness />);

  expect(screen.getByLabelText('Where to?')).toBeTruthy();
  expect(screen.getByLabelText('Set Home')).toBeTruthy();
  expect(screen.getByLabelText('Set Work')).toBeTruthy();
  expect(screen.getByLabelText('Petrol stations nearby')).toBeTruthy();
  expect(screen.queryByTestId('map-drawer-recent')).toBeNull();
});

it('chooses Home the first time, then shows it in one tap', async () => {
  await AsyncStorage.setItem(recentPlacesStorageKey('rider-1'), JSON.stringify([ACE]));
  const onSelectPlace = jest.fn();
  await render(<Harness onSelectPlace={onSelectPlace} />);

  await fireEvent.press(screen.getByLabelText('Set Home'));
  expect(screen.getByText('Choose your Home')).toBeTruthy();
  await fireEvent.press(await screen.findByLabelText(/^Recent place: Ace Cafe London/));
  expect(onSelectPlace).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'ace' }));
  expect(JSON.parse(await AsyncStorage.getItem(savedPlacesStorageKey('rider-1')) ?? '{}').home.id).toBe('ace');

  onSelectPlace.mockClear();
  await fireEvent.press(screen.getByLabelText('Home, Ace Cafe London'));
  expect(onSelectPlace).toHaveBeenCalledWith(expect.objectContaining({ id: 'ace' }));
  expect(screen.queryByText('Choose your Home')).toBeNull();
});

it('changes or removes a saved place on a long press', async () => {
  await AsyncStorage.setItem(savedPlacesStorageKey('rider-1'), JSON.stringify({ work: ACE }));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<Harness />);

  await fireEvent(await screen.findByLabelText('Work, Ace Cafe London'), 'longPress');
  const buttons = alert.mock.calls[0][2] ?? [];
  expect(buttons.map((button) => button.text)).toEqual(['Change Work', 'Remove Work', 'Cancel']);
  await act(async () => { buttons[1].onPress?.(); });
  expect(screen.getByLabelText('Set Work')).toBeTruthy();
  expect(JSON.parse(await AsyncStorage.getItem(savedPlacesStorageKey('rider-1')) ?? '{}').work).toBeUndefined();
  alert.mockRestore();
});

it('Petrol opens search on nearby petrol stations', async () => {
  await render(<Harness />);
  await fireEvent.press(screen.getByLabelText('Petrol stations nearby'));
  expect(screen.getByText('Nearby')).toBeTruthy();
  expect(screen.getByDisplayValue('Petrol')).toBeTruthy();
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
  expect(screen.getByLabelText('Set Home')).toBeTruthy();
  expect(screen.getByLabelText('Petrol stations nearby')).toBeTruthy();
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
