import { describe, expect, it } from 'vitest';
import { getNetwork, networkOf, NETWORKS } from '@/lib/chains';
import type { Asset } from '@/lib/assets';
import { balanceOf, bchTokens, cctpTokens, counterpart, jupiterTokens, resolveRoute } from '@/swap/tokens';
import type { SolanaToken, SwapServerConfig } from '@/swap/types';

const chain = (key: string, kind: 'evm' | 'solana' = 'evm') => {
  const n = getNetwork(key)!;
  return { key, name: n.name, kind, domain: 0, chainId: n.chainId, usdc: n.usdc!, fastSource: true, standardEtaSec: 900, explorerTx: n.explorerTx };
};

function config(network: 'testnet' | 'mainnet', closedRoutes: string[] = []): SwapServerConfig {
  const keys = network === 'testnet'
    ? ['eth-sepolia', 'base-sepolia', 'arb-sepolia', 'arc-testnet', 'solana-devnet']
    : ['ethereum', 'base', 'arbitrum', 'arc', 'solana'];
  return {
    serverTime: 0,
    cctp: {
      network, paused: false, relayEnabled: true, fastEnabled: true, minTransferUsdc: 1, maxTransferUsdc: 100, createdTtlSec: 3600,
      fee: { bps: 25, minUsdc: 0.01, maxUsdc: 5, gasUsdc: {}, enforced: true, collecting: { evm: true, solana: true } },
      chains: keys.map(k => chain(k, k.startsWith('solana') ? 'solana' : 'evm')), closedRoutes,
    },
    solana: {
      enabled: true, network: 'mainnet', paused: false, stocksEnabled: false, allowUnverified: true, slippage: { defaultBps: 50, maxBps: 1000 },
      maxSwapUsd: 0, orderTtlSec: 120, nativeMint: 'So11111111111111111111111111111111111111112',
      fee: { referralFeeBps: 0, stocksFeeBps: null, stablesFeeBps: null, active: false },
    },
  };
}

const CAT = 'a'.repeat(64);
const tradeable = [{ category: CAT, symbol: 'MOON', name: 'Moon', decimals: 2, known: true, priceSats: 10, priceUsd: 0.01, tvlSats: 1e9 }];
const jup: SolanaToken[] = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', decimals: 9, verified: true, suspicious: false, tags: [], isStock: false },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6, verified: true, suspicious: false, tags: [], isStock: false },
  { mint: 'Stock111111111111111111111111111111111111111', symbol: 'AAPLx', name: 'Apple', decimals: 8, verified: true, suspicious: false, tags: [], isStock: true },
];

describe('token lists', () => {
  it('testnet: BCH, its CashTokens, and one USDC per CCTP chain; no Solana swaps', () => {
    const cfg = config('testnet');
    const all = [...bchTokens('testnet', tradeable, []), ...cctpTokens(cfg, 'testnet'), ...jupiterTokens(cfg, 'testnet', jup)];
    expect(all.filter(t => t.product === 'cashtoken').map(t => t.symbol)).toEqual(['BCH', 'MOON']);
    expect(all.filter(t => t.product === 'cctp')).toHaveLength(5);
    expect(all.filter(t => t.product === 'jupiter')).toHaveLength(0);
  });
  it('a server on the other network contributes nothing: a mainnet wallet never sees testnet routes', () => {
    expect(cctpTokens(config('testnet'), 'mainnet')).toEqual([]);
    expect(cctpTokens(undefined, 'testnet')).toEqual([]);
  });
  it('tokenized stocks are left out of the Solana list', () => {
    expect(jupiterTokens(config('mainnet'), 'mainnet', jup).map(t => t.symbol)).toEqual(['SOL', 'USDC']);
  });
  it('a held CashToken without a pool is still listed', () => {
    const net = networkOf('testnet', 'bch');
    const held: Asset = { id: `${net.key}:${'b'.repeat(64)}`, network: net, kind: 'cashtoken', ref: 'b'.repeat(64), symbol: 'ORPHAN', name: 'Orphan', decimals: 0, balance: 5n, verified: false };
    expect(bchTokens('testnet', tradeable, [held]).map(t => t.symbol)).toEqual(['BCH', 'MOON', 'ORPHAN']);
  });
});

