import { Platform } from 'react-native';
import * as iap from 'expo-iap';
import { createStoreAdapter } from '../../src/billing/storeAdapter';

const mocked = iap as unknown as Record<string, jest.Mock>;

function setPlatform(os: string) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

afterEach(() => {
  jest.clearAllMocks();
  setPlatform('ios');
});

describe('store adapter', () => {
  it('buys on the App Store with the account token and reads transactions by ID', async () => {
    setPlatform('ios');
    const store = createStoreAdapter();
    expect(store.platform).toBe('apple');
    mocked.initConnection.mockResolvedValueOnce(true);
    expect(await store.connect()).toBe(true);
    mocked.fetchProducts.mockResolvedValueOnce([{ id: 'premium_monthly', displayPrice: '£4.49' }]);
    expect(await store.loadProducts(['premium_monthly'])).toEqual([{ id: 'premium_monthly', displayPrice: '£4.49', offerToken: null }]);
    expect(mocked.fetchProducts).toHaveBeenCalledWith({ skus: ['premium_monthly'], type: 'subs' });

    await store.purchase({ id: 'premium_monthly', displayPrice: '£4.49' }, { appAccountToken: 'acct', replacing: null, upgrade: true });
    expect(mocked.requestPurchase).toHaveBeenCalledWith(expect.objectContaining({
      type: 'subs',
      request: expect.objectContaining({ apple: { sku: 'premium_monthly', appAccountToken: 'acct' } }),
    }));

    const raw = { id: '2000', productId: 'premium_monthly', purchaseToken: 'jws' };
    mocked.getAvailablePurchases.mockResolvedValueOnce([raw]);
    const [owned] = await store.availablePurchases();
    expect(owned).toEqual({ platform: 'apple', productId: 'premium_monthly', transactionId: '2000', purchaseToken: null, raw });
    await store.finish(owned);
    expect(mocked.finishTransaction).toHaveBeenCalledWith({ purchase: raw, isConsumable: false });
    await store.manageSubscriptions('premium_monthly');
    expect(mocked.deepLinkToSubscriptions).toHaveBeenCalledWith({ packageNameAndroid: 'com.ridercomms.app', skuAndroid: 'premium_monthly' });
    await store.disconnect();
    expect(mocked.endConnection).toHaveBeenCalled();
  });

  it('buys the base plan on Google Play and replaces the current plan when changing', async () => {
    setPlatform('android');
    const store = createStoreAdapter();
    expect(store.platform).toBe('google');
    mocked.fetchProducts.mockResolvedValueOnce([{
      id: 'premium_plus_monthly',
      displayPrice: '£8.99',
      subscriptionOffers: [
        { id: 'trial', displayPrice: '£0', offerTokenAndroid: 'offer-trial', offerTagsAndroid: ['trial'] },
        { id: 'monthly', displayPrice: '£8.99', offerTokenAndroid: 'offer-base', offerTagsAndroid: [] },
      ],
    }]);
    const [product] = await store.loadProducts(['premium_plus_monthly']);
    expect(product.offerToken).toBe('offer-base');
    const current = { platform: 'google' as const, productId: 'premium_monthly', transactionId: null, purchaseToken: 'old', raw: {} };
    await store.purchase(product, { appAccountToken: 'acct', replacing: current, upgrade: true });
    expect(mocked.requestPurchase.mock.calls[0][0].request.google).toEqual({
      skus: ['premium_plus_monthly'],
      obfuscatedAccountId: 'acct',
      subscriptionOffers: [{ sku: 'premium_plus_monthly', offerToken: 'offer-base' }],
      purchaseToken: 'old',
      subscriptionProductReplacementParams: { oldProductId: 'premium_monthly', replacementMode: 'with-time-proration' },
    });
    await store.purchase({ id: 'premium_monthly', displayPrice: '£4.49' }, { appAccountToken: 'acct', replacing: { ...current, productId: 'premium_plus_monthly' }, upgrade: false });
    expect(mocked.requestPurchase.mock.calls[1][0].request.google.subscriptionProductReplacementParams.replacementMode).toBe('deferred');
    expect(mocked.requestPurchase.mock.calls[1][0].request.google.subscriptionOffers).toEqual([]);

    mocked.getAvailablePurchases.mockResolvedValueOnce([{ id: 'GPA.1', productId: 'premium_monthly', purchaseToken: 'tok' }]);
    expect((await store.availablePurchases())[0]).toMatchObject({ platform: 'google', transactionId: null, purchaseToken: 'tok' });
  });

  it('passes purchases and errors to listeners, and survives a failed connection', async () => {
    setPlatform('ios');
    const store = createStoreAdapter();
    const remove = jest.fn();
    mocked.purchaseUpdatedListener.mockImplementationOnce((listener: (p: unknown) => void) => { listener({ id: '1', productId: 'premium_monthly' }); return { remove }; });
    const purchases: unknown[] = [];
    store.onPurchase((purchase) => purchases.push(purchase))();
    expect(purchases).toHaveLength(1);
    expect(remove).toHaveBeenCalled();

    mocked.isUserCancelledError.mockReturnValueOnce(true);
    mocked.purchaseErrorListener.mockImplementationOnce((listener: (e: unknown) => void) => { listener({ message: 'cancelled' }); return { remove }; });
    const errors: unknown[] = [];
    store.onError((error) => errors.push(error))();
    expect(errors).toEqual([{ cancelled: true, message: 'cancelled' }]);

    mocked.initConnection.mockRejectedValueOnce(new Error('no store'));
    expect(await store.connect()).toBe(false);
    mocked.fetchProducts.mockResolvedValueOnce(null);
    expect(await store.loadProducts([])).toEqual([]);
    mocked.getAvailablePurchases.mockResolvedValueOnce(null);
    expect(await store.availablePurchases()).toEqual([]);
  });

  it('does nothing on platforms without a store', async () => {
    setPlatform('web');
    const store = createStoreAdapter();
    expect(store.platform).toBeNull();
    expect(await store.connect()).toBe(false);
    await store.disconnect();
    expect(mocked.endConnection).not.toHaveBeenCalled();
  });
});
