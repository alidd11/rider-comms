import * as React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { BillingStatus } from '@rider-comms/shared';
import { BillingProvider } from '../../src/billing/BillingContext';
import type { StoreAdapter, StoreError, StorePurchase } from '../../src/billing/subscriptionFlow';
import { BillingScreen } from '../../src/screens/BillingScreen';
import { LEGAL_LINKS } from '../../src/legalLinks';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let mockLocked = false;
jest.mock('../../src/safety/MovementSafetyContext', () => ({
  useMovementSafety: () => ({ lockedForSafety: mockLocked }),
}));
jest.mock('../../src/safety/RideSafeSurface', () => {
  const { Text } = jest.requireActual('react-native');
  return { RideSafeSurface: () => <Text>Ride Safe is on</Text> };
});

const mockRefreshProfile = jest.fn(async () => undefined);
jest.mock('../../src/settings/SettingsContext', () => ({
  useSettings: () => ({ zoneTier: 'free', refreshProfile: mockRefreshProfile }),
}));

const FREE: BillingStatus = { tier: 'free', expiresAt: null, appAccountToken: 'acct-token', subscriptions: [], purchasesEnabled: true };
const PREMIUM: BillingStatus = {
  ...FREE,
  tier: 'premium',
  expiresAt: Date.UTC(2026, 10, 7),
  subscriptions: [{ platform: 'apple', productId: 'premium_monthly', tier: 'premium', expiresAt: Date.UTC(2026, 10, 7), active: true, willRenew: true }],
};

let mockClient: { getBilling: jest.Mock; verifyPurchase: jest.Mock };
jest.mock('../../src/auth/AuthContext', () => ({
  useAuth: () => ({ riderId: 'me', client: mockClient }),
}));

function fakeStore(overrides: Partial<StoreAdapter> = {}) {
  let purchaseListener: ((purchase: StorePurchase) => void) | null = null;
  let errorListener: ((error: StoreError) => void) | null = null;
  const store: StoreAdapter = {
    platform: 'apple',
    connect: jest.fn(async () => true),
    disconnect: jest.fn(async () => undefined),
    loadProducts: jest.fn(async () => [
      { id: 'premium_monthly', displayPrice: '£4.49' },
      { id: 'premium_plus_monthly', displayPrice: '£8.99' },
    ]),
    purchase: jest.fn(async () => undefined),
    availablePurchases: jest.fn(async () => []),
    finish: jest.fn(async () => undefined),
    manageSubscriptions: jest.fn(async () => undefined),
    onPurchase: (listener) => { purchaseListener = listener; return () => { purchaseListener = null; }; },
    onError: (listener) => { errorListener = listener; return () => { errorListener = null; }; },
    ...overrides,
  };
  return {
    store,
    deliver: (purchase: StorePurchase) => purchaseListener?.(purchase),
    fail: (error: StoreError) => errorListener?.(error),
  };
}

async function renderScreen(store: StoreAdapter) {
  return await render(
    <BillingProvider store={store}>
      <BillingScreen navigation={{ goBack: jest.fn() }} />
    </BillingProvider>,
  );
}

beforeEach(() => {
  mockLocked = false;
  mockRefreshProfile.mockClear();
  mockClient = { getBilling: jest.fn(async () => FREE), verifyPurchase: jest.fn(async () => PREMIUM) };
});

