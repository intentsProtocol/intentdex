/**
 * Encrypted storage for the agent's chats and its saved wallet snapshot.
 *
 * The data sits in AsyncStorage as XChaCha20-Poly1305 ciphertext; the 32-byte key sits in expo-secure-store
 * (the Android Keystore), next to the PIN record. Someone who copies the app's files without the phone's
 * keystore reads nothing. "Remove wallet" deletes the key and the data.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils.js';

const KEY_NAME = 'agent_vault_key_v1';
const PREFIX = 'agent_vault_v1:';

let keyPromise: Promise<Uint8Array> | null = null;

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

async function vaultKey(): Promise<Uint8Array> {
  keyPromise ??= (async () => {
    const stored = await SecureStore.getItemAsync(KEY_NAME);
    if (stored && /^[0-9a-f]{64}$/.test(stored)) return hexToBytes(stored);
    const fresh = randomBytes(32);
    await SecureStore.setItemAsync(KEY_NAME, bytesToHex(fresh), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    return fresh;
  })();
  try { return await keyPromise; } catch (e) { keyPromise = null; throw e; }
}

export async function vaultWrite(name: string, value: unknown): Promise<void> {
  const key = await vaultKey();
  const nonce = randomBytes(24);
  const sealed = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(JSON.stringify(value)));
  await AsyncStorage.setItem(PREFIX + name, bytesToHex(nonce) + bytesToHex(sealed));
}

/** The stored value, or `fallback` when there is none or it cannot be opened (a wiped key, a damaged record). */
export async function vaultRead<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + name);
    if (!raw || raw.length < 48 + 32) return fallback;
    const key = await vaultKey();
    const nonce = hexToBytes(raw.slice(0, 48));
    const opened = xchacha20poly1305(key, nonce).decrypt(hexToBytes(raw.slice(48)));
    return JSON.parse(bytesToUtf8(opened)) as T;
  } catch {
    return fallback;
  }
}

/** For "Remove wallet": the key goes, so anything left behind can no longer be read. */
export async function forgetVault(): Promise<void> {
  keyPromise = null;
  await SecureStore.deleteItemAsync(KEY_NAME).catch(() => {});
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter(k => k.startsWith(PREFIX)));
}
