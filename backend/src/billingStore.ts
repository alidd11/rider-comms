import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { higherTier } from '@rider-comms/shared';
import type { BillingPlatform, BillingStatus, BillingSubscription, PaidZoneTier, ZoneTier } from '@rider-comms/shared';
import { ensureMigrated, getPool } from './db.ts';
import { ProfileStore } from './profileStore.ts';
import { StoreVerificationError } from './storeBilling.ts';
import type { StoreSubscriptionState, StoreVerifier } from './storeBilling.ts';

/** Re-ask the store about subscriptions this close to (or past) their end. */
export const RENEWAL_CHECK_WINDOW_MS = 60 * 60 * 1000;
/** ...but stop asking about ones that ended this long ago. */
export const LAPSED_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 200;

interface SubscriptionRow {
  platform: BillingPlatform;
  original_id: string;
  rider_id: string;
  product_id: string;
  tier: PaidZoneTier;
  expires_at: string | number;
  active: boolean;
  will_renew: boolean;
}

/**
 * The account a purchase is tied to, as a UUID: Apple's appAccountToken
 * must be one, and Google's obfuscatedAccountId accepts it too. It's a hash,
 * so the store never sees the rider ID itself.
 */
export function appAccountTokenFor(riderId: string): string {
  const hex = createHash('sha256').update(`rider-comms-billing:${riderId}`).digest('hex');
  // RFC 4122 layout: version 5 (name-based) and the standard variant.
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function rowToSubscription(row: SubscriptionRow, now: number): BillingSubscription {
  const expiresAt = Number(row.expires_at);
  return {
    platform: row.platform,
    productId: row.product_id,
    tier: row.tier,
    expiresAt,
    active: row.active && expiresAt > now,
    willRenew: row.will_renew,
  };
}

export class BillingStore {
  private readonly verifiers: Partial<Record<BillingPlatform, StoreVerifier>>;
  private readonly profiles: Pick<ProfileStore, 'getOrCreate'>;
  private readonly now: () => number;

  constructor(
    verifiers: Partial<Record<BillingPlatform, StoreVerifier>> = {},
    profiles: Pick<ProfileStore, 'getOrCreate'> = new ProfileStore(),
    now: () => number = Date.now,
  ) {
    this.verifiers = verifiers;
    this.profiles = profiles;
    this.now = now;
  }

  get purchasesEnabled(): boolean {
    return Object.keys(this.verifiers).length > 0;
  }

  async status(riderId: string): Promise<BillingStatus> {
    await ensureMigrated();
    const { rows } = await getPool().query<SubscriptionRow>(
      'SELECT * FROM store_subscriptions WHERE rider_id = $1 ORDER BY expires_at DESC',
      [riderId],
    );
    const now = this.now();
    const subscriptions = rows.map((row) => rowToSubscription(row, now));
    const { tier, expiresAt } = bestTier(subscriptions);
    return {
      tier,
      expiresAt,
      appAccountToken: appAccountTokenFor(riderId),
      subscriptions,
      purchasesEnabled: this.purchasesEnabled,
    };
  }

  /** Ask the store about a purchase the app just made or restored, link it
   * to this rider and update their tier. */
  async verifyPurchase(riderId: string, platform: BillingPlatform, id: string, productId?: string): Promise<BillingStatus> {
    const verifier = this.verifiers[platform];
    if (!verifier) throw new StoreVerificationError('billing_unavailable', 503);
    const state = await verifier.verify(id, productId);
    // The tier is stored on the profile, so make sure there is one.
    await this.profiles.getOrCreate(riderId);
    await this.record(state, riderId);
    return this.status(riderId);
  }

  /**
   * Save the store's answer. A subscription belongs to the first account
   * that verified it; another account can't claim it while that one exists
   * (deleting the account releases it). With no `riderId` (a renewal check
   * or store notification) only an already-linked subscription is updated.
   */
  async record(state: StoreSubscriptionState, riderId?: string): Promise<void> {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [`billing:${state.platform}:${state.originalId}`]);
      const { rows } = await client.query<{ rider_id: string }>(
        'SELECT rider_id FROM store_subscriptions WHERE platform = $1 AND original_id = $2',
        [state.platform, state.originalId],
      );
      const owner = rows[0]?.rider_id;
      if (owner && riderId && owner !== riderId) throw new StoreVerificationError('subscription_linked_to_another_account', 409);
      const linkedRider = owner ?? riderId;
      if (!linkedRider) {
        await client.query('ROLLBACK');
        return;
      }
      await client.query(
        `INSERT INTO store_subscriptions
           (platform, original_id, rider_id, product_id, tier, expires_at, active, will_renew, environment, verified_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (platform, original_id) DO UPDATE SET
           product_id = EXCLUDED.product_id,
           tier = EXCLUDED.tier,
           expires_at = EXCLUDED.expires_at,
           active = EXCLUDED.active,
           will_renew = EXCLUDED.will_renew,
           environment = EXCLUDED.environment,
           verified_at = EXCLUDED.verified_at`,
        [state.platform, state.originalId, linkedRider, state.productId, state.tier, state.expiresAt, state.active, state.willRenew, state.environment, this.now()],
      );
      await this.applyTier(client, linkedRider);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Copy the rider's best active subscription onto their profile. */
  private async applyTier(client: PoolClient, riderId: string): Promise<void> {
    const { rows } = await client.query<SubscriptionRow>('SELECT * FROM store_subscriptions WHERE rider_id = $1', [riderId]);
    const now = this.now();
    const { tier, expiresAt } = bestTier(rows.map((row) => rowToSubscription(row, now)));
    await client.query(
      'UPDATE rider_profiles SET zone_tier = $2, zone_tier_expires_at = $3 WHERE rider_id = $1',
      [riderId, tier, expiresAt],
    );
  }

  /** A store notification or renewal check for one subscription. */
  async refresh(platform: BillingPlatform, originalId: string): Promise<void> {
    const verifier = this.verifiers[platform];
    if (!verifier) return;
    await ensureMigrated();
    const { rows } = await getPool().query<SubscriptionRow>(
      'SELECT * FROM store_subscriptions WHERE platform = $1 AND original_id = $2',
      [platform, originalId],
    );
    const row = rows[0];
    if (!row) return;
    let state: StoreSubscriptionState;
    try {
      state = await verifier.verify(row.original_id, row.product_id);
    } catch (error) {
      // Gone from the store (refunded and expunged, or a replaced Google
      // token): it no longer entitles anything.
      if (error instanceof StoreVerificationError && error.status === 404) {
        state = { platform, originalId, productId: row.product_id, tier: row.tier, expiresAt: Number(row.expires_at), active: false, willRenew: false, accountToken: null, environment: 'production' };
      } else {
        throw error;
      }
    }
    await this.record({ ...state, originalId: row.original_id });
  }

  /**
   * Renewals: re-check subscriptions about to end or recently ended, so a
   * renewed one keeps its tier and a cancelled one drops to Free. Store
   * notifications make this faster but it doesn't depend on them.
   */
  async sweep(): Promise<{ checked: number; failed: number }> {
    if (!this.purchasesEnabled) return { checked: 0, failed: 0 };
    await ensureMigrated();
    const now = this.now();
    const { rows } = await getPool().query<SubscriptionRow>(
      `SELECT * FROM store_subscriptions
       WHERE active AND expires_at < $1 AND expires_at > $2
       ORDER BY verified_at ASC
       LIMIT ${SWEEP_BATCH}`,
      [now + RENEWAL_CHECK_WINDOW_MS, now - LAPSED_RECHECK_MS],
    );
    let failed = 0;
    for (const row of rows) {
      try {
        await this.refresh(row.platform, row.original_id);
      } catch (error) {
        failed += 1;
        console.error(JSON.stringify({ level: 'error', event: 'billing_refresh_failed', platform: row.platform, message: error instanceof Error ? error.message : String(error) }));
      }
    }
    return { checked: rows.length, failed };
  }
}

function bestTier(subscriptions: BillingSubscription[]): { tier: ZoneTier; expiresAt: number | null } {
  let tier: ZoneTier = 'free';
  let expiresAt: number | null = null;
  for (const subscription of subscriptions) {
    if (!subscription.active) continue;
    const next = higherTier(tier, subscription.tier);
    if (next !== tier) {
      tier = next;
      expiresAt = subscription.expiresAt;
    } else if (subscription.tier === tier) {
      expiresAt = Math.max(expiresAt ?? 0, subscription.expiresAt);
    }
  }
  return { tier, expiresAt };
}
