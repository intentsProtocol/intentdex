/**
 * The app PIN: six digits that open the wallet on this phone.
 *
 * What protects the seed is WDK's keychain storage (hardware-backed where the phone has it). The PIN is the
 * app's own gate in front of it, for the moments the phone is unlocked in someone else's hand. Its record, a
 * salted PBKDF2 hash, is kept in the platform's secure store, and wrong attempts are counted there too, so the
 * count survives a restart.
 *
 * A PIN has a million possibilities, which no hash makes slow enough to matter. The limit on attempts is what
 * stops guessing: after five wrong tries the wait doubles each time.
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

const RECORD_KEY = 'bchi_pin_v1';
const ATTEMPTS_KEY = 'bchi_pin_attempts_v1';
const ITERATIONS = 20_000;

export const PIN_LENGTH = 6;
export const FREE_ATTEMPTS = 5;
const MAX_WAIT_MS = 60 * 60_000;

interface PinRecord { salt: string; hash: string; iterations: number }
interface Attempts { failed: number; lockedUntil: number }

/** A PIN is digits, so its bytes are its character codes. */
const pinBytes = (pin: string) => Uint8Array.from(pin, ch => ch.charCodeAt(0) & 0xff);

const derive = (pin: string, salt: Uint8Array, iterations: number) => bytesToHex(pbkdf2(sha256, pinBytes(pin), salt, { c: iterations, dkLen: 32 }));

/** Hashing holds the JavaScript thread for a moment; this lets the screen draw the last digit first. */
const afterPaint = () => new Promise<void>(resolve => setTimeout(resolve, 40));

/** Constant-time comparison, so a wrong guess takes as long as a right one. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const isPin = (pin: string) => new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);

/** A PIN anyone would try first. */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const digits = [...pin].map(Number);
  const up = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 1) % 10);
  const down = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 9) % 10);
  return up || down;
}

export async function hasPin(): Promise<boolean> {
  return (await SecureStore.getItemAsync(RECORD_KEY)) != null;
}

export async function setPin(pin: string): Promise<void> {
  if (!isPin(pin)) throw new Error('The PIN must be six digits.');
  const salt = await Crypto.getRandomBytesAsync(16);
  await afterPaint();
  const record: PinRecord = { salt: bytesToHex(salt), hash: derive(pin, salt, ITERATIONS), iterations: ITERATIONS };
  await SecureStore.setItemAsync(RECORD_KEY, JSON.stringify(record));
  await SecureStore.deleteItemAsync(ATTEMPTS_KEY);
}

async function readAttempts(): Promise<Attempts> {
  try {
    const raw = await SecureStore.getItemAsync(ATTEMPTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Attempts) : null;
    if (parsed && Number.isInteger(parsed.failed) && Number.isFinite(parsed.lockedUntil)) return parsed;
  } catch { /* unreadable: start over */ }
  return { failed: 0, lockedUntil: 0 };
}

/** How long the next attempt must wait after `failed` wrong ones. */
export function waitAfter(failed: number): number {
  if (failed < FREE_ATTEMPTS) return 0;
  return Math.min(MAX_WAIT_MS, 30_000 * 2 ** (failed - FREE_ATTEMPTS));
}

/** "45s", "2m 30s": how long until another attempt. */
export function formatWait(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
}

export type PinResult =
  | { ok: true }
  | { ok: false; reason: 'wrong'; remaining: number; waitMs: number }
  | { ok: false; reason: 'locked'; waitMs: number }
  | { ok: false; reason: 'none' };

/** Milliseconds until another attempt is allowed; 0 when one is allowed now. */
export async function pinWait(now = Date.now()): Promise<number> {
  return Math.max(0, (await readAttempts()).lockedUntil - now);
}

export async function verifyPin(pin: string, now = Date.now()): Promise<PinResult> {
  const raw = await SecureStore.getItemAsync(RECORD_KEY);
  if (!raw) return { ok: false, reason: 'none' };
  const attempts = await readAttempts();
  if (attempts.lockedUntil > now) return { ok: false, reason: 'locked', waitMs: attempts.lockedUntil - now };

  let record: PinRecord;
  try { record = JSON.parse(raw) as PinRecord; } catch { return { ok: false, reason: 'none' }; }
  await afterPaint();
  const matches = isPin(pin) && sameHex(derive(pin, hexToBytes(record.salt), record.iterations), record.hash);
  if (matches) {
    if (attempts.failed) await SecureStore.deleteItemAsync(ATTEMPTS_KEY);
    return { ok: true };
  }
  const failed = attempts.failed + 1;
  const waitMs = waitAfter(failed);
  await SecureStore.setItemAsync(ATTEMPTS_KEY, JSON.stringify({ failed, lockedUntil: waitMs ? now + waitMs : 0 } satisfies Attempts));
  return { ok: false, reason: 'wrong', remaining: Math.max(0, FREE_ATTEMPTS - failed), waitMs };
}

export async function clearPin(): Promise<void> {
  await SecureStore.deleteItemAsync(RECORD_KEY);
  await SecureStore.deleteItemAsync(ATTEMPTS_KEY);
}
