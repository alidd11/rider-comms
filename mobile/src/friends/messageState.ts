import type { DirectMessage } from '@rider-comms/shared';

export type LocalDirectMessage = DirectMessage & { status?: 'pending' | 'failed' };

/**
 * Merge a refreshed server thread without erasing optimistic messages that
 * have not reached the server yet. Polling used to replace the entire list,
 * which made pending/failed bubbles disappear every ten seconds.
 */
const DELIVERED_MATCH_WINDOW_MS = 2 * 60 * 1000;

/**
 * Also drops a pending/failed local message once the server copy shows up:
 * the server stores it under its own id, so a poll that lands before the
 * send resolves (or after a response lost on a weak signal) would otherwise
 * show it twice, and retrying the "failed" copy would send it twice. A server
 * message from the same sender with the same text, created shortly after the
 * local one, counts as that message delivered (each server copy matches one).
 */
export function reconcileMessageThread(
  current: readonly LocalDirectMessage[],
  fetched: readonly DirectMessage[]
): LocalDirectMessage[] {
  const serverIds = new Set(fetched.map((message) => message.id));
  const claimed = new Set<string>();
  const localOnly = current.filter((message) => {
    if (message.status === undefined || serverIds.has(message.id)) return false;
    if (!message.text || !message.fromRiderId) return true;
    const delivered = fetched.find((server) => !claimed.has(server.id)
      && server.fromRiderId === message.fromRiderId
      && server.text === message.text
      && server.createdAt >= message.createdAt - 5000
      && server.createdAt <= message.createdAt + DELIVERED_MATCH_WINDOW_MS);
    if (!delivered) return true;
    claimed.add(delivered.id);
    return false;
  });
  const merged = [...fetched, ...localOnly];
  merged.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return merged;
}

export function acknowledgeOptimisticMessage(
  current: readonly LocalDirectMessage[],
  localId: string,
  sent: DirectMessage,
): LocalDirectMessage[] {
  const merged = new Map<string, LocalDirectMessage>();
  for (const message of current) {
    if (message.id === localId) continue;
    merged.set(message.id, message);
  }
  merged.set(sent.id, sent);
  return [...merged.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function mergeOlderMessagePage(
  current: readonly LocalDirectMessage[],
  older: readonly DirectMessage[]
): LocalDirectMessage[] {
  const merged = new Map<string, LocalDirectMessage>();
  for (const message of [...older, ...current]) merged.set(message.id, message);
  return [...merged.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
