/**
 * The wallet on its own: onboarding, locking, accounts, networks, settings, receive.
 * No funds are needed; nothing here depends on a balance.
 */
import type { Page } from '@playwright/test';
import { test, expect, launchWallet, importWallet, PASSWORD, TEST_EVM_ADDRESS, type Wallet } from './fixtures';

test.describe.configure({ mode: 'serial' });

let wallet: Wallet & { close: () => Promise<void> };
let page: Page;

test.beforeAll(async () => { wallet = await launchWallet(); });
test.afterAll(async () => { await wallet?.close(); });

test('create a wallet: password, phrase, backup check', async () => {
  page = await wallet.open('panel');

  // An invalid phrase is refused before a password is ever asked.
  await page.getByTestId('import-wallet').click();
  await page.getByTestId('import-phrase').fill('test test test test test test test test test test test test');
  await page.getByTestId('import-continue').click();
  await expect(page.getByTestId('import-error')).toBeVisible();
  await expect(page.getByTestId('password')).toHaveCount(0);
  await page.getByTestId('back').click();

  await page.getByTestId('create-wallet').click();

  // A password that does not match its confirmation cannot continue.
  await page.getByTestId('password').fill(PASSWORD);
  await page.getByTestId('password-confirm').fill('something else');
  await page.getByTestId('password-agree').check();
  await expect(page.getByTestId('password-submit')).toBeDisabled();
  await page.getByTestId('password-confirm').fill(PASSWORD);
  await page.getByTestId('password-submit').click();

  // The phrase is hidden until revealed, and "continue" waits for that.
  await expect(page.getByTestId('phrase-continue')).toBeDisabled();
  await page.getByTestId('reveal-phrase').click();
  const words = await page.locator('[data-word]').evaluateAll(els => els.map(e => e.getAttribute('data-word')!));
  expect(words).toHaveLength(12);
  await page.getByTestId('phrase-continue').click();

  // Wrong words are refused; the right ones create the wallet.
  const inputs = page.locator('[data-testid^="confirm-word-"]');
  await expect(inputs).toHaveCount(3);
  const positions = await inputs.evaluateAll(els => els.map(e => Number(e.getAttribute('data-testid')!.replace('confirm-word-', ''))));
  for (let i = 0; i < 3; i++) await inputs.nth(i).fill('wrong');
  await page.getByTestId('confirm-submit').click();
  await expect(page.getByRole('alert')).toBeVisible();
  for (let i = 0; i < 3; i++) await inputs.nth(i).fill(words[positions[i] - 1]);
  await page.getByTestId('confirm-submit').click();

  await expect(page.getByTestId('onboarding-done')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('open-wallet').click();
  await expect(page.getByTestId('account-trigger')).toBeVisible();
  // A confirmed backup means no backup warning on the home screen.
  await expect(page.getByTestId('backup-banner')).toHaveCount(0);
  await expect(page.getByTestId('network-pill')).toContainText('Testnet');
});

test('nothing secret is stored in the clear', async () => {
  const stored = await page.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
  const words = (await page.evaluate(async () => (await chrome.storage.session.get('wdk_session_seed')).wdk_session_seed as string)).split(' ');
  expect(words).toHaveLength(12);
  // The phrase is in session storage (memory) while unlocked, and only encrypted on disk.
  expect(stored).toContain('bch-intents-encrypted-wallet');
  for (const w of words.filter(w => w.length > 4)) expect(stored).not.toContain(`${w} `);
  expect(stored).not.toContain(PASSWORD);
});

test('lock, wrong password, unlock', async () => {
  await page.getByTestId('lock-button').click();
  await expect(page.getByTestId('unlock-password')).toBeVisible();
  expect(await page.evaluate(async () => (await chrome.storage.session.get('wdk_session_seed')).wdk_session_seed)).toBeUndefined();

  await page.getByTestId('unlock-password').fill('not the password');
  await page.getByTestId('unlock-submit').click();
  await expect(page.getByTestId('unlock-error')).toBeVisible();

  await page.getByTestId('unlock-password').fill(PASSWORD);
  await page.getByTestId('unlock-submit').click();
  await expect(page.getByTestId('account-trigger')).toBeVisible({ timeout: 60_000 });
});

test('remove the wallet, then import a known phrase: the addresses are the standard ones', async () => {
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('open-remove').click();
  await page.getByTestId('gate-password').fill(PASSWORD);
  await page.getByTestId('gate-submit').click();
  await expect(page.getByTestId('remove-wallet')).toBeDisabled();
  await page.getByTestId('remove-confirm').fill('remove');
  await page.getByTestId('remove-wallet').click();
  await expect(page.getByTestId('create-wallet')).toBeVisible({ timeout: 30_000 });
  await page.close();

  page = await importWallet(wallet);
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('open-addresses').click();
  // MetaMask derives this address from the same phrase.
  await expect(page.getByTestId('address-eth')).toContainText(TEST_EVM_ADDRESS);
  await expect(page.getByTestId('address-bch').first()).toContainText('bchtest:q');
  await expect(page.getByTestId('address-btc')).toContainText('tb1q');
  await expect(page.getByTestId('address-sol')).toBeVisible();
  await page.getByTestId('back').click();
});

test('settings: theme and language apply at once and survive a reload', async () => {
  await expect(page.getByTestId('settings-root')).toBeVisible();
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByTestId('language-select').selectOption('zh-CN');
  await expect(page.getByTestId('nav-settings')).toContainText('设置');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

  await page.reload();
  await expect(page.getByTestId('nav-settings')).toContainText('设置', { timeout: 60_000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByTestId('nav-settings').click();
  await page.getByTestId('language-select').selectOption('en');
  await expect(page.getByTestId('nav-settings')).toContainText('Settings');
});

test('settings: trading defaults, auto-lock and hide balances persist', async () => {
  await page.getByTestId('autolock-select').selectOption('60');
  await page.getByTestId('hide-balances').click();
  await page.getByTestId('open-trading').click();
  await page.getByRole('radio', { name: '2%' }).click();
  await page.getByRole('radio', { name: '2m' }).click();
  await expect(page.getByTestId('auction-value')).toHaveText('2m');
  await page.getByTestId('back').click();

  const stored = await page.evaluate(async () => JSON.parse((await chrome.storage.local.get('wallet_settings_v1')).wallet_settings_v1));
  expect(stored).toMatchObject({ autoLockMinutes: 60, hideBalances: true, defaultSlippageBps: 200, defaultAuctionDuration: 120 });

  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('portfolio-total')).toContainText('••••');
  await page.getByTestId('toggle-hide').click();
  await expect(page.getByTestId('portfolio-total')).not.toContainText('••••');
});

test('settings: recovery phrase needs the password again', async () => {
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('open-recovery').click();
  await page.getByTestId('gate-password').fill('wrong');
  await page.getByTestId('gate-submit').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('recovery-grid')).toHaveCount(0);
  await page.getByTestId('gate-password').fill(PASSWORD);
  await page.getByTestId('gate-submit').click();
  await page.getByTestId('recovery-reveal').click();
  await expect(page.getByTestId('recovery-grid')).toContainText('junk');
  await page.getByTestId('back').click();
});

test('settings: change password, and the old one stops working', async () => {
  const next = 'a brand new password 7?';
  await page.getByTestId('open-password').click();
  await page.getByTestId('current-password').fill(PASSWORD);
  await page.getByTestId('password').fill(next);
  await page.getByTestId('password-confirm').fill(next);
  await page.getByTestId('change-password-submit').click();
  await expect(page.getByTestId('password-changed')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByTestId('settings-lock').click();
  await page.getByTestId('unlock-password').fill(PASSWORD);
  await page.getByTestId('unlock-submit').click();
  await expect(page.getByTestId('unlock-error')).toBeVisible();
  await page.getByTestId('unlock-password').fill(next);
  await page.getByTestId('unlock-submit').click();
  // Unlocking returns to where the user was: Settings.
  await expect(page.getByTestId('settings-root')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('nav-home').click();
});

test('accounts: add one, it has its own addresses, and switching back restores the first', async () => {
  await page.getByTestId('account-trigger').click();
  await expect(page.getByTestId('account-row-0')).toBeVisible();
  await page.getByTestId('add-account').click();
  await expect(page.getByTestId('account-trigger')).toContainText('Account 2', { timeout: 60_000 });

  await page.getByTestId('nav-settings').click();
  await page.getByTestId('open-addresses').click();
  // m/44'/60'/0'/0/1: the address MetaMask shows as Account 2 for this phrase.
  await expect(page.getByTestId('address-eth')).toContainText('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
  await page.getByTestId('back').click();
  await page.getByTestId('nav-home').click();

  await page.getByTestId('account-trigger').click();
  await page.getByTestId('account-row-0').click();
  await expect(page.getByTestId('account-trigger')).toContainText('Main', { timeout: 60_000 });
});

test('network: mainnet asks first, then every chain follows', async () => {
  await page.getByTestId('network-pill').click();
  await page.getByTestId('network-mainnet').click();
  await expect(page.getByTestId('confirm-mainnet')).toBeVisible();
  await page.getByTestId('confirm-mainnet').click();
  await expect(page.getByTestId('network-pill')).toContainText('Mainnet');

  await page.getByTestId('qa-receive').click();
  await expect(page.getByTestId('receive-address')).toContainText('bitcoincash:q');
  await page.getByTestId('receive-btc').click();
  await expect(page.getByTestId('receive-address')).toContainText('bc1q');
  await page.getByTestId('back').click();

  await page.getByTestId('network-pill').click();
  await page.getByTestId('network-testnet').click();
  await expect(page.getByTestId('network-pill')).toContainText('Testnet');
});

test('receive: a QR code and the right address for each chain', async () => {
  await page.getByTestId('qa-receive').click();
  await expect(page.getByTestId('qr')).toBeVisible();
  await expect(page.getByTestId('receive-address')).toContainText('bchtest:q');
  await page.getByRole('radio', { name: 'CashToken address' }).click();
  await expect(page.getByTestId('receive-address')).toContainText('bchtest:z');
  await page.getByTestId('receive-evm').click();
  await expect(page.getByTestId('receive-address')).toContainText(TEST_EVM_ADDRESS);
  // A real QR code of a 42-character address is at least version 3: 29 modules a side.
  const modules = await page.getByTestId('qr').locator('svg').getAttribute('viewBox');
  expect(Number(modules!.split(' ')[2])).toBeGreaterThanOrEqual(29);
  await page.getByTestId('back').click();
});

test('the popup surface is 360 by 600 and the panel fills its window', async () => {
  const popup = await wallet.open('popup');
  await expect(popup.getByTestId('account-trigger')).toBeVisible({ timeout: 60_000 });
  const box = await popup.locator('#root').boundingBox();
  expect(box).toMatchObject({ width: 360, height: 600 });
  await popup.close();
  const panel = await page.locator('#root').boundingBox();
  expect(panel!.width).toBe(420);
});
