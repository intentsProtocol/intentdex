/**
 * AES-GCM encryption/decryption for seed phrase storage.
 * Uses the Web Crypto API — identical to frontend/src/lib/crypto.ts
 * except reads/writes via extLocal (chrome.storage.local) instead of localStorage.
 */

import { extLocal } from '@/lib/ext-storage';

const STORAGE_KEY = 'bch-intents-encrypted-wallet';
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBuffer(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export async function encryptAndStore(seedPhrase: string, password: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(seedPhrase),
  );
  const payload = {
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
    data: bufferToBase64(encrypted),
  };
  await extLocal.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export async function decryptFromStorage(password: string): Promise<string | null> {
  const raw = await extLocal.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const { salt, iv, data } = JSON.parse(raw);
    const key = await deriveKey(password, base64ToBuffer(salt));
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBuffer(iv) as BufferSource },
      key,
      base64ToBuffer(data) as BufferSource,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

export async function hasStoredWallet(): Promise<boolean> {
  return (await extLocal.getItem(STORAGE_KEY)) !== null;
}

export async function clearStoredWallet(): Promise<void> {
  await extLocal.removeItem(STORAGE_KEY);
}
