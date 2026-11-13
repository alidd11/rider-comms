import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { TokenStorage } from './authClient';

const KEY = 'rider_social_account_session_v1';
let webSession: string | null = null;

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage; } catch { return null; }
}

/** Native secure enclave / Keystore; browser tab session storage only.
 * Never AsyncStorage, localStorage, cookies or a URL parameter for credentials.
 */
export const accountTokenStorage: TokenStorage = {
  async read(): Promise<string | null> {
    if (Platform.OS === 'web') {
      return webSession ?? browserStorage()?.getItem(KEY) ?? null;
    }
    return SecureStore.getItemAsync(KEY);
  },
  async write(value: string): Promise<void> {
    if (Platform.OS === 'web') {
      const storage = browserStorage();
      if (!storage) throw new Error('Session storage unavailable.');
      storage.setItem(KEY, value);
      webSession = value;
      return;
    }
    await SecureStore.setItemAsync(KEY, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async clear(): Promise<void> {
    if (Platform.OS === 'web') {
      webSession = null;
      browserStorage()?.removeItem(KEY);
      return;
    }
    await SecureStore.deleteItemAsync(KEY);
  },
};
