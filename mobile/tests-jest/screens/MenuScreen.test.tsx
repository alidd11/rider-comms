import * as React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RIDER_SOCIAL_URL } from '@rider-comms/shared';
import { MenuScreen } from '../../src/screens/MenuScreen';

const mockSocialBootstrap = jest.fn<Promise<{ entitlement: string }>, []>();
let mockActiveRide: object | null = null;
let mockIncoming: unknown[] = [];
let mockUnread = 0;

jest.mock('../../src/auth/AuthContext', () => ({
  useAuth: () => ({ client: { getSocialBootstrap: () => mockSocialBootstrap() } }),
}));
jest.mock('../../src/settings/SettingsContext', () => ({
  useSettings: () => ({ avatarId: 'helmet-teal', displayName: 'Ali', handle: '@ali', zoneTier: 'free' }),
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
  await fireEvent.press(screen.getByLabelText('Group Ride, Live'));
  expect(nav.navigate).toHaveBeenCalledWith('Tabs', expect.objectContaining({ screen: 'Map' }));
  await fireEvent.press(screen.getByLabelText('Friends, 99+ new'));
  expect(nav.navigate).toHaveBeenCalledWith('Tabs', { screen: 'Friends' });
  for (const [label, target] of [['Routes', 'Routes'], ['Settings', 'Settings']] as const) {
    await fireEvent.press(screen.getByLabelText(label));
    expect(nav.replace).toHaveBeenCalledWith(target);
  }
  await fireEvent.press(screen.getByLabelText(/^Your plan/));
  expect(nav.replace).toHaveBeenCalledWith('Billing');
  await fireEvent.press(screen.getByLabelText('Help & Support'));
  expect(nav.replace).toHaveBeenCalledWith('SettingsPage', { page: 'help' });
  await fireEvent.press(screen.getByLabelText('View profile'));
  expect(nav.replace).toHaveBeenCalledWith('SettingsPage', { page: 'myProfile' });
  await fireEvent.press(screen.getByLabelText('Close menu'));
  expect(nav.goBack).toHaveBeenCalled();
});
