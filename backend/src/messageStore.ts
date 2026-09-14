import { randomUUID } from 'node:crypto';
import type { DirectMessage } from '@rider-comms/shared';

/**
 * Direct messages between friends. Poll-based, same as presence (see
 * presenceStore.ts) — there's no websocket/push infra in this prototype, so
 * a thread's history is fetched with GET /messages and the client is
 * expected to poll it, same as it polls /presence.
 */
export class MessageStore {
  private messages: DirectMessage[] = [];

  create(fromRiderId: string, toRiderId: string, text: string): DirectMessage {
    const message: DirectMessage = {
      id: randomUUID(),
      fromRiderId,
      toRiderId,
      text,
      createdAt: Date.now(),
    };
    this.messages.push(message);
    return message;
  }

  getThread(riderId: string, withRiderId: string): DirectMessage[] {
    return this.messages
      .filter(
        (m) =>
          (m.fromRiderId === riderId && m.toRiderId === withRiderId) ||
          (m.fromRiderId === withRiderId && m.toRiderId === riderId)
      )
      .sort((a, b) => a.createdAt - b.createdAt);
  }
}
