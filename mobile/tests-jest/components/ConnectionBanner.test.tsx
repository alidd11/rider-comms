import * as React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockNetworkState: { isConnected?: boolean | null; isInternetReachable?: boolean | null } = {};
jest.mock('expo-network', () => ({ useNetworkState: () => mockNetworkState }));

import { ConnectionBanner, OFFLINE_MESSAGE } from '../../src/components/ConnectionBanner';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

async function renderBanner(state: typeof mockNetworkState) {
  Object.assign(mockNetworkState, { isConnected: undefined, isInternetReachable: undefined }, state);
  await render(<SafeAreaProvider initialMetrics={metrics}><ConnectionBanner /></SafeAreaProvider>);
}

test('stays hidden while connected or while the state is still unknown', async () => {
  await renderBanner({ isConnected: true, isInternetReachable: true });
  expect(screen.queryByTestId('connection-banner')).toBeNull();
  await renderBanner({ isConnected: undefined, isInternetReachable: null });
  expect(screen.queryByTestId('connection-banner')).toBeNull();
});

test('says so when the phone has no connection, below the status bar, without taking touches', async () => {
  await renderBanner({ isConnected: false });
  const banner = screen.getByTestId('connection-banner');
  expect(screen.getByText(OFFLINE_MESSAGE)).toBeTruthy();
  expect(banner.props.pointerEvents).toBe('none');
  expect(banner.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ top: 47 + 8 })]));
});

test('also shows when connected to a network with no internet', async () => {
  await renderBanner({ isConnected: true, isInternetReachable: false });
  expect(screen.getByTestId('connection-banner')).toBeTruthy();
});
