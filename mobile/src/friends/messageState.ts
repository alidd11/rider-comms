import type { DirectMessage } from '@rider-comms/shared';

export type LocalDirectMessage = DirectMessage & { status?: 'pending' | 'failed' };

/**
 * Merge a refreshed server thread without erasing optimistic messages that
 * have not reached the server yet. Polling used to replace the entire list,
 * which made pending/failed bubbles disappear every ten seconds.
 */
export function reconcileMessageThread(
  current: readonly LocalDirectMessage[],
  fetched: readonly DirectMessage[]
): LocalDirectMessage[] {
  const serverIds = new Set(fetched.map((message) => message.id));
  const localOnly = current.filter(
    (message) => message.status !== undefined && !serverIds.has(message.id)
  );
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
