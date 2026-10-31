/**
 * The app's plain store: settings, activity, caches. Nothing secret goes here.
 *
 * Secrets live elsewhere: the seed in WDK's keychain storage, the PIN record in expo-secure-store (see wdk/pin.ts).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValueStore } from '@bch-intents/wallet-core/platform';

export const appStore: KeyValueStore = {
  getItem: key => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: key => AsyncStorage.removeItem(key),
};

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export const writeJson = (key: string, value: unknown) => AsyncStorage.setItem(key, JSON.stringify(value));

/** Everything this app wrote, for "Remove wallet". WDK's own records are removed by deleteWallet. */
export async function clearAppStore(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  // WalletConnect keeps its pairings under its own prefix; those go too, so no site stays connected.
  await AsyncStorage.multiRemove(keys.filter(k => !k.startsWith('wdk')));
}
