import { beforeEach, describe, expect, it } from 'vitest';
import { NETWORKS } from '@bch-intents/wallet-core/chains';
import type { ActivityEntry } from '@bch-intents/wallet-core/activity';
import { feesFrom } from '@/lib/fees';
import { parseScanned } from '@/lib/scan';
import { normalizeSettings, DEFAULT_SETTINGS, formatAuctionDuration } from '@/state/settings';
import { FREE_ATTEMPTS, formatWait, hasPin, isPin, isWeakPin, pinWait, setPin, verifyPin, waitAfter, clearPin } from '@/wdk/pin';
import { __store } from './mocks/secure-store';
import wdkConfig from '../wdk.config.js';

const GWEI = 1_000_000_000n;

describe('the worklet configuration', () => {
  it('names a wallet module for every network of the chain table, and nothing else', () => {
    expect(Object.keys(wdkConfig.networks).sort()).toEqual(NETWORKS.map(n => n.key).sort());
  });

  it('gives each family its own module', () => {
    for (const net of NETWORKS) {
      const pkg: string = wdkConfig.networks[net.key].package;
      expect(pkg).toContain({ bch: 'wdk-wallet-bch', evm: 'wdk-wallet-evm', solana: 'wdk-wallet-solana', btc: 'wdk-wallet-btc' }[net.family]);
    }
  });
});

describe('EVM fees', () => {
  it('offers twice the base fee plus the tip', () => {
    expect(feesFrom({ baseFee: 10n * GWEI, priority: 2n * GWEI, gasPrice: null })).toEqual({ maxFeePerGas: 22n * GWEI, maxPriorityFeePerGas: 2n * GWEI });
  });
  it('never goes under the floor of the chain: Arc drops a transaction priced below 20 gwei', () => {
    expect(feesFrom({ baseFee: 1n, priority: 1n, gasPrice: null }, 20).maxFeePerGas).toBe(20n * GWEI);
  });
  it('falls back to the gas price, then to a fixed figure, when the chain reports no base fee', () => {
    expect(feesFrom({ baseFee: null, priority: null, gasPrice: 5n * GWEI }).maxFeePerGas).toBe(10n * GWEI);
    expect(feesFrom({ baseFee: null, priority: null, gasPrice: null })).toEqual({ maxFeePerGas: 30n * GWEI, maxPriorityFeePerGas: GWEI });
  });
  it('never offers a tip above the maximum', () => {
    const fees = feesFrom({ baseFee: 0n, priority: 50n * GWEI, gasPrice: null });
    expect(fees.maxPriorityFeePerGas <= fees.maxFeePerGas).toBe(true);
  });
});

describe('what a scanned code is', () => {
  const chipnet = 'bchtest:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eymt9qmp0k';
  it('reads a cashaddr with its network, and a payment link with its amount', () => {
    expect(parseScanned(chipnet)).toEqual({ kind: 'address', family: 'bch', address: chipnet, mode: 'testnet', amount: undefined });
    expect(parseScanned(`${chipnet}?amount=0.015`)).toMatchObject({ family: 'bch', mode: 'testnet', amount: '0.015' });
    expect(parseScanned(chipnet.toUpperCase())).toMatchObject({ address: chipnet });
  });
  it('finds the network of a cashaddr written without its prefix', () => {
    expect(parseScanned('qr6m7j9njldwwzlg9v7v53unlr4jkmx6eymt9qmp0k')).toMatchObject({ family: 'bch', mode: 'testnet', address: chipnet });
  });
  it('refuses a cashaddr with a wrong checksum', () => {
    expect(parseScanned('bchtest:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eymt9qmp0x')).toEqual({ kind: 'unknown' });
  });
  it('reads an EVM address, plain or as an EIP-681 link with a chain', () => {
    const a = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
    expect(parseScanned(a)).toEqual({ kind: 'address', family: 'evm', address: a, chainId: undefined });
    expect(parseScanned(`ethereum:${a}@8453`)).toMatchObject({ family: 'evm', address: a, chainId: 8453 });
    expect(parseScanned('0x70997970C51812dc3A010C7d01b50e0d17dc79c8')).toEqual({ kind: 'unknown' });   // wrong capitals: a damaged address
  });
  it('reads Solana and Bitcoin addresses, and tells a Bitcoin testnet address from a mainnet one', () => {
    expect(parseScanned('oeYf6KAJkLYhBuR8CiGc6L4D4Xtfepr85fuDgA9kq96')).toMatchObject({ family: 'solana' });
    expect(parseScanned('solana:oeYf6KAJkLYhBuR8CiGc6L4D4Xtfepr85fuDgA9kq96?amount=1.5')).toMatchObject({ family: 'solana', amount: '1.5' });
    expect(parseScanned('tb1qquv9lg5g2r4jkr0ahun0ddfg5xntxjelvmc7t8')).toMatchObject({ family: 'btc', mode: 'testnet' });
    expect(parseScanned('bitcoin:BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ?amount=0.01')).toMatchObject({ family: 'btc', mode: 'mainnet', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', amount: '0.01' });
  });
  it('recognises a WalletConnect code and nothing that only looks like one', () => {
    const uri = 'wc:7f6e504bfad60b485450578e05678ed3e8e8c4751d3c6160be17160d63ec90f9@2?relay-protocol=irn&symKey=587d5484ce2a2a6ee3ba1962fdd7e8588e06200c46823bd18fbd67def96ad303';
    expect(parseScanned(uri)).toEqual({ kind: 'walletconnect', uri });
    expect(parseScanned('wc:hello')).toEqual({ kind: 'unknown' });
    expect(parseScanned('https://example.com')).toEqual({ kind: 'unknown' });
    expect(parseScanned('   ')).toEqual({ kind: 'unknown' });
  });
});

describe('settings', () => {
  it('a damaged or old record falls back field by field', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ theme: 'purple', mode: 'mainnet', autoLockMinutes: 7, defaultAuctionDuration: 9999, hiddenTokens: ['a', 3], biometrics: 'yes' }))
      .toMatchObject({ theme: 'system', mode: 'mainnet', autoLockMinutes: 5, defaultAuctionDuration: 300, hiddenTokens: ['a'], biometrics: false });
  });
  it('a new wallet starts on testnet', () => { expect(DEFAULT_SETTINGS.mode).toBe('testnet'); });
  it('writes an auction length the way people say it', () => {
    expect([45, 60, 90, 300].map(formatAuctionDuration)).toEqual(['45s', '1m', '1m 30s', '5m']);
  });
});

