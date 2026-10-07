import * as React from 'react';
import type { BillingStatus, PaidZoneTier } from '@rider-comms/shared';
import { SUBSCRIPTION_PRODUCT_IDS, compareTiers } from '@rider-comms/shared';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../settings/SettingsContext';
import { createStoreAdapter } from './storeAdapter';
import {
  linkedElsewhereMessage,
  PRODUCT_IDS,
  purchaseToReplace,
  restoreMessage,
  restorePurchases,
  verifyAndFinish,
  type BillingApi,
  type StoreAdapter,
  type StoreProduct,
  type StorePurchase,
} from './subscriptionFlow';

interface BillingContextValue {
  status: BillingStatus | null;
  /** Localised prices by product ID, once the store has answered. */
  prices: Record<string, string>;
  storeAvailable: boolean;
  busy: 'purchase' | 'restore' | null;
  message: string | null;
  clearMessage: () => void;
  subscribe: (tier: PaidZoneTier) => Promise<void>;
  restore: () => Promise<void>;
  manage: () => Promise<void>;
  refresh: () => Promise<void>;
}

const BillingContext = React.createContext<BillingContextValue | null>(null);

/**
 * Connects to App Store / Google Play while signed in. The purchase
 * listener runs for the whole session, because the store also delivers
 * purchases the app didn't finish last time (a crash mid-purchase, Ask to
 * Buy approved later) and Apple renewals.
 */
export function BillingProvider({ children, store: injectedStore }: { children: React.ReactNode; store?: StoreAdapter }): React.JSX.Element {
  const { client, riderId } = useAuth();
  const { refreshProfile } = useSettings();
  const store = React.useMemo(() => injectedStore ?? createStoreAdapter(), [injectedStore]);
  const api: BillingApi = React.useMemo(() => ({
    getBilling: () => client.getBilling(),
    verifyPurchase: (request) => client.verifyPurchase(request),
  }), [client]);
  const [status, setStatus] = React.useState<BillingStatus | null>(null);
  const [products, setProducts] = React.useState<StoreProduct[]>([]);
  const [connected, setConnected] = React.useState(false);
  const [busy, setBusy] = React.useState<BillingContextValue['busy']>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const applyStatus = React.useCallback((next: BillingStatus) => {
    setStatus(next);
    void refreshProfile().catch(() => undefined);
  }, [refreshProfile]);

  const refresh = React.useCallback(async () => {
    try {
      setStatus(await api.getBilling());
    } catch {
      // Offline: the screen keeps the last known plan.
    }
  }, [api]);

  const handlePurchase = React.useCallback(async (purchase: StorePurchase) => {
    const outcome = await verifyAndFinish(store, api, purchase);
    setBusy(null);
    if (outcome.kind === 'verified') {
      applyStatus(outcome.status);
      setMessage(null);
    } else if (outcome.kind === 'linked_elsewhere') {
      setMessage(linkedElsewhereMessage());
    } else if (outcome.kind === 'failed') {
      setMessage(outcome.message);
    }
  }, [api, applyStatus, store]);

  // The listener stays attached across renders; it always calls the latest handler.
  const handlePurchaseRef = React.useRef(handlePurchase);
  React.useEffect(() => { handlePurchaseRef.current = handlePurchase; }, [handlePurchase]);

  React.useEffect(() => {
    let cancelled = false;
    setStatus(null);
    void refresh();
    const removePurchase = store.onPurchase((purchase) => { void handlePurchaseRef.current(purchase); });
    const removeError = store.onError((error) => {
      setBusy(null);
      if (!error.cancelled) setMessage('The purchase didn’t go through. You haven’t been charged.');
    });
    void store.connect().then(async (ok) => {
      if (cancelled) return;
      setConnected(ok);
      if (!ok) return;
      try {
        const loaded = await store.loadProducts(PRODUCT_IDS);
        if (!cancelled) setProducts(loaded);
      } catch {
        // Prices fall back to the defaults; buying retries the lookup.
      }
    });
    return () => {
      cancelled = true;
      removePurchase();
      removeError();
      void store.disconnect();
    };
  }, [store, riderId, refresh]);

  const subscribe = React.useCallback(async (tier: PaidZoneTier) => {
    setMessage(null);
    const productId = SUBSCRIPTION_PRODUCT_IDS[tier];
    setBusy('purchase');
    try {
      let product = products.find((candidate) => candidate.id === productId);
      if (!product) {
        const loaded = await store.loadProducts(PRODUCT_IDS);
        setProducts(loaded);
        product = loaded.find((candidate) => candidate.id === productId);
      }
      if (!product) throw new Error('product unavailable');
      const current = status ?? await api.getBilling();
      const replacing = store.platform === 'google' ? purchaseToReplace(await store.availablePurchases(), tier) : null;
      await store.purchase(product, {
        appAccountToken: current.appAccountToken,
        replacing,
        upgrade: compareTiers(tier, current.tier) > 0,
      });
      // The result arrives through onPurchase / onError.
    } catch {
      setBusy(null);
      setMessage('The store isn’t available right now. Try again in a moment.');
    }
  }, [api, products, status, store]);

  const restore = React.useCallback(async () => {
    setMessage(null);
    setBusy('restore');
    try {
      const result = await restorePurchases(store, api);
      if (result.status) applyStatus(result.status);
      setMessage(restoreMessage(result));
    } catch {
      setMessage('We couldn’t reach the store to restore your purchase. Try again in a moment.');
    } finally {
      setBusy(null);
    }
  }, [api, applyStatus, store]);

  const manage = React.useCallback(async () => {
    const active = status?.subscriptions.find((subscription) => subscription.active);
    try {
      await store.manageSubscriptions(active?.productId);
    } catch {
      setMessage(store.platform === 'google'
        ? 'Open Google Play, then Payments & subscriptions, to manage your subscription.'
        : 'Open Settings, tap your name, then Subscriptions, to manage your subscription.');
    }
  }, [status, store]);

  const prices = React.useMemo(() => Object.fromEntries(products.map((product) => [product.id, product.displayPrice])), [products]);
  const value = React.useMemo<BillingContextValue>(() => ({
    status,
    prices,
    storeAvailable: connected && status?.purchasesEnabled !== false,
    busy,
    message,
    clearMessage: () => setMessage(null),
    subscribe,
    restore,
    manage,
    refresh,
  }), [busy, connected, manage, message, prices, refresh, restore, status, subscribe]);

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling(): BillingContextValue {
  const value = React.useContext(BillingContext);
  if (!value) throw new Error('useBilling must be used inside BillingProvider');
  return value;
}
