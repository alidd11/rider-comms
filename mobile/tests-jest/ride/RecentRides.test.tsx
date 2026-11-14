import * as React from 'react';
import { act, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { rideHistoryStorageKey } from '@rider-comms/shared';
import { RecentRides } from '../../src/ride/RecentRides';
import { recordRideHistory } from '../../src/ride/rideHistory';

let mockRiderId: string | null = 'me';
let mockUnit = 'mi';
jest.mock('../../src/auth/AuthContext', () => ({ useAuth: () => ({ riderId: mockRiderId }) }));
jest.mock('../../src/settings/SettingsContext', () => ({ useSettings: () => ({ unitSystem: mockUnit }) }));

const HOUR = 3_600_000;

beforeEach(async () => {
  await AsyncStorage.clear();
  mockRiderId = 'me';
  mockUnit = 'mi';
});

test('shows nothing until a ride has finished, then the newest first', async () => {
  const view = await render(<RecentRides />);
  expect(view.queryByTestId('recent-rides')).toBeNull();

  await act(async () => {
    await recordRideHistory('me', { endedAt: Date.now() - HOUR, durationMs: HOUR, riders: 3, distanceMeters: 40_000 });
    await recordRideHistory('me', { endedAt: Date.now(), durationMs: 2 * HOUR, riders: 1, distanceMeters: null });
    // Another rider's ride on this phone isn't shown.
    await recordRideHistory('someone-else', { endedAt: Date.now(), durationMs: HOUR, riders: 2, distanceMeters: null });
  });
  expect(view.getByText('Recent rides')).toBeTruthy();
  const rows = view.getAllByText(/^Today · /).map((row) => row.props.children);
  expect(rows).toEqual(['Today · 2 h · Just you', 'Today · 1 h · 3 riders · 24.9 mi']);
});

test('reads saved rides in the rider\'s units, and none when signed out', async () => {
  await AsyncStorage.setItem(rideHistoryStorageKey('me'), JSON.stringify([
    { endedAt: Date.now(), durationMs: HOUR, riders: 2, distanceMeters: 40_000 },
  ]));
  mockUnit = 'km';
  const view = await render(<RecentRides />);
  expect(await view.findByText('Today · 1 h · 2 riders · 40.0 km')).toBeTruthy();

  mockRiderId = null;
  await view.rerender(<RecentRides />);
  expect(view.queryByTestId('recent-rides')).toBeNull();
});

test('a storage failure leaves the list empty and recording quiet', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('disk'));
  const view = await render(<RecentRides />);
  await act(async () => {
    await recordRideHistory('me', { endedAt: Date.now(), durationMs: HOUR, riders: 2, distanceMeters: null });
  });
  expect(view.queryByTestId('recent-rides')).toBeNull();
  jest.restoreAllMocks();
});