describe('the PIN', () => {
  beforeEach(() => { __store.clear(); });

  it('is six digits, and the obvious ones are refused', () => {
    expect(isPin('123456')).toBe(true);
    expect(isPin('12345')).toBe(false);
    expect(isPin('12345a')).toBe(false);
    for (const weak of ['000000', '123456', '654321', '890123', '111111']) expect(isWeakPin(weak)).toBe(true);
    for (const fine of ['135790', '482913', '112233']) expect(isWeakPin(fine)).toBe(false);
  });

  it('is stored as a salted hash, never as the digits', async () => {
    expect(await hasPin()).toBe(false);
    await setPin('482913');
    expect(await hasPin()).toBe(true);
    const stored = [...__store.values()].join(' ');
    expect(stored).not.toContain('482913');
    expect(JSON.parse(__store.get('bchi_pin_v1')!)).toMatchObject({ iterations: 20_000 });
    expect((await verifyPin('482913')).ok).toBe(true);
    // The same PIN set again gets a new salt, so the two records differ.
    const first = __store.get('bchi_pin_v1');
    await setPin('482913');
    expect(__store.get('bchi_pin_v1')).not.toBe(first);
  });

  it('counts wrong tries, then makes the next one wait, longer each time', async () => {
    await setPin('482913');
    const now = 1_000_000;
    for (let i = 1; i < FREE_ATTEMPTS; i++) {
      expect(await verifyPin('000001', now)).toEqual({ ok: false, reason: 'wrong', remaining: FREE_ATTEMPTS - i, waitMs: 0 });
    }
    expect(await verifyPin('000001', now)).toEqual({ ok: false, reason: 'wrong', remaining: 0, waitMs: 30_000 });
    // While waiting, even the right PIN is not looked at.
    expect(await verifyPin('482913', now + 1000)).toEqual({ ok: false, reason: 'locked', waitMs: 29_000 });
    expect(await pinWait(now + 1000)).toBe(29_000);
    // After the wait a wrong try doubles it; the right PIN clears the count.
    expect(await verifyPin('000001', now + 31_000)).toMatchObject({ reason: 'wrong', waitMs: 60_000 });
    expect((await verifyPin('482913', now + 31_000 + 61_000)).ok).toBe(true);
    expect(await verifyPin('000001', now + 200_000)).toMatchObject({ reason: 'wrong', remaining: FREE_ATTEMPTS - 1, waitMs: 0 });
  });

  it('the wait is capped at an hour, and reads as a time', () => {
    expect(waitAfter(4)).toBe(0);
    expect(waitAfter(5)).toBe(30_000);
    expect(waitAfter(40)).toBe(3_600_000);
    expect([29_000, 60_000, 150_000].map(formatWait)).toEqual(['29s', '1m', '2m 30s']);
  });

  it('without a record there is nothing to check against', async () => {
    expect(await verifyPin('482913')).toEqual({ ok: false, reason: 'none' });
    await setPin('482913');
    await clearPin();
    expect(await hasPin()).toBe(false);
  });
});

describe('the activity list', () => {
  it('keeps the wallet\'s own row over the chain\'s copy of the same transaction, newest first', async () => {
    const { mergeActivity } = await import('@/lib/merge-activity');
    const row = (id: string, at: number, txid?: string): ActivityEntry => ({ id, kind: 'send', status: 'confirmed', network: 'bch-chipnet', account: 'a', at, txid });
    const merged = mergeActivity([row('local', 100, 'tx1')], [row('chain1', 90, 'tx1'), row('chain2', 200, 'tx2')]);
    expect(merged.map(e => e.id)).toEqual(['chain2', 'local']);
  });
});
