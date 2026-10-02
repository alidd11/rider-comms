import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import { RideRoster } from '../../src/ride/RideRoster';

const mockRemoveRider = jest.fn(async (_riderId: string) => undefined);
const mockClient = { reportRider: jest.fn(), blockRider: jest.fn() };
let mockRoster = ['rider-1', 'rider-2'];

jest.mock('../../src/ride/RideContext', () => ({
  useRide: () => ({ roster: mockRoster, removeRider: mockRemoveRider }),
}));
jest.mock('../../src/auth/AuthContext', () => ({
  useAuth: () => ({ client: mockClient, riderId: 'rider-1' }),
}));
jest.mock('../../src/screens/useRideProfiles', () => ({
  useRideProfiles: () => ({ 'rider-2': { riderId: 'rider-2', displayName: 'Maya', handle: '@maya_moto' } }),
}));

function lastButtons(): AlertButton[] {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  return calls[calls.length - 1][2] as AlertButton[];
}

beforeEach(() => {
  mockRoster = ['rider-1', 'rider-2'];
  mockRemoveRider.mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

test('shows names and offers report or block for other riders only', async () => {
  await render(<RideRoster canRemove={false} />);
  expect(screen.getByText('You')).toBeTruthy();
  expect(screen.getByText('Maya')).toBeTruthy();
  expect(screen.getByText('@maya_moto')).toBeTruthy();
  expect(screen.queryByLabelText('Report or block You')).toBeNull();
  expect(screen.queryByLabelText('Remove Maya from ride')).toBeNull();

  await fireEvent.press(screen.getByLabelText('Report or block Maya'));
  expect(Alert.alert).toHaveBeenLastCalledWith('Maya', undefined, expect.any(Array));
  expect(lastButtons().map((button) => button.text)).toEqual(['Report rider', 'Block rider', 'Cancel']);
});

test('the host removes a rider only after confirming', async () => {
  await render(<RideRoster canRemove />);
  await fireEvent.press(screen.getByLabelText('Remove Maya from ride'));
  expect(Alert.alert).toHaveBeenLastCalledWith('Remove Maya?', expect.any(String), expect.any(Array));
  expect(mockRemoveRider).not.toHaveBeenCalled();
  await act(async () => { lastButtons().find((button) => button.text === 'Remove')?.onPress?.(); });
  expect(mockRemoveRider).toHaveBeenCalledWith('rider-2');
});

test('an empty ride prompts the rider to share the code', async () => {
  mockRoster = ['rider-1'];
  await render(<RideRoster canRemove />);
  expect(screen.getByText(/No one else has joined yet/)).toBeTruthy();
});
