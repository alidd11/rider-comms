import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_PROFILE, parsePreviewState } from './garage';
import type { PreviewState } from './garage';

/** Preview garage/profile drafts are keyed by an authenticated full account.
 * Never migrate the old unscoped demo cache between different users on one device.
 * No password, token, age assurance, private ride or message is stored here.
 */
function keyFor(riderId: string): string {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(riderId)) throw Error('Invalid Rider Comms account identifier');
  return '@rider-comms/social-demo/v2/' + riderId;
}
export async function loadLocalDemo(riderId: string): Promise<PreviewState> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(riderId));
    return parsePreviewState(raw ? JSON.parse(raw) as unknown : null, new Date().getFullYear());
  } catch {
    return { profile: DEFAULT_PROFILE, garage: [] };
  }
}
export async function saveLocalDemo(riderId: string, state: PreviewState): Promise<void> {
  await AsyncStorage.setItem(keyFor(riderId), JSON.stringify(state));
}
