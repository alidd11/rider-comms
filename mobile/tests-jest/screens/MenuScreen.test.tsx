import * as React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RIDER_SOCIAL_URL } from '@rider-comms/shared';
import { MenuScreen } from '../../src/screens/MenuScreen';
import { ApiError } from '../../src/api/client';

const mockSocialBootstrap = jest.fn<Promise<{ entitlement: string }>, []>();
let mockActiveRide: object | null = null;
let mockIncoming: unknown[] = [];
let mockUnread = 0;
let mockClient = { getSocialBootstrap: () => mockSocialBootstrap() };

jest.mock('../../src/auth/AuthContext', () => ({
  useAuth: () => ({ client: mockClient, riderId: 'rider_menu' }),
}));
jest.mock('../../src/settings/SettingsContext', () => ({
  useSettings: () => ({ avatarId: 'helmet-teal', displayName: 'Ali', handle: '@ali', zoneTier: 'free', unitSystem: 'mi' }),
}));
jest.mock('../../src/ride/RideContext', () => ({ useRide: () => ({ activeRide: mockActiveRide }) }));
jest.mock('../../src/friends/FriendsContext', () => ({
  useFriends: () => ({ incomingRequests: mockIncoming, unreadMessageCount: mockUnread }),
}));

const METRICS = { insets: { top: 0, left: 0, right: 0, bottom: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } };

function navigation() {
  return { goBack: jest.fn(), navigate: jest.fn(), replace: jest.fn() };
}

async function renderMenu(nav = navigation()) {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <MenuScreen navigation={nav as never} route={{ key: 'Menu', name: 'Menu' } as never} />
    </SafeAreaProvider>,
  );
  await act(async () => {});
  return nav;
}

beforeEach(() => {
  mockSocialBootstrap.mockReset();
  mockClient = { getSocialBootstrap: () => mockSocialBootstrap() };
  mockActiveRide = null;
  mockIncoming = [];
  mockUnread = 0;
});

test('lists Rider Social for a rider the server lets in, and opens it', async () => {
  mockSocialBootstrap.mockResolvedValue({ entitlement: 'beta' });
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await renderMenu();
  await fireEvent.press(screen.getByLabelText('Rider Social, Beta'));
  expect(open).toHaveBeenCalledWith(RIDER_SOCIAL_URL);
  open.mockRestore();
});

test('leaves Rider Social out when the server says no', async () => {
  mockSocialBootstrap.mockRejectedValue(new Error('social_beta_not_enabled'));
  await renderMenu();
  expect(screen.queryByLabelText(/Rider Social/)).toBeNull();
});

test('shows the last answer at once, keeps it offline and drops it on a refusal', async () => {
  mockSocialBootstrap.mockResolvedValue({ entitlement: 'beta' });
  await renderMenu();
  await act(async () => { screen.unmount(); });

  // Reopened while the check is still running: no flicker.
  mockSocialBootstrap.mockReturnValue(new Promise(() => {}));
  await renderMenu();
  expect(screen.getByLabelText('Rider Social, Beta')).toBeTruthy();
  await act(async () => { screen.unmount(); });

  mockSocialBootstrap.mockRejectedValue(new TypeError('Network request failed'));
  await renderMenu();
  expect(screen.getByLabelText('Rider Social, Beta')).toBeTruthy();
  await act(async () => { screen.unmount(); });

  mockSocialBootstrap.mockRejectedValue(new ApiError(403, { error: 'social_beta_not_enabled' }));
  await renderMenu();
  expect(screen.queryByLabelText(/Rider Social/)).toBeNull();
  await act(async () => { screen.unmount(); });

  mockSocialBootstrap.mockReturnValue(new Promise(() => {}));
  await renderMenu();
  expect(screen.queryByLabelText(/Rider Social/)).toBeNull();
});