describe('BillingScreen', () => {
  it('shows every plan with the store’s prices, the subscription terms and legal links', async () => {
    const { store } = fakeStore();
    await renderScreen(store);
    expect(await screen.findByText('£4.49 / month')).toBeTruthy();
    expect(screen.getByText('£8.99 / month')).toBeTruthy();
    expect(screen.getByText('6 mi Nearby range')).toBeTruthy();
    expect(screen.getByText('20 mi Nearby range')).toBeTruthy();
    expect(screen.getByText('Current')).toBeTruthy();
    expect(screen.getByText(/renews automatically at the same price each month/)).toBeTruthy();
    expect(screen.getByText('Restore purchases')).toBeTruthy();
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await fireEvent.press(screen.getByText('Terms of Use'));
    await fireEvent.press(screen.getByText('Privacy Policy'));
    expect(open).toHaveBeenCalledWith(LEGAL_LINKS.terms);
    expect(open).toHaveBeenCalledWith(LEGAL_LINKS.privacy);
  });

  it('buys a plan tied to this account, verifies it, then finishes the transaction', async () => {
    const { store, deliver } = fakeStore();
    await renderScreen(store);
    await screen.findByText('£4.49 / month');
    await fireEvent.press(screen.getByLabelText('Subscribe to Premium, £4.49 / month'));
    await waitFor(() => expect(store.purchase).toHaveBeenCalledWith(
      { id: 'premium_monthly', displayPrice: '£4.49' },
      { appAccountToken: 'acct-token', replacing: null, upgrade: true },
    ));
    const bought: StorePurchase = { platform: 'apple', productId: 'premium_monthly', transactionId: '1000', purchaseToken: null, raw: {} };
    await act(async () => { deliver(bought); });
    await waitFor(() => expect(store.finish).toHaveBeenCalledWith(bought));
    expect(mockClient.verifyPurchase).toHaveBeenCalledWith({ platform: 'apple', transactionId: '1000' });
    expect(mockRefreshProfile).toHaveBeenCalled();
    expect(await screen.findByText('Manage subscription')).toBeTruthy();
    expect(screen.getByText(/^Renews /)).toBeTruthy();
  });

  it('stays quiet when the rider cancels, and explains a failed purchase', async () => {
    const { store, fail } = fakeStore();
    await renderScreen(store);
    await screen.findByText('£4.49 / month');
    await act(async () => { fail({ cancelled: true, message: 'cancelled' }); });
    expect(screen.queryByText(/didn’t go through/)).toBeNull();
    await act(async () => { fail({ cancelled: false, message: 'declined' }); });
    expect(screen.getByText(/didn’t go through/)).toBeTruthy();
    await fireEvent.press(screen.getByText(/didn’t go through/));
    expect(screen.queryByText(/didn’t go through/)).toBeNull();
  });

  it('restores purchases', async () => {
    const owned: StorePurchase = { platform: 'apple', productId: 'premium_plus_monthly', transactionId: '2000', purchaseToken: null, raw: {} };
    const { store } = fakeStore({ availablePurchases: jest.fn(async () => [owned]) });
    await renderScreen(store);
    await screen.findByText('£4.49 / month');
    await fireEvent.press(screen.getByText('Restore purchases'));
    expect(await screen.findByText('Your subscription is restored.')).toBeTruthy();
    expect(mockClient.verifyPurchase).toHaveBeenCalledWith({ platform: 'apple', transactionId: '2000' });
  });

  it('sends a paid rider to the store’s subscription settings to cancel or manage', async () => {
    mockClient.getBilling.mockResolvedValue(PREMIUM);
    const { store } = fakeStore();
    await renderScreen(store);
    await fireEvent.press(await screen.findByLabelText('Return to Free: cancel in subscription settings'));
    await waitFor(() => expect(store.manageSubscriptions).toHaveBeenCalledWith('premium_monthly'));
    await fireEvent.press(screen.getByText('Manage subscription'));
    expect(screen.getByLabelText('Upgrade to Premium+, £8.99 / month')).toBeTruthy();
  });

  it('upgrades a Google Play subscription by replacing the current one', async () => {
    mockClient.getBilling.mockResolvedValue(PREMIUM);
    const current: StorePurchase = { platform: 'google', productId: 'premium_monthly', transactionId: null, purchaseToken: 'old-token', raw: {} };
    const { store } = fakeStore({ platform: 'google', availablePurchases: jest.fn(async () => [current]) });
    await renderScreen(store);
    await fireEvent.press(await screen.findByLabelText('Upgrade to Premium+, £8.99 / month'));
    await waitFor(() => expect(store.purchase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'premium_plus_monthly' }),
      { appAccountToken: 'acct-token', replacing: current, upgrade: true },
    ));
  });

  it('disables buying when the store isn’t reachable, but still allows restore', async () => {
    const { store } = fakeStore({ connect: jest.fn(async () => false) });
    await renderScreen(store);
    expect(await screen.findByText(/can’t be bought right now/)).toBeTruthy();
    expect(screen.getByLabelText('Subscribe to Premium, $4.99 / month').props.accessibilityState.disabled).toBe(true);
  });

  it('explains a store failure while starting a purchase', async () => {
    const { store } = fakeStore({ purchase: jest.fn(async () => { throw new Error('boom'); }) });
    await renderScreen(store);
    await screen.findByText('£4.49 / month');
    await fireEvent.press(screen.getByLabelText('Subscribe to Premium+, £8.99 / month'));
    expect(await screen.findByText(/store isn’t available right now/)).toBeTruthy();
  });

  it('is locked while Ride Safe is on', async () => {
    mockLocked = true;
    const { store } = fakeStore();
    await renderScreen(store);
    expect(screen.getByText('Ride Safe is on')).toBeTruthy();
  });
});
