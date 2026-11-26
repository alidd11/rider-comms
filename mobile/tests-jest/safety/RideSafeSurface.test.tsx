import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { RideSafeSurface } from '../../src/safety/RideSafeSurface';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const mockSafety = {
  movementState: 'moving',
  locationAccess: 'granted',
  trackingError: null as string | null,
  requestLocationAccess: jest.fn(),
  openLocationSettings: jest.fn(),
};
jest.mock('../../src/safety/MovementSafetyContext', () => ({ useMovementSafety: () => mockSafety }));

beforeEach(() => {
  mockNavigate.mockClear();
  Object.assign(mockSafety, { movementState: 'moving', locationAccess: 'granted', trackingError: null });
});

test('while moving it says why the controls are locked and offers one way back: the map', async () => {
  await render(<RideSafeSurface />);
  expect(screen.getByText('Controls locked while riding')).toBeTruthy();
  expect(screen.getByText('Movement detected')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Enable location' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Back to the map' }));
  expect(mockNavigate).toHaveBeenCalledWith('Tabs', { screen: 'Map' });
});

test('without a movement fix it offers location access, and still the way back to the map', async () => {
  Object.assign(mockSafety, { movementState: 'unknown', locationAccess: 'blocked', trackingError: 'Location is off.' });
  await render(<RideSafeSurface />);
  expect(screen.getByText('Movement status unavailable')).toBeTruthy();
  expect(screen.getByText('Location is off.')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Open location settings' }));
  expect(mockSafety.openLocationSettings).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Back to the map' })).toBeTruthy();
});
