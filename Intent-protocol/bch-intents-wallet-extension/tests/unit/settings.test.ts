import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, readSettings, writeSettings, getAutoLockMs, isBackedUp, formatAuctionDuration } from '@/lib/settings';

beforeEach(() => (globalThis as any).resetChrome());

describe('settings', () => {
  it('defaults: side panel, system theme', async () => {
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.surface).toBe('panel');
    expect(DEFAULT_SETTINGS.theme).toBe('system');
  });
  it('a damaged record falls back field by field', () => {
    const s = normalizeSettings({ theme: 'neon', language: 'xx', surface: 3, autoLockMinutes: 7, defaultSlippageBps: 9999, defaultAuctionDuration: 100000, hiddenTokens: [1, 'a'] });
    expect(s.theme).toBe('system');
    expect(s.language).toBe('en');
    expect(s.surface).toBe('panel');
    expect(s.autoLockMinutes).toBe(15);
    expect(s.defaultSlippageBps).toBe(100);
    expect(s.defaultAuctionDuration).toBe(300);
    expect(s.hiddenTokens).toEqual(['a']);
  });
  it('persists a patch and keeps the rest', async () => {
    await writeSettings({ theme: 'light', language: 'zh-CN' });
    await writeSettings({ autoLockMinutes: 60 });
    const s = await readSettings();
    expect(s).toMatchObject({ theme: 'light', language: 'zh-CN', autoLockMinutes: 60, surface: 'panel' });
    expect(await getAutoLockMs()).toBe(3_600_000);
  });
  it('unreadable JSON is treated as no settings', async () => {
    (globalThis as any).__store.local.wallet_settings_v1 = '{not json';
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it('backup is recorded per wallet, case-insensitively', () => {
    const s = normalizeSettings({ backedUpWallets: ['0xabc'] });
    expect(isBackedUp(s, '0xABC')).toBe(true);
    expect(isBackedUp(s, '0xdef')).toBe(false);
    expect(isBackedUp(s, null)).toBe(false);
  });
  it('formatAuctionDuration', () => {
    expect(formatAuctionDuration(45)).toBe('45s');
    expect(formatAuctionDuration(90)).toBe('1m 30s');
    expect(formatAuctionDuration(300)).toBe('5m');
  });
});
