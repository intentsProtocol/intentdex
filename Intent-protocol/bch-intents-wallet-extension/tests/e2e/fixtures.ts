/**
 * Launches Chromium with the built extension loaded and gives each test file a clean profile.
 *
 * The wallet UI is one page served at src/popup/index.html; `surface` picks how it lays itself out. Tests open
 * it in a tab with surface=panel, which is the same document the docked side panel shows.
 */
import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const DIST = resolve('dist');
export const DAPP_URL = 'http://localhost:4173/test-extension.html';
export const PASSWORD = 'correct horse battery 9!';

/** The Hardhat/Anvil test phrase: its addresses are public knowledge, which makes them good assertions. */
export const TEST_PHRASE = 'test test test test test test test test test test test junk';
export const TEST_EVM_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

export interface Wallet {
  context: BrowserContext;
  extensionId: string;
  /** Open the wallet UI in a tab. */
  open: (surface?: 'panel' | 'popup' | 'tab', hash?: string) => Promise<Page>;
}

export async function launchWallet(): Promise<Wallet & { close: () => Promise<void> }> {
  if (!existsSync(join(DIST, 'manifest.json'))) throw new Error('dist/ is missing. Run `npm run build` before the e2e tests.');
  const profile = mkdtempSync(join(tmpdir(), 'bchi-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    viewport: { width: 420, height: 760 },
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;

  // Installing opens the onboarding tab; tests open their own.
  const open = async (surface: 'panel' | 'popup' | 'tab' = 'panel', hash = '') => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html?surface=${surface}${hash}`);
    return page;
  };
  return {
    context, extensionId, open,
    close: async () => { await context.close(); rmSync(profile, { recursive: true, force: true }); },
  };
}

/** Import the test phrase through the real onboarding screens and land on the home screen. */
export async function importWallet(wallet: Wallet, phrase = TEST_PHRASE): Promise<Page> {
  const page = await wallet.open('panel');
  await page.getByTestId('import-wallet').click();
  await page.getByTestId('import-phrase').fill(phrase);
  await page.getByTestId('import-continue').click();
  await page.getByTestId('password').fill(PASSWORD);
  await page.getByTestId('password-confirm').fill(PASSWORD);
  await page.getByTestId('password-agree').check();
  await page.getByTestId('password-submit').click();
  await expect(page.getByTestId('onboarding-done')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('open-wallet').click();
  await expect(page.getByTestId('account-trigger')).toBeVisible();
  return page;
}

/**
 * Create a brand-new wallet through the real onboarding screens (skipping the backup check) and land on home.
 * A fresh phrase holds nothing, which is what the "cannot pay" tests need. The public test phrase does not
 * qualify: people keep sending testnet funds to it.
 */
export async function createWallet(wallet: Wallet): Promise<Page> {
  const page = await wallet.open('panel');
  await page.getByTestId('create-wallet').click();
  await page.getByTestId('password').fill(PASSWORD);
  await page.getByTestId('password-confirm').fill(PASSWORD);
  await page.getByTestId('password-agree').check();
  await page.getByTestId('password-submit').click();
  await page.getByTestId('reveal-phrase').click();
  await page.getByTestId('phrase-continue').click();
  await page.getByTestId('confirm-skip').click();
  await expect(page.getByTestId('onboarding-done')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('open-wallet').click();
  await expect(page.getByTestId('account-trigger')).toBeVisible();
  return page;
}

export const test = base;
export { expect };
