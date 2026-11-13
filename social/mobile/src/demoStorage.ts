import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_PROFILE, parsePreviewState } from './garage';
import type { PreviewState } from './garage';
import { isSafeRiderStorageId } from './createDraftKey';

/** Device-only profile and garage notes are never shared with the backend.
 * Each Rider Comms account gets a separate storage key. Clearing data waits
 * for all pending writes to finish so an old save cannot recreate deleted data.
 */
const pending = new Map<string, Promise<void>>();
function keyFor(riderId: string): string {
  if (!isSafeRiderStorageId(riderId)) throw Error('Invalid Rider Comms account identifier');
  return '@rider-comms/social-demo/v2/' + riderId;
}
function writeAfterPrior(key: string, operation: () => Promise<void>): Promise<void> {
  const last = pending.get(key) ?? Promise.resolve();
  const next = last.catch(() => {}).then(operation);
  pending.set(key, next);
  void next.finally(() => {
    if (pending.get(key) === next) pending.delete(key);
  }).catch(() => {});
  return next;
}
export async function loadLocalDemo(riderId: string): Promise<PreviewState> {
  try {
    const key = keyFor(riderId);
    await (pending.get(key) ?? Promise.resolve());
    const raw = await AsyncStorage.getItem(key);
    return parsePreviewState(raw ? JSON.parse(raw) as unknown : null, new Date().getFullYear());
  } catch {
    return { profile: DEFAULT_PROFILE, garage: [] };
  }
}
export async function saveLocalDemo(riderId: string, state: PreviewState): Promise<void> {
  const key = keyFor(riderId);
  const snapshot = JSON.stringify(state);
  await writeAfterPrior(key, () => AsyncStorage.setItem(key, snapshot));
}
export async function clearLocalDemo(riderId: string): Promise<void> {
  const key = keyFor(riderId);
  await writeAfterPrior(key, () => AsyncStorage.removeItem(key));
}
