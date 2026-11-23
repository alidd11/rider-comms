import type { RiderProfile } from '@rider-comms/shared';
import { log } from './log.ts';
import { sendExpoPush } from './expoPush.ts';
import type { PushStore, PushSubscriptionRecord } from './pushStore.ts';
import { sendWebPush, type FetchLike } from './webPush.ts';

/** What happened, which decides the rider's preference that applies. */
export type PushEvent = 'friend_request' | 'friend_accepted' | 'message' | 'regroup' | 'announcement';

export interface PushContent {
  title: string;
  body: string;
  /** Where tapping it opens, as an in-app route: '#friends' or '#chat:<riderId>'. */
  route: string;
  /** Notifications with the same tag replace each other (one per chat). */
  tag: string;
  /** The friend request this is about, for the phone's Accept and Decline buttons. */
  requestId?: string;
}

/**
 * The phone's buttons on a notification (mobile/src/notifications:
 * NOTIFICATION_CATEGORIES): Reply on a message, Accept and Decline on a
 * friend request.
 */
export const PUSH_CATEGORY: Partial<Record<PushEvent, string>> = {
  message: 'message',
  friend_request: 'friend_request',
};

// Settings → Notifications: Friend requests (notifyInvites), Messages (notifyChat).
// A regroup point goes only to riders in that ride, while they ride, so it
// isn't behind a preference: it's the group calling them in.
// Rider Comms updates (notifyUpdates): notifications staff send to every rider.
const PREFERENCE: Record<PushEvent, 'notifyInvites' | 'notifyChat' | 'notifyUpdates' | null> = {
  friend_request: 'notifyInvites',
  friend_accepted: 'notifyInvites',
  message: 'notifyChat',
  regroup: null,
  announcement: 'notifyUpdates',
};

/** Devices per push-service batch in a broadcast (Expo accepts 100). */
const BROADCAST_BATCH = 100;

export interface PushNotifierOptions {
  store: PushStore;
  getProfile: (riderId: string) => Promise<Partial<Pick<RiderProfile, 'notifyInvites' | 'notifyChat' | 'notifyUpdates'>>>;
  fetchImpl?: FetchLike;
  /** VAPID contact: push services reach out here if this server misbehaves. */
  subject?: string;
  expoAccessToken?: string;
}

/**
 * Sends a notification to every device a rider has registered, if their
 * preference for that kind is on. Never throws: a failed push must not fail
 * the request (the friend request or message itself already succeeded).
 */
export class PushNotifier {
  private readonly options: PushNotifierOptions;
  private readonly fetchImpl: FetchLike;
  private readonly subject: string;

  constructor(options: PushNotifierOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }));
    this.subject = options.subject ?? 'https://ridercomms.app';
  }

  async notify(riderId: string, event: PushEvent, content: PushContent): Promise<void> {
    try {
      const preference = PREFERENCE[event];
      if (preference && (await this.options.getProfile(riderId))[preference] === false) return;
      const devices = await this.options.store.listForRider(riderId);
      if (devices.length === 0) return;
      const gone = await this.deliver(devices, event, content);
      await this.options.store.removeAddresses(gone);
    } catch (error) {
      log('error', 'push_failed', { riderId, kind: event, message: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * A staff push to every rider who allows Rider Comms updates (or only to
   * `onlyRiderId`, for a test). Sends in batches; returns how many riders
   * and devices it was sent to and how many devices accepted it.
   */
  async broadcast(content: PushContent, onlyRiderId?: string): Promise<{ riders: number; devices: number; delivered: number }> {
    const audience = await this.options.store.listBroadcastAudience(onlyRiderId);
    let delivered = 0;
    for (let start = 0; start < audience.length; start += BROADCAST_BATCH) {
      const batch = audience.slice(start, start + BROADCAST_BATCH);
      try {
        const gone = await this.deliver(batch, 'announcement', content);
        delivered += batch.length - gone.length;
        await this.options.store.removeAddresses(gone);
      } catch (error) {
        log('error', 'push_broadcast_batch_failed', { message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { riders: new Set(audience.map((device) => device.riderId)).size, devices: audience.length, delivered };
  }

  private async deliver(devices: PushSubscriptionRecord[], event: PushEvent, content: PushContent): Promise<string[]> {
    const gone: string[] = [];
    const web = devices.filter((device) => device.kind === 'web' && device.p256dh && device.auth);
    const expo = devices.filter((device) => device.kind === 'expo');
    if (web.length > 0) {
      const vapid = await this.options.store.getVapidKeys();
      const payload = { title: content.title, body: content.body, route: content.route, tag: content.tag, type: event };
      const results = await Promise.allSettled(web.map((device) =>
        sendWebPush({ endpoint: device.address, p256dh: device.p256dh!, auth: device.auth! }, payload, vapid, this.subject, this.fetchImpl)));
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.gone) gone.push(web[index]!.address);
      });
    }
    if (expo.length > 0) {
      const { goneTokens } = await sendExpoPush(
        expo.map((device) => ({
          to: device.address,
          title: content.title,
          body: content.body,
          data: { route: content.route, type: event, ...(content.requestId ? { requestId: content.requestId } : {}) },
          ...(PUSH_CATEGORY[event] ? { categoryId: PUSH_CATEGORY[event] } : {}),
        })),
        this.fetchImpl,
        this.options.expoAccessToken,
      );
      gone.push(...goneTokens);
    }
    return gone;
  }
}

/** Message previews stay short on a lock screen. */
export function previewText(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
