import { Platform } from 'react-native';
import {
  deepLinkToSubscriptions,
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  isUserCancelledError,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
} from 'expo-iap';
import type { Purchase, ProductSubscription } from 'expo-iap';
import type { StoreAdapter, StoreProduct, StorePurchase } from './subscriptionFlow';

const ANDROID_PACKAGE = 'com.ridercomms.app';

function toStorePurchase(purchase: Purchase): StorePurchase {
  const platform = Platform.OS === 'ios' ? 'apple' : 'google';
  return {
    platform,
    productId: purchase.productId,
    // StoreKit's transaction ID is the purchase's id; Google's is the token.
    transactionId: platform === 'apple' ? purchase.id : null,
    purchaseToken: platform === 'google' ? purchase.purchaseToken ?? null : null,
    raw: purchase,
  };
}

function toStoreProduct(product: ProductSubscription): StoreProduct {
  const offers = product.subscriptionOffers ?? [];
  // The base plan (no offer ID tag) is the plain monthly price.
  const base = offers.find((offer) => offer.offerTokenAndroid && !(offer.offerTagsAndroid ?? []).length) ?? offers.find((offer) => offer.offerTokenAndroid);
  return { id: product.id, displayPrice: product.displayPrice, offerToken: base?.offerTokenAndroid ?? null };
}

/** App Store / Google Play through expo-iap. Null on platforms without a store. */
export function createStoreAdapter(): StoreAdapter {
  const platform = Platform.OS === 'ios' ? 'apple' : Platform.OS === 'android' ? 'google' : null;
  return {
    platform,
    async connect() {
      if (!platform) return false;
      try {
        return await initConnection();
      } catch {
        return false;
      }
    },
    async disconnect() {
      if (platform) await endConnection().catch(() => undefined);
    },
    async loadProducts(productIds) {
      const products = await fetchProducts({ skus: productIds, type: 'subs' });
      return ((products ?? []) as ProductSubscription[]).map(toStoreProduct);
    },
    async purchase(product, { appAccountToken, replacing, upgrade }) {
      await requestPurchase({
        type: 'subs',
        request: {
          apple: { sku: product.id, appAccountToken },
          google: {
            skus: [product.id],
            obfuscatedAccountId: appAccountToken,
            subscriptionOffers: product.offerToken ? [{ sku: product.id, offerToken: product.offerToken }] : [],
            // Upgrades start now with the unused time credited; downgrades
            // start when the current period ends.
            ...(replacing?.purchaseToken
              ? {
                purchaseToken: replacing.purchaseToken,
                subscriptionProductReplacementParams: {
                  oldProductId: replacing.productId,
                  replacementMode: upgrade ? 'with-time-proration' : 'deferred',
                },
              }
              : {}),
          },
        },
      });
    },
    async availablePurchases() {
      const purchases = await getAvailablePurchases({ onlyIncludeActiveItemsIOS: true });
      return (purchases ?? []).map(toStorePurchase);
    },
    async finish(purchase) {
      await finishTransaction({ purchase: purchase.raw as Purchase, isConsumable: false });
    },
    async manageSubscriptions(productId) {
      await deepLinkToSubscriptions({ packageNameAndroid: ANDROID_PACKAGE, skuAndroid: productId ?? null });
    },
    onPurchase(listener) {
      const subscription = purchaseUpdatedListener((purchase) => listener(toStorePurchase(purchase)));
      return () => subscription.remove();
    },
    onError(listener) {
      const subscription = purchaseErrorListener((error) => listener({ cancelled: isUserCancelledError(error), message: error.message }));
      return () => subscription.remove();
    },
  };
}
