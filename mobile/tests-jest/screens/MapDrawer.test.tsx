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

// The drawer's slide runs through PanResponder, which reads the responder
// system's touch history; build one so a test can slide a finger.
function touchAt(previousY: number, currentY: number, time: number) {
  return {
    nativeEvent: { touches: [], changedTouches: [] },
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: time,
      touchBank: [{
        touchActive: true,
        startPageX: 200, startPageY: 500, startTimeStamp: 0,
        previousPageX: 200, previousPageY: previousY, previousTimeStamp: time - 1,
        currentPageX: 200, currentPageY: currentY, currentTimeStamp: time,
      }],
    },
  };
}

async function slide(dy: number): Promise<void> {
  const drawer = screen.getByTestId('map-drawer');
  await act(async () => {
    const start = touchAt(500, 480, 1);
    // The capture phase records the movement; the bubble phase decides.
    drawer.props.onMoveShouldSetResponderCapture(start);
    expect(drawer.props.onMoveShouldSetResponder(start)).toBe(true);
    drawer.props.onResponderGrant(start);
    const moved = touchAt(480, 500 + dy, 2);
    drawer.props.onResponderMove(moved);
    drawer.props.onResponderRelease(moved);
  });
}

it('a slide follows the finger and snaps open or closed, with a haptic tick', async () => {
  const Haptics = jest.requireMock('expo-haptics') as { selectionAsync: jest.Mock };
  Haptics.selectionAsync.mockClear();
  await render(<Harness />);

  await slide(-120);
  expect(screen.getByLabelText('Hide recent places')).toBeTruthy();
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);

  // A short pull down leaves it open, with no tick.
  await slide(30);
  expect(screen.getByLabelText('Hide recent places')).toBeTruthy();
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);

  await slide(140);
  expect(screen.getByLabelText('Show recent places')).toBeTruthy();
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(2);

  // A slide the system takes away settles back where it was.
  const drawer = screen.getByTestId('map-drawer');
  await act(async () => {
    const start = touchAt(500, 480, 3);
    drawer.props.onMoveShouldSetResponderCapture(start);
    drawer.props.onMoveShouldSetResponder(start);
    drawer.props.onResponderGrant(start);
    drawer.props.onResponderTerminate(touchAt(480, 400, 4));
  });
  expect(screen.getByLabelText('Show recent places')).toBeTruthy();
});

it('press and hold on an empty Home goes straight to choosing it, and Change reopens search', async () => {
  await AsyncStorage.setItem(savedPlacesStorageKey('rider-1'), JSON.stringify({ work: ACE }));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<Harness />);

  await fireEvent(screen.getByLabelText('Set Home'), 'longPress');
  expect(screen.getByText('Choose your Home')).toBeTruthy();
  expect(alert).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText('Back to map'));

  // Screen readers reach the same choice through an accessibility action.
  await fireEvent(await screen.findByLabelText('Work, Ace Cafe London'), 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } });
  const buttons = alert.mock.calls[0][2] ?? [];
  await act(async () => { buttons[0].onPress?.(); });
  expect(screen.getByText('Choose your Work')).toBeTruthy();
  alert.mockRestore();
});
