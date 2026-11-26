import * as React from 'react';
import { Linking, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { compareVersions, requiredUpdate, UPDATE_CHECK_TIMEOUT_MS, UpdateGate } from '../../src/screens/UpdateGate';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.1.0' } } }));

const IOS_URL = 'https://apps.apple.com/app/rider-comms/id123';
const config = (ios: string | null, url: string | null = IOS_URL) => ({ minAppVersion: { ios, android: null }, updateUrl: { ios: url, android: null } });
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }); };

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const respond = (body: unknown, ok = true) => fetchMock.mockResolvedValue({ ok, json: async () => body });
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const app = () => <SafeAreaProvider initialMetrics={METRICS}><UpdateGate><Text>The app</Text></UpdateGate></SafeAreaProvider>;

test('compares versions number by number', () => {
  expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
  expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
  expect(compareVersions('0.9.12', '1.0.0')).toBe(-1);
  expect(compareVersions('2.0', '2.0.0')).toBe(0);
});

test('only an older app on a known platform needs an update, and only to an https store page', () => {
  expect(requiredUpdate(config('1.2.0'), 'ios', '1.1.0')).toEqual({ url: IOS_URL });
  expect(requiredUpdate(config('1.2.0'), 'ios', '1.2.0')).toBeNull();
  expect(requiredUpdate(config('1.2.0'), 'android', '1.1.0')).toBeNull();
  expect(requiredUpdate(config('1.2.0'), 'web', '1.1.0')).toBeNull();
  expect(requiredUpdate(config(null), 'ios', '1.1.0')).toBeNull();
  expect(requiredUpdate(config('soon'), 'ios', '1.1.0')).toBeNull();
  expect(requiredUpdate({}, 'ios', '1.1.0')).toBeNull();
  expect(requiredUpdate(config('1.2.0', 'http://example.com'), 'ios', '1.1.0')).toEqual({ url: null });
});

test('an app older than the minimum asks the rider to update and opens the store', async () => {
  respond(config('1.2.0'));
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await render(app());
  await flush();
  expect(screen.queryByText('The app')).toBeNull();
  expect(screen.getByText('Update Rider Comms')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('update-open-store')); });
  expect(open).toHaveBeenCalledWith(IOS_URL);
});

test('without a store link it says where to update, with no button', async () => {
  respond(config('1.2.0', null));
  await render(app());
  await flush();
  expect(screen.getByText(/Update from the App Store/)).toBeTruthy();
  expect(screen.queryByTestId('update-open-store')).toBeNull();
});

test('an up-to-date app, a failed check or a server error opens the app', async () => {
  respond(config('1.0.0'));
  const first = await render(app());
  await flush();
  expect(screen.getByText('The app')).toBeTruthy();
  await first.unmount();

  fetchMock.mockRejectedValue(new Error('offline'));
  const second = await render(app());
  await flush();
  expect(screen.getByText('The app')).toBeTruthy();
  await second.unmount();

  respond({}, false);
  await render(app());
  await flush();
  expect(screen.getByText('The app')).toBeTruthy();
});

test('a slow answer is ignored, so a rider already using the app is never stopped', async () => {
  jest.useFakeTimers();
  let resolve: (value: unknown) => void = () => undefined;
  fetchMock.mockReturnValue(new Promise((done) => { resolve = done; }));
  await render(app());
  await act(async () => { jest.advanceTimersByTime(UPDATE_CHECK_TIMEOUT_MS); });
  await act(async () => { resolve({ ok: true, json: async () => config('9.0.0') }); });
  await flush();
  expect(screen.getByText('The app')).toBeTruthy();
});
