import type { RiderProfile } from '@rider-comms/shared';
import { sendExpoPush } from './expoPush.ts';
import type { PushStore, PushSubscriptionRecord } from './pushStore.ts';
import { sendWebPush, type FetchLike } from './webPush.ts';

/** What happened, which decides the rider's preference that applies. */
export type PushEvent = 'friend_request' | 'friend_accepted' | 'message';

export interface PushContent {
  title: string;
  body: string;
  /** Where tapping it opens, as an in-app route: '#friends' or '#chat:<riderId>'. */
  route: string;
  /** Notifications with the same tag replace each other (one per chat). */
  tag: string;
}

// Settings → Notifications: Friend requests (notifyInvites), Messages (notifyChat).
const PREFERENCE: Record<PushEvent, 'notifyInvites' | 'notifyChat'> = {
  friend_request: 'notifyInvites',
  friend_accepted: 'notifyInvites',
  message: 'notifyChat',
};

export interface PushNotifierOptions {
  store: PushStore;
  getProfile: (riderId: string) => Promise<Pick<RiderProfile, 'notifyInvites' | 'notifyChat'>>;
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
      const profile = await this.options.getProfile(riderId);
      if (!profile[PREFERENCE[event]]) return;
      const devices = await this.options.store.listForRider(riderId);
      if (devices.length === 0) return;
      const gone = await this.deliver(devices, event, content);
      await this.options.store.removeAddresses(gone);
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'push_failed', riderId, kind: event, message: error instanceof Error ? error.message : String(error) }));
    }
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
        expo.map((device) => ({ to: device.address, title: content.title, body: content.body, data: { route: content.route, type: event } })),
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
