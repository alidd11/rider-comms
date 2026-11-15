import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountTextDraftKey } from './createDraftKey';
import { awaitLocalOperations, serializeLocalOperation } from './serializedLocalOperation';

/**
 * The composer and Settings must share the same write/delete queue.
 * Never cache media bytes here; only an account-scoped text draft.
 */
export async function loadAccountTextDraft(riderId: string): Promise<string | null> {
  const key = accountTextDraftKey(riderId);
  await awaitLocalOperations(key);
  return AsyncStorage.getItem(key);
}

export function saveAccountTextDraft(riderId: string, value: string): Promise<void> {
  const key = accountTextDraftKey(riderId);
  return serializeLocalOperation(key, () => AsyncStorage.setItem(key, value));
}

export function clearAccountTextDraft(riderId: string): Promise<void> {
  const key = accountTextDraftKey(riderId);
  return serializeLocalOperation(key, () => AsyncStorage.removeItem(key));
}
