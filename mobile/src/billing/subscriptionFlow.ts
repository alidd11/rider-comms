import type { BillingPlatform, BillingStatus, PaidZoneTier } from '@rider-comms/shared';
import { SUBSCRIPTION_PRODUCT_IDS, tierForProductId } from '@rider-comms/shared';

/**
 * The purchase flow without React or the store SDK, so it can be tested on
 * its own. storeAdapter.ts connects it to App Store / Google Play.
 */

export interface StoreProduct {
  id: string;
  /** Localised price from the store, e.g. "£4.99". */
  displayPrice: string;
  /** Google Play needs the base plan's offer token to buy. */
  offerToken?: string | null;
}

export interface StorePurchase {
  platform: BillingPlatform;
  productId: string;
  /** Apple: the transaction ID. */
  transactionId: string | null;
  /** Google: the purchase token. */
  purchaseToken: string | null;
  /** The SDK's own object, handed back to it to finish the transaction. */
  raw: unknown;
}

export interface StoreError {
  cancelled: boolean;
  message: string;
}

export interface StoreAdapter {
  readonly platform: BillingPlatform | null;
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  loadProducts(productIds: string[]): Promise<StoreProduct[]>;
  purchase(product: StoreProduct, options: { appAccountToken: string; replacing: StorePurchase | null; upgrade: boolean }): Promise<void>;
  availablePurchases(): Promise<StorePurchase[]>;
  finish(purchase: StorePurchase): Promise<void>;
  manageSubscriptions(productId?: string): Promise<void>;
  onPurchase(listener: (purchase: StorePurchase) => void): () => void;
  onError(listener: (error: StoreError) => void): () => void;
}

export type VerifyRequest =
  | { platform: 'apple'; transactionId: string }
  | { platform: 'google'; purchaseToken: string; productId: string };

export interface BillingApi {
  getBilling(): Promise<BillingStatus>;
  verifyPurchase(request: VerifyRequest): Promise<BillingStatus>;
}

export type VerifyOutcome =
  | { kind: 'verified'; status: BillingStatus }
  | { kind: 'linked_elsewhere' }
  | { kind: 'ignored' }
  | { kind: 'failed'; message: string };

export const PRODUCT_IDS: string[] = Object.values(SUBSCRIPTION_PRODUCT_IDS);

export function verifyRequestFor(purchase: StorePurchase): VerifyRequest | null {
  if (purchase.platform === 'apple' && purchase.transactionId) return { platform: 'apple', transactionId: purchase.transactionId };
  if (purchase.platform === 'google' && purchase.purchaseToken) {
    return { platform: 'google', purchaseToken: purchase.purchaseToken, productId: purchase.productId };
  }
  return null;
}

function errorCode(error: unknown): string {
  const body = (error as { body?: unknown })?.body;
  return body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : '';
}

function errorStatus(error: unknown): number {
  return Number((error as { status?: unknown })?.status ?? 0);
}

/**
 * Has the server verify a purchase, then finishes it with the store. A
 * purchase the server couldn't check (offline, store down) is left
 * unfinished: the store hands it back on the next launch and it's tried
 * again, and Google refunds one that's never acknowledged.
 */
export async function verifyAndFinish(store: StoreAdapter, api: BillingApi, purchase: StorePurchase): Promise<VerifyOutcome> {
  if (!tierForProductId(purchase.productId)) return { kind: 'ignored' };
  const request = verifyRequestFor(purchase);
  if (!request) return { kind: 'failed', message: 'The store didn’t return a receipt for this purchase.' };
  try {
    const status = await api.verifyPurchase(request);
    await finishQuietly(store, purchase);
    return { kind: 'verified', status };
  } catch (error) {
    if (errorStatus(error) === 409 && errorCode(error) === 'subscription_linked_to_another_account') {
      // A valid purchase for another Rider Comms account; finishing it here
      // just stops the store re-delivering it.
      await finishQuietly(store, purchase);
      return { kind: 'linked_elsewhere' };
    }
    if (errorStatus(error) === 503) return { kind: 'failed', message: 'Subscriptions aren’t available right now. You haven’t been charged for anything we couldn’t give you; try again later.' };
    return { kind: 'failed', message: 'We couldn’t confirm your purchase yet. Check your connection; we’ll keep trying.' };
  }
}

async function finishQuietly(store: StoreAdapter, purchase: StorePurchase): Promise<void> {
  try {
    await store.finish(purchase);
  } catch {
    // Already acknowledged by the server (Google), or finished before.
  }
}

export interface RestoreResult {
  status: BillingStatus | null;
  restored: number;
  linkedElsewhere: number;
  failed: number;
}

/** "Restore purchases": re-link every subscription the store account owns. */
export async function restorePurchases(store: StoreAdapter, api: BillingApi): Promise<RestoreResult> {
  const purchases = (await store.availablePurchases()).filter((purchase) => tierForProductId(purchase.productId));
  const result: RestoreResult = { status: null, restored: 0, linkedElsewhere: 0, failed: 0 };
  for (const purchase of purchases) {
    const outcome = await verifyAndFinish(store, api, purchase);
    if (outcome.kind === 'verified') {
      result.restored += 1;
      result.status = outcome.status;
    } else if (outcome.kind === 'linked_elsewhere') {
      result.linkedElsewhere += 1;
    } else if (outcome.kind === 'failed') {
      result.failed += 1;
    }
  }
  result.status ??= await api.getBilling();
  return result;
}

export function restoreMessage(result: RestoreResult): string {
  if (result.restored > 0) return 'Your subscription is restored.';
  if (result.linkedElsewhere > 0) return 'This store account’s subscription belongs to another Rider Comms account. Sign in to that account to use it.';
  if (result.failed > 0) return 'We couldn’t reach the store to restore your purchase. Try again in a moment.';
  return 'No subscription was found for this store account.';
}

/**
 * Google Play changes plan by replacing the current purchase; the App Store
 * does it within the subscription group by itself. Returns the purchase to
 * replace, if any.
 */
export function purchaseToReplace(purchases: StorePurchase[], target: PaidZoneTier): StorePurchase | null {
  return purchases.find((purchase) => {
    const tier = tierForProductId(purchase.productId);
    return purchase.platform === 'google' && tier !== null && tier !== target;
  }) ?? null;
}

export function linkedElsewhereMessage(): string {
  return 'This subscription is already linked to another Rider Comms account. Sign in to that account to use it.';
}
