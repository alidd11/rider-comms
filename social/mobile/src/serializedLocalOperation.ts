/**
 * Serialises account-scoped device storage writes and deletions.
 *
 * An older pending save must never finish after a user-initiated deletion,
 * recreating their supposedly deleted private draft. A failed write must not
 * prevent a later delete operation.
 */
const pending = new Map<string, Promise<void>>();

export function serializeLocalOperation(key: string, operation: () => Promise<void>): Promise<void> {
  const previous = pending.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  pending.set(key, next);
  void next.finally(() => {
    if (pending.get(key) === next) pending.delete(key);
  }).catch(() => {});
  return next;
}

export async function awaitLocalOperations(key: string): Promise<void> {
  await pending.get(key)?.catch(() => {});
}
