/**
 * User preferences, kept in the app's plain store. The same fields and validation as the browser extension's
 * settings, with what only a phone has (biometric unlock) and without what only a browser has (popup or panel).
 */
import { create } from 'zustand';
import type { Language } from '@bch-intents/wallet-core/i18n';
import type { NetworkMode } from '@bch-intents/wallet-core/chains';
import { readJson, writeJson } from '@/lib/storage';

export const SETTINGS_KEY = 'wallet_settings_v1';

export type ThemePref = 'system' | 'light' | 'dark';

export const AUCTION_DURATION = { min: 5, max: 300, default: 60 };
export const AUCTION_DURATION_PRESETS = [15, 30, 60, 120, 300];
/** Minutes in the background before the wallet locks. 0 locks the moment the app is left. */
export const AUTO_LOCK_MINUTES_OPTIONS = [0, 1, 5, 15, 60];
export const SLIPPAGE_BPS_PRESETS = [50, 100, 200, 500];

/** 45 -> "45s", 90 -> "1m 30s", 300 -> "5m". */
export function formatAuctionDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export interface WalletSettings {
  theme: ThemePref;
  /** Null until the user picks one: the phone's language is used. */
  language: Language | null;
  mode: NetworkMode;
  hideBalances: boolean;
  autoLockMinutes: number;
  /** Offer fingerprint or face on the unlock screen. */
  biometrics: boolean;
  defaultSlippageBps: number;
  defaultAuctionDuration: number;
  /** The owner confirmed a backup of the recovery phrase. */
  backedUp: boolean;
  hiddenTokens: string[];
  showEmptyTokens: boolean;
}

export const DEFAULT_SETTINGS: WalletSettings = {
  theme: 'system',
  language: null,
  mode: 'testnet',
  hideBalances: false,
  autoLockMinutes: 5,
  biometrics: false,
  defaultSlippageBps: 100,
  defaultAuctionDuration: AUCTION_DURATION.default,
  backedUp: false,
  hiddenTokens: [],
  showEmptyTokens: false,
};

const oneOf = <T,>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function clampAuction(seconds: unknown): number {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return AUCTION_DURATION.default;
  return Math.min(AUCTION_DURATION.max, Math.max(AUCTION_DURATION.min, Math.round(n)));
}

/** Anything missing or invalid falls back to its default, so an old or damaged record never breaks the app. */
export function normalizeSettings(raw: unknown): WalletSettings {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<WalletSettings>;
  return {
    theme: oneOf<ThemePref>(p.theme, ['system', 'light', 'dark'], DEFAULT_SETTINGS.theme),
    language: oneOf<Language | null>(p.language, ['en', 'zh-CN', null], null),
    mode: oneOf<NetworkMode>(p.mode, ['testnet', 'mainnet'], DEFAULT_SETTINGS.mode),
    hideBalances: p.hideBalances === true,
    autoLockMinutes: oneOf(p.autoLockMinutes, AUTO_LOCK_MINUTES_OPTIONS, DEFAULT_SETTINGS.autoLockMinutes),
    biometrics: p.biometrics === true,
    defaultSlippageBps: oneOf(p.defaultSlippageBps, SLIPPAGE_BPS_PRESETS, DEFAULT_SETTINGS.defaultSlippageBps),
    defaultAuctionDuration: clampAuction(p.defaultAuctionDuration ?? AUCTION_DURATION.default),
    backedUp: p.backedUp === true,
    hiddenTokens: strings(p.hiddenTokens),
    showEmptyTokens: p.showEmptyTokens === true,
  };
}

interface SettingsState {
  settings: WalletSettings;
  /** False until the stored record has been read; screens wait for it so nothing flashes in the wrong theme. */
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<WalletSettings>) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,
  load: async () => {
    const settings = normalizeSettings(await readJson<unknown>(SETTINGS_KEY, null));
    set({ settings, loaded: true });
  },
  update: patch => {
    const settings = normalizeSettings({ ...get().settings, ...patch });
    set({ settings });
    writeJson(SETTINGS_KEY, settings).catch(() => { /* the change still applies for this session */ });
  },
  reset: () => set({ settings: { ...DEFAULT_SETTINGS } }),
}));

export const useSettings = () => useSettingsStore(s => s.settings);
export const useUpdateSettings = () => useSettingsStore(s => s.update);
