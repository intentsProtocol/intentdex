/**
 * Wallet settings — user preferences persisted to chrome.storage.local.
 *
 * The extension counterpart of frontend/src/lib/appSettings.ts: the same fields and validation, read and written
 * through extLocal, plus the two that only an extension has (theme lives here instead of its own key, and
 * `surface` picks between the docked side panel and the classic popup).
 */

import { extLocal } from '@/lib/ext-storage';
import { LANGUAGES, type Language } from '@bch-intents/wallet-core/i18n';

export { LANGUAGES };
export type { Language };

export const SETTINGS_KEY = 'wallet_settings_v1';

export type ThemePref = 'system' | 'light' | 'dark';
export type Surface = 'panel' | 'popup';

export const AUCTION_DURATION = { min: 5, max: 300, step: 1, default: 60 };
/** Quick-select presets shown alongside the duration slider (seconds). */
export const AUCTION_DURATION_PRESETS = [15, 30, 60, 120, 300];

/** Human-friendly label for a duration in seconds — e.g. 45 -> "45s", 90 -> "1m 30s", 300 -> "5m". */
export function formatAuctionDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Inactivity timeouts offered for the wallet auto-lock (minutes). */
export const AUTO_LOCK_MINUTES_OPTIONS = [5, 15, 30, 60];
const AUTO_LOCK_MINUTES_DEFAULT = 15;

/** Max-slippage choices in basis points (100 = 1%). */
export const SLIPPAGE_BPS_PRESETS = [50, 100, 200, 500];
const SLIPPAGE_BPS_DEFAULT = 100;

export interface WalletSettings {
  theme: ThemePref;
  language: Language;
  /** Where the toolbar icon opens the wallet. */
  surface: Surface;
  /** Mask balances everywhere. */
  hideBalances: boolean;
  /** Minutes of inactivity before the wallet locks. */
  autoLockMinutes: number;
  /** Default max slippage for Solana swaps, in bps. */
  defaultSlippageBps: number;
  /** Default Dutch-auction duration for CashToken market swaps, in seconds. */
  defaultAuctionDuration: number;
  /** Wallets (by EVM address, lower-case) whose owner confirmed a recovery-phrase backup. */
  backedUpWallets: string[];
  /** Cash token categories and token keys the user chose to hide from the token list. */
  hiddenTokens: string[];
}

export const DEFAULT_SETTINGS: WalletSettings = {
  theme: 'system',
  language: 'en',
  surface: 'panel',
  hideBalances: false,
  autoLockMinutes: AUTO_LOCK_MINUTES_DEFAULT,
  defaultSlippageBps: SLIPPAGE_BPS_DEFAULT,
  defaultAuctionDuration: AUCTION_DURATION.default,
  backedUpWallets: [],
  hiddenTokens: [],
};

const oneOf = <T,>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function clampAuction(seconds: unknown): number {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return AUCTION_DURATION.default;
  return Math.min(AUCTION_DURATION.max, Math.max(AUCTION_DURATION.min, Math.round(n)));
}

/** Anything missing or invalid falls back to its default, so an old or damaged record never breaks the UI. */
export function normalizeSettings(raw: unknown): WalletSettings {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<WalletSettings>;
  return {
    theme: oneOf<ThemePref>(p.theme, ['system', 'light', 'dark'], DEFAULT_SETTINGS.theme),
    language: oneOf<Language>(p.language, ['en', 'zh-CN'], DEFAULT_SETTINGS.language),
    surface: oneOf<Surface>(p.surface, ['panel', 'popup'], DEFAULT_SETTINGS.surface),
    hideBalances: p.hideBalances === true,
    autoLockMinutes: oneOf(p.autoLockMinutes, AUTO_LOCK_MINUTES_OPTIONS, AUTO_LOCK_MINUTES_DEFAULT),
    defaultSlippageBps: oneOf(p.defaultSlippageBps, SLIPPAGE_BPS_PRESETS, SLIPPAGE_BPS_DEFAULT),
    defaultAuctionDuration: clampAuction(p.defaultAuctionDuration ?? AUCTION_DURATION.default),
    backedUpWallets: strings(p.backedUpWallets),
    hiddenTokens: strings(p.hiddenTokens),
  };
}

export async function readSettings(): Promise<WalletSettings> {
  const raw = await extLocal.getItem(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(patch: Partial<WalletSettings>): Promise<WalletSettings> {
  const next = normalizeSettings({ ...(await readSettings()), ...patch });
  await extLocal.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

/** Wallet auto-lock timeout in milliseconds. */
export async function getAutoLockMs(): Promise<number> {
  return (await readSettings()).autoLockMinutes * 60_000;
}

export const isBackedUp = (s: WalletSettings, walletId: string | null | undefined) =>
  !!walletId && s.backedUpWallets.includes(walletId.toLowerCase());
