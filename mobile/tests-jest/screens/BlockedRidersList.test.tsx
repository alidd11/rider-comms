import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import { BlockedRidersList } from '../../src/screens/BlockedRidersList';

const MAYA = { riderId: 'rider-2', displayName: 'Maya', handle: '@maya_moto', blockedAt: 1 };
const JAY = { riderId: 'rider-3', displayName: 'Jay', handle: '', blockedAt: 2 };

function client(blocked = [MAYA, JAY]) {
  return {
    getBlockedRiders: jest.fn(async () => ({ blockedRiderIds: blocked.map((rider) => rider.riderId), blocked })),
    unblockRider: jest.fn(async () => undefined),
  };
}

async function renderList(api: ReturnType<typeof client>) {
  await render(<BlockedRidersList client={api as never} />);
  await act(async () => {});
}

function pressAlertButton(label: string) {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const button = (calls[calls.length - 1][2] as AlertButton[]).find((entry) => entry.text === label);
  button?.onPress?.();
}

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

test('lists blocked riders and unblocks after confirmation', async () => {
  const api = client();
  await renderList(api);
  expect(screen.getByText('Maya')).toBeTruthy();
  expect(screen.getByText('@maya_moto')).toBeTruthy();
  expect(screen.getByText('Jay')).toBeTruthy();

  await fireEvent.press(screen.getByLabelText('Unblock Maya'));
  expect(Alert.alert).toHaveBeenLastCalledWith('Unblock Maya?', expect.any(String), expect.any(Array));
  expect(api.unblockRider).not.toHaveBeenCalled();
  await act(async () => { pressAlertButton('Unblock'); });
  expect(api.unblockRider).toHaveBeenCalledWith('rider-2');
  expect(screen.queryByText('Maya')).toBeNull();
  expect(screen.getByText('Jay')).toBeTruthy();
});

test('shows an empty state when nobody is blocked', async () => {
  await renderList(client([]));
  expect(screen.getByText(/You haven’t blocked anyone/)).toBeTruthy();
});

test('a load failure offers retry', async () => {
  const api = client();
  api.getBlockedRiders.mockRejectedValueOnce(new Error('offline'));
  await renderList(api);
  expect(screen.getByText(/Couldn’t load blocked riders/)).toBeTruthy();
  await fireEvent.press(screen.getByText('Retry'));
  await act(async () => {});
  expect(screen.getByText('Maya')).toBeTruthy();
});

test('a failed unblock keeps the rider listed', async () => {
  const api = client();
  api.unblockRider.mockRejectedValueOnce(new Error('offline'));
  await renderList(api);
  await fireEvent.press(screen.getByLabelText('Unblock Jay'));
  await act(async () => { pressAlertButton('Unblock'); });
  expect(screen.getByText('Jay')).toBeTruthy();
  expect(Alert.alert).toHaveBeenLastCalledWith('Couldn’t unblock', expect.any(String));
});