test('a refusal after the menu closed is still remembered', async () => {
  mockSocialBootstrap.mockResolvedValue({ entitlement: 'beta' });
  await renderMenu();
  await act(async () => { screen.unmount(); });
  let refuse: (error: unknown) => void = () => {};
  mockSocialBootstrap.mockReturnValue(new Promise((_, reject) => { refuse = reject; }));
  await renderMenu();
  await act(async () => { screen.unmount(); });
  await act(async () => { refuse(new ApiError(403, {})); });
  mockSocialBootstrap.mockReturnValue(new Promise(() => {}));
  await renderMenu();
  expect(screen.queryByLabelText(/Rider Social/)).toBeNull();
});

test('ignores an answer that arrives after the menu closed', async () => {
  let answer: (value: { entitlement: string }) => void = () => {};
  mockSocialBootstrap.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  await renderMenu();
  await act(async () => { screen.unmount(); });
  await act(async () => { answer({ entitlement: 'beta' }); });
  expect(mockSocialBootstrap).toHaveBeenCalledTimes(1);
});

test('the rows go where they say, with Live and new counts', async () => {
  mockSocialBootstrap.mockRejectedValue(new Error('no'));
  mockActiveRide = { id: 'ride-1' };
  mockIncoming = [{}, {}];
  mockUnread = 98;
  const nav = await renderMenu();
  await fireEvent.press(screen.getByLabelText('Ride, Live'));
  expect(nav.navigate).toHaveBeenCalledWith('Tabs', { screen: 'Map', params: expect.objectContaining({ segment: 'host', fromMenu: true }) });
  await fireEvent.press(screen.getByLabelText('Friends, 99+ new'));
  expect(nav.navigate).toHaveBeenCalledWith('Tabs', { screen: 'Friends', params: { fromMenu: true } });
  for (const [label, target] of [['Routes', 'Routes'], ['Settings', 'Settings']] as const) {
    await fireEvent.press(screen.getByLabelText(label));
    // Pushed over the menu, so their back arrow returns to it.
    expect(nav.navigate).toHaveBeenCalledWith(target);
  }
  await fireEvent.press(screen.getByLabelText(/^Your plan/));
  expect(nav.navigate).toHaveBeenCalledWith('Billing');
  await fireEvent.press(screen.getByLabelText('Help & Support'));
  expect(nav.navigate).toHaveBeenCalledWith('SettingsPage', { page: 'help' });
  await fireEvent.press(screen.getByLabelText('View profile'));
  expect(nav.navigate).toHaveBeenCalledWith('SettingsPage', { page: 'myProfile' });
  await fireEvent.press(screen.getByLabelText('Close menu'));
  expect(nav.goBack).toHaveBeenCalled();
  expect(nav.replace).not.toHaveBeenCalled();
});

test('the ride stats total the rides kept on this device', () => {
  const { menuRideStats } = jest.requireActual('../../src/screens/MenuScreen') as typeof import('../../src/screens/MenuScreen');
  expect(menuRideStats([], 'mi')).toEqual({ rides: '0', time: '0m', distance: '0', distanceLabel: 'Miles' });
  const history = [
    { endedAt: 2, durationMs: 5_400_000, riders: 3, distanceMeters: 86_000 },
    { endedAt: 1, durationMs: 900_000, riders: 1, distanceMeters: null },
  ];
  expect(menuRideStats(history, 'km')).toEqual({ rides: '2', time: '1h 45m', distance: '86.0', distanceLabel: 'Kilometres' });
  expect(menuRideStats(history.slice(1), 'mi').time).toBe('15m');
});

test('premium menu groups the full rider journey and labels device-local ride totals', async () => {
  mockSocialBootstrap.mockResolvedValue({ entitlement: 'beta' });
  await renderMenu();
  expect(screen.getByText('Menu')).toBeTruthy();
  expect(screen.getByText('Recent rides')).toBeTruthy();
  expect(screen.getByText('Last 10 · this device')).toBeTruthy();
  expect(screen.getByText('Ride & explore')).toBeTruthy();
  expect(screen.getByText('Account & support')).toBeTruthy();
  expect(screen.getByTestId('menu-ride-stats')).toBeTruthy();
  for (const name of ['Ride', 'Friends', 'Routes', 'Rider Social', 'Your plan', 'Settings', 'Help & Support']) {
    expect(screen.getByLabelText(new RegExp(`^${name}(?:,|$)`))).toBeTruthy();
  }
});
