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
