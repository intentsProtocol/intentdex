/**
 * The swap card against recorded-shape answers from the two services.
 *
 * The services are mocked at the network layer, so these tests check the wallet's side of the contract: which
 * service a pair is routed to, what is asked of it, what is shown, and what blocks the button. Signing and
 * settlement need funded wallets and running services; see docs/internal/testing.md for that run.
 */
import type { Page, Route } from '@playwright/test';
import { test, expect, launchWallet, createWallet, type Wallet } from './fixtures';

test.describe.configure({ mode: 'serial' });

let wallet: Wallet & { close: () => Promise<void> };
let page: Page;
const asked: { url: string; body?: any }[] = [];

const CAT = 'ab'.repeat(32);
const chain = (key: string, name: string, chainId: number | undefined, usdc: string, kind = 'evm') =>
  ({ key, name, kind, domain: 0, chainId, usdc, fastSource: true, standardEtaSec: 900, fastEtaSec: 20, explorerTx: 'https://x/{tx}' });
const CONFIG = {
  serverTime: Date.now(),
  cctp: {
    network: 'testnet', paused: false, relayEnabled: true, fastEnabled: true, minTransferUsdc: 1, maxTransferUsdc: 100, createdTtlSec: 3600,
    fee: { bps: 25, minUsdc: 0.01, maxUsdc: 5, gasUsdc: {}, enforced: true, collecting: { evm: true, solana: true } },
    chains: [
      chain('base-sepolia', 'Base Sepolia', 84532, '0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
      chain('arb-sepolia', 'Arbitrum Sepolia', 421614, '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'),
      chain('solana-devnet', 'Solana Devnet', undefined, '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 'solana'),
    ],
    closedRoutes: ['arb-sepolia>solana-devnet'],
  },
  solana: {
    enabled: true, network: 'mainnet', paused: false, stocksEnabled: false, allowUnverified: true, slippage: { defaultBps: 50, maxBps: 1000 },
    maxSwapUsd: 0, orderTtlSec: 120, nativeMint: 'So11111111111111111111111111111111111111112', fee: { referralFeeBps: 0, stocksFeeBps: null, stablesFeeBps: null, active: false },
  },
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function mockServices(p: Page, opts: { swapServer?: boolean } = {}) {
  await p.route('http://localhost:3012/**', route => {
    const url = new URL(route.request().url());
    asked.push({ url: url.pathname + url.search });
    if (opts.swapServer === false) return route.abort('connectionrefused');
    if (url.pathname === '/config') return json(route, CONFIG);
    if (url.pathname === '/quote') {
      const amount = Number(url.searchParams.get('amount'));
      if (amount < 1) return json(route, { error: 'the minimum transfer is 1 USDC', code: 'BELOW_MINIMUM' }, 400);
      const base = String(Math.round(amount * 1e6));
      const receive = String(Math.round((amount - 0.02) * 1e6));
      return json(route, {
        src: url.searchParams.get('src'), dst: url.searchParams.get('dst'), amount: base, protocolFee: '10000', burnAmount: base, speed: 'fast', feeBps: 1,
        expectedFee: '10000', maxFee: '12000', expectedReceive: receive, etaSec: 25, warnings: [],
        display: { amount: String(amount), protocolFee: '0.01', burnAmount: String(amount), expectedFee: '0.01', maxFee: '0.012', expectedReceive: (amount - 0.02).toFixed(2) },
      });
    }
    return json(route, { error: 'not mocked', code: 'NOT_FOUND' }, 404);
  });
  await p.route('http://localhost:3001/**', route => {
    const url = new URL(route.request().url());
    const body = route.request().postDataJSON?.();
    asked.push({ url: url.pathname, body });
    if (url.pathname === '/router/quote') {
      const sell = BigInt(body.sellAmount);
      return json(route, { buyAmount: sell < 5000n ? '0' : (sell / 10n).toString() });
    }
    return json(route, { error: 'not mocked' }, 404);
  });
  await p.route('https://indexer-chipnet.riften.net/**', route => json(route, [
    { token_id: CAT, display_name: 'Moon Token', display_symbol: 'MOON', price_now: 10, price_now_usd: 0.001, tvl_sats: 5e9, change_24h_bp: 120, bcmr: { name: 'Moon Token', token: { symbol: 'MOON', decimals: 2 }, uris: {} } },
  ]));
}

test.beforeAll(async () => {
  wallet = await launchWallet();
  page = await createWallet(wallet);
  await mockServices(page);
});
test.afterAll(async () => { await wallet?.close(); });

test('opens on BCH against a CashToken, asks the relayer for a quote and shows the auction terms', async () => {
  await page.getByTestId('nav-swap').click();
  await expect(page.getByTestId('sell-token')).toContainText('BCH', { timeout: 30_000 });
  await expect(page.getByTestId('buy-token')).toContainText('MOON');

  await page.getByTestId('sell-amount').fill('0.001');
  // 100,000 sats / 10 = 10,000 base units of a 2-decimal token.
  await expect(page.getByTestId('buy-amount')).toHaveValue('100', { timeout: 30_000 });
  await expect(page.getByText('Auction floor', { exact: true })).toBeVisible();
  await expect(page.getByText('50 MOON')).toBeVisible();

  const quote = asked.filter(a => a.url === '/router/quote').pop()!;
  expect(quote.body).toMatchObject({ sellToken: 'BCH', buyToken: CAT, sellAmount: '100000', network: 'chipnet' });
});

test('an empty wallet cannot submit: the button says why', async () => {
  await expect(page.getByTestId('swap-submit')).toBeDisabled();
  await expect(page.getByTestId('swap-submit')).toHaveText('Not enough BCH');
});

test('an amount too small to fill is explained, not quoted as zero', async () => {
  await page.getByTestId('sell-amount').fill('0.00001');
  await expect(page.getByTestId('swap-quote-error')).toContainText('too small', { timeout: 30_000 });
  await expect(page.getByTestId('buy-amount')).toHaveValue('');
});

test('picking bridge USDC moves the other side to USDC on another chain and routes to the swap server', async () => {
  await page.getByTestId('sell-token').click();
  await page.getByTestId('token-search').fill('base');
  await page.getByTestId('token-base-sepolia:0x036cbd53842c5426634e7929541ec2318f3dcf7e').click();
  await expect(page.getByTestId('sell-token')).toContainText('USDC');
  await expect(page.getByTestId('buy-token')).toContainText('USDC');
  await expect(page.getByTestId('buy-token')).toContainText('Arbitrum');

  await page.getByTestId('sell-amount').fill('5');
  await expect(page.getByTestId('buy-amount')).toHaveValue('4.98', { timeout: 30_000 });
  await expect(page.getByText('Service fee')).toBeVisible();
  await expect(page.getByText('about 25 seconds')).toBeVisible();
  expect(asked.some(a => a.url === '/quote?src=base-sepolia&dst=arb-sepolia&amount=5')).toBe(true);
  await expect(page.getByTestId('swap-submit')).toHaveText('Not enough USDC');
});

test("the server's refusal is shown in its own words", async () => {
  await page.getByTestId('sell-amount').fill('0.5');
  await expect(page.getByTestId('swap-quote-error')).toContainText('minimum transfer is 1 USDC', { timeout: 30_000 });
});

test('a pair with no route disables the button and never asks for a quote', async () => {
  const before = asked.length;
  await page.getByTestId('buy-token').click();
  await page.getByTestId('token-search').fill('moon');
  await page.getByTestId(`token-bch-chipnet:${CAT}`).click();
  // Picking a CashToken for the other side pulls the pair back into a product that can execute it.
  await expect(page.getByTestId('sell-token')).toContainText('BCH');
  await page.getByTestId('swap-flip').click();
  await expect(page.getByTestId('sell-token')).toContainText('MOON');
  await expect(page.getByTestId('buy-token')).toContainText('BCH');
  expect(asked.slice(before).filter(a => a.url.startsWith('/quote'))).toHaveLength(0);
});

test('a closed route is named as closed', async () => {
  await page.getByTestId('sell-token').click();
  await page.getByTestId('token-search').fill('arbitrum');
  await page.getByTestId('token-arb-sepolia:0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d').click();
  await page.getByTestId('buy-token').click();
  await page.getByTestId('token-search').fill('solana');
  await page.getByTestId('token-solana-devnet:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU').click();
  await page.getByTestId('sell-amount').fill('5');
  await expect(page.getByTestId('swap-submit')).toHaveText('This route is temporarily closed');
  await expect(page.getByTestId('swap-submit')).toBeDisabled();
});

test('with the swap server down, BCH swaps still work and the outage is stated', async () => {
  const p = await wallet.open('panel');
  await mockServices(p, { swapServer: false });
  await p.getByTestId('nav-swap').click();
  await expect(p.getByTestId('swap-server-down')).toBeVisible({ timeout: 30_000 });
  await expect(p.getByTestId('sell-token')).toContainText('BCH');
  await p.getByTestId('sell-amount').fill('0.001');
  await expect(p.getByTestId('buy-amount')).toHaveValue('100', { timeout: 30_000 });
  await p.getByTestId('sell-token').click();
  await p.getByTestId('token-search').fill('usdc');
  await expect(p.getByText('No tokens match.')).toBeVisible();
  await p.close();
});

test('settings report which services are reachable', async () => {
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('open-services').click();
  const rows = page.getByTestId('service-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveAttribute('data-state', 'up', { timeout: 30_000 });
  // The relayer mock has no /health: an honest "unreachable".
  await expect(rows.nth(1)).toHaveAttribute('data-state', 'down', { timeout: 30_000 });
});