describe('resolveRoute', () => {
  const cfg = config('testnet');
  const bch = bchTokens('testnet', tradeable, []);
  const usdc = cctpTokens(cfg, 'testnet');
  const [BCH, MOON] = bch;
  const base = usdc.find(t => t.net.key === 'base-sepolia')!;
  const arb = usdc.find(t => t.net.key === 'arb-sepolia')!;

  it('BCH and CashTokens go to the relayer, with BCH named as the relayer names it', () => {
    expect(resolveRoute(BCH, MOON, cfg)).toEqual({ kind: 'cashtoken', sell: 'BCH', buy: CAT });
    expect(resolveRoute(MOON, BCH, cfg)).toEqual({ kind: 'cashtoken', sell: CAT, buy: 'BCH' });
  });
  it('USDC on two chains is a bridge', () => {
    const r = resolveRoute(base, arb, cfg);
    expect(r.kind).toBe('cctp');
    if (r.kind === 'cctp') expect([r.src.key, r.dst.key]).toEqual(['base-sepolia', 'arb-sepolia']);
  });
  it('a closed route is refused with its own reason', () => {
    expect(resolveRoute(base, arb, config('testnet', ['base-sepolia>arb-sepolia']))).toEqual({ kind: 'none', reason: 'swap.reason.closed' });
  });
  it('a pair across products has no route and never falls through to an executor', () => {
    expect(resolveRoute(BCH, base, cfg)).toEqual({ kind: 'none', reason: 'swap.reason.usdcOnly' });
    expect(resolveRoute(base, MOON, cfg)).toEqual({ kind: 'none', reason: 'swap.reason.usdcOnly' });
  });
  it('the same token on both sides, or a missing side, is not a route', () => {
    expect(resolveRoute(BCH, BCH, cfg).kind).toBe('none');
    expect(resolveRoute(BCH, undefined, cfg)).toEqual({ kind: 'none', reason: 'swap.reason.pick' });
  });
  it('without the server config, USDC cannot be bridged', () => {
    expect(resolveRoute(base, arb, undefined).kind).toBe('none');
  });
  it('mainnet: two Solana tokens are a Jupiter swap; Solana USDC to Base is a bridge', () => {
    const m = config('mainnet');
    const sol = jupiterTokens(m, 'mainnet', jup);
    const SOL = sol.find(t => t.kind === 'sol')!, jUsdc = sol.find(t => t.symbol === 'USDC')!;
    expect(resolveRoute(SOL, jUsdc, m)).toMatchObject({ kind: 'jupiter', inputMint: SOL.ref, outputMint: jUsdc.ref });
    const baseMain = cctpTokens(m, 'mainnet').find(t => t.net.key === 'base')!;
    expect(resolveRoute(jUsdc, baseMain, m).kind).toBe('cctp');
  });
});

describe('counterpart', () => {
  const cfg = config('testnet');
  const all = [...bchTokens('testnet', tradeable, []), ...cctpTokens(cfg, 'testnet')];
  it('keeps the other side when the pair already works', () => {
    expect(counterpart(all[0], all[1], all, cfg)).toBe(all[1]);
  });
  it('picking bridge USDC moves the other side to USDC on another chain', () => {
    const base = all.find(t => t.net.key === 'base-sepolia')!;
    const other = counterpart(base, all[0], all, cfg)!;
    expect(other.product).toBe('cctp');
    expect(other.net.key).not.toBe('base-sepolia');
  });
  it('picking BCH offers a CashToken, and the reverse', () => {
    expect(counterpart(all[0], undefined, all, cfg)?.symbol).toBe('MOON');
    expect(counterpart(all[1], undefined, all, cfg)?.symbol).toBe('BCH');
  });
});

describe('balanceOf', () => {
  it("counts Arc's 18-decimal native USDC in the bridge's 6 decimals", () => {
    const arc = getNetwork('arc-testnet')!;
    const token = cctpTokens(config('testnet'), 'testnet').find(t => t.net.key === 'arc-testnet')!;
    const native: Asset = { id: 'arc-testnet:native', network: arc, kind: 'native', ref: 'native', symbol: 'USDC', name: 'USD Coin', decimals: 18, balance: 2_500_000_000_000_000_000n, verified: true };
    expect(balanceOf(token, [native])).toBe(2_500_000n);
  });
  it('matches an ERC-20 whatever the case of its address, and is zero when not held', () => {
    const base = getNetwork('base-sepolia')!;
    const token = cctpTokens(config('testnet'), 'testnet').find(t => t.net.key === 'base-sepolia')!;
    const asset: Asset = { id: 'x', network: base, kind: 'erc20', ref: base.usdc!.toUpperCase(), symbol: 'USDC', name: 'USD Coin', decimals: 6, balance: 7n, verified: true };
    expect(balanceOf(token, [asset])).toBe(7n);
    expect(balanceOf(token, [])).toBe(0n);
  });
});

describe('network registry', () => {
  it('every network has what the UI and the signers need', () => {
    for (const n of NETWORKS) {
      expect(n.explorerTx, n.key).toContain('{tx}');
      expect(n.explorerAddress, n.key).toContain('{address}');
      if (n.family === 'evm') { expect(n.chainId, n.key).toBeGreaterThan(0); expect(n.rpc, n.key).toMatch(/^https:\/\//); expect(n.usdc, n.key).toMatch(/^0x[0-9a-fA-F]{40}$/); }
      if (n.mode === 'mainnet') expect(n.faucet, n.key).toBeUndefined();
    }
    expect(new Set(NETWORKS.map(n => n.key)).size).toBe(NETWORKS.length);
  });
  it('both modes cover all four families', () => {
    for (const mode of ['testnet', 'mainnet'] as const) {
      expect(new Set(NETWORKS.filter(n => n.mode === mode).map(n => n.family))).toEqual(new Set(['bch', 'evm', 'solana', 'btc']));
    }
  });
});
