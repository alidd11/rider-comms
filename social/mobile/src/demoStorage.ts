import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_PROFILE, parsePreviewState } from './garage';
import type { PreviewState } from './garage';

const KEY = '@rider-comms/social-demo/v1';

/**
 * Only local demo profile/garage drafts are stored here. Never store tokens,
 * DOB, documents, real age-verification results, private rides, GPS or DMs.
 */
export async function loadLocalDemo(): Promise<PreviewState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return parsePreviewState(raw ? JSON.parse(raw) as unknown : null, new Date().getFullYear());
  } catch {
    return { profile: DEFAULT_PROFILE, garage: [] };
  }
}

export async function saveLocalDemo(state: PreviewState): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(state));
}
