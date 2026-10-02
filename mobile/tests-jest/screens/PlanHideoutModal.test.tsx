import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { PlanHideoutModal } from '../../src/screens/PlanHideoutModal';

jest.mock('react-native-maps', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const MapView = ReactActual.forwardRef((props: Record<string, unknown>, ref) => {
    ReactActual.useImperativeHandle(ref, () => ({ animateToRegion: jest.fn() }));
    return ReactActual.createElement(View, { ...props, testID: 'hideout-map' });
  });
  const Marker = (props: Record<string, unknown>) => ReactActual.createElement(View, { ...props, testID: 'hideout-pin' });
  return { __esModule: true, default: MapView, Marker };
});

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const location = Location as jest.Mocked<typeof Location>;
const SAFE_AREA_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 320, height: 640 },
};

function permission(granted: boolean) {
  return { granted, status: granted ? 'granted' : 'denied', canAskAgain: true, expires: 'never' } as never;
}

async function renderModal(onCreate = jest.fn(async () => undefined)) {
  const onClose = jest.fn();
  await render(
    <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
      <PlanHideoutModal visible onClose={onClose} onCreate={onCreate} />
    </SafeAreaProvider>,
  );
  await act(async () => {});
  return { onCreate, onClose };
}

const saveButton = () => screen.getByText('Save hideout');

beforeEach(() => {
  jest.clearAllMocks();
  location.getForegroundPermissionsAsync.mockResolvedValue(permission(false));
  location.requestForegroundPermissionsAsync.mockResolvedValue(permission(false));
  location.getLastKnownPositionAsync.mockResolvedValue({ coords: { latitude: 51.5, longitude: -0.12 } } as never);
});

test('never prompts for location on open, and saves a tapped spot', async () => {
  const { onCreate, onClose } = await renderModal();
  expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(screen.getByText('Tap the map to choose a spot.')).toBeTruthy();

  await fireEvent.changeText(screen.getByPlaceholderText(/Name/), '  Café stop ');
  expect(screen.queryByTestId('hideout-pin')).toBeNull();
  await fireEvent(screen.getByTestId('hideout-map'), 'press', { nativeEvent: { coordinate: { latitude: 52.1, longitude: -1.2 } } });
  expect(screen.getByTestId('hideout-pin')).toBeTruthy();
  expect(screen.getByText('Drag the pin or tap the map to move it.')).toBeTruthy();

  await fireEvent.press(saveButton());
  expect(onCreate).toHaveBeenCalledWith('Café stop', 52.1, -1.2);
  expect(onClose).toHaveBeenCalled();
});

test('drops the pin at the rider when location is already allowed', async () => {
  location.getForegroundPermissionsAsync.mockResolvedValue(permission(true));
  const { onCreate } = await renderModal();
  expect(screen.getByTestId('hideout-pin')).toBeTruthy();
  await fireEvent.changeText(screen.getByPlaceholderText(/Name/), 'Home');
  await fireEvent.press(saveButton());
  expect(onCreate).toHaveBeenCalledWith('Home', 51.5, -0.12);
});

test('“My location” asks for permission and explains a refusal', async () => {
  await renderModal();
  await fireEvent.press(screen.getByLabelText('Use my current location'));
  await act(async () => {});
  expect(location.requestForegroundPermissionsAsync).toHaveBeenCalled();
  expect(screen.getByText(/Allow location access in Settings/)).toBeTruthy();
});

test('a server error stays on screen', async () => {
  const { onClose } = await renderModal(jest.fn(async () => { throw new Error('That name isn’t allowed.'); }));
  await fireEvent.changeText(screen.getByPlaceholderText(/Name/), 'Spot');
  await fireEvent(screen.getByTestId('hideout-map'), 'press', { nativeEvent: { coordinate: { latitude: 52, longitude: -1 } } });
  await fireEvent.press(saveButton());
  expect(screen.getByText('That name isn’t allowed.')).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
});
