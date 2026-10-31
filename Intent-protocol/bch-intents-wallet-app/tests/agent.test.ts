import { describe, expect, it } from 'vitest';
import {
  buildSnapshot,
  isSnapshot,
  quickIntent,
  parseName,
  findTradeable,
  suggestTokens,
  guessProduct,
  resolveDesiredAmount,
  AGENT_TOOLS,
  toolByName,
  type WalletSnapshot,
  type SnapshotInput,
} from '@bch-intents/wallet-core/agent';
import { networkOf } from '@bch-intents/wallet-core/chains';

function sampleSnapshot(overrides?: Partial<SnapshotInput>): WalletSnapshot {
  const bchNet = networkOf('testnet', 'bch');
  const baseInput: SnapshotInput = {
    at: 1700000000000,
    mode: 'testnet',
    accountIndex: 0,
    assets: [
      {
        id: `${bchNet.key}:native`,
        network: bchNet,
        kind: 'native',
        ref: 'native',
        symbol: 'BCH',
        name: 'Bitcoin Cash',
        decimals: 8,
        balance: 50_000_000n, // 0.5 BCH
        verified: true,
      },
      {
        id: `${bchNet.key}:1111111111111111111111111111111111111111111111111111111111111111`,
        network: bchNet,
        kind: 'cashtoken',
        ref: '1111111111111111111111111111111111111111111111111111111111111111',
        symbol: 'MESH',
        name: 'Mesh Token',
        decimals: 2,
        balance: 10_000n, // 100.00 MESH
        verified: true,
      },
    ],
    prices: {
      BCH: { usd: 400 },
      BTC: { usd: 65000 },
      ETH: { usd: 3500 },
      SOL: { usd: 150 },
      USDC: { usd: 1 },
    },
    tradeable: [
      {
        category: '1111111111111111111111111111111111111111111111111111111111111111',
        symbol: 'MESH',
        name: 'Mesh Token',
        decimals: 2,
        priceSats: 25000, // 0.00025 BCH per token
        priceUsd: 0.1,
        tvlSats: 50_000_000,
        known: true,
      },
      {
        category: '2222222222222222222222222222222222222222222222222222222222222222',
        symbol: 'FURRY',
        name: 'Furry Coin',
        decimals: 0,
        priceSats: 1000,
        priceUsd: 0.004,
        tvlSats: 20_000_000,
        known: true,
      },
    ],
    positions: [],
    activity: [],
    ...overrides,
  };
  return buildSnapshot(baseInput);
}

describe('Snapshot Caching and Validation', () => {
  it('builds a valid snapshot and recognizes it with isSnapshot', () => {
    const snap = sampleSnapshot();
    expect(isSnapshot(snap)).toBe(true);
    expect(snap.mode).toBe('testnet');
    expect(snap.assets.length).toBe(2);
    expect(snap.tokens.length).toBe(2);
    expect(snap.usd.BCH).toBe(400);
  });

  it('rejects corrupt snapshots', () => {
    expect(isSnapshot(null)).toBe(false);
    expect(isSnapshot({})).toBe(false);
    expect(isSnapshot({ version: 2 })).toBe(false);
    expect(isSnapshot({ version: 1, at: 'not-a-number' })).toBe(false);
  });
});

describe('Amount Resolution and Desired Amounts', () => {
  it('resolves exact amounts within balance', () => {
    const res = resolveDesiredAmount('0.1', 50_000_000n, 8);
    expect(res.ok).toBe(true);
    expect(res.value).toBe(10_000_000n);
    expect(res.exceeds).toBe(false);
  });

  it('resolves exact amounts exceeding balance with exceeds: true', () => {
    const res = resolveDesiredAmount('2.5', 50_000_000n, 8);
    expect(res.ok).toBe(true);
    expect(res.value).toBe(250_000_000n);
    expect(res.exceeds).toBe(true);
  });

  it('resolves fractions with fallback when balance is zero', () => {
    const fallback = 10_000_000n; // 0.1 BCH
    const res = resolveDesiredAmount('half', 0n, 8, fallback);
    expect(res.ok).toBe(true);
    expect(res.value).toBe(5_000_000n);
    expect(res.exceeds).toBe(true);
  });

  it('resolves Swahili fractions', () => {
    const res = resolveDesiredAmount('nusu', 40_000_000n, 8);
    expect(res.ok).toBe(true);
    expect(res.value).toBe(20_000_000n);
    expect(res.exceeds).toBe(false);
  });
});

describe('Quick Intent Matching', () => {
  let idCounter = 0;
  const newId = () => `test-${++idCounter}`;

  it('matches wallet balance queries', () => {
    const q1 = quickIntent('What do I hold?', newId);
    expect(q1?.name).toBe('wallet_balance');

    const q2 = quickIntent('show my balances', newId);
    expect(q2?.name).toBe('wallet_balance');
  });

  it('matches mesh positions and activity queries', () => {
    const q1 = quickIntent('show my mesh positions', newId);
    expect(q1?.name).toBe('my_positions');

    const q2 = quickIntent('show recent transactions', newId);
    expect(q2?.name).toBe('recent_activity');
  });

  it('matches swap intents directly', () => {
    const q = quickIntent('swap 0.01 BCH for MESH', newId);
    expect(q?.name).toBe('plan_swap');
    expect(q?.arguments.sell).toBe('BCH');
    expect(q?.arguments.buy).toBe('MESH');
    expect(q?.arguments.amount).toBe('0.01');
  });

  it('matches CCTP bridge intents', () => {
    const q = quickIntent('bridge 5 USDC to base', newId);
    expect(q?.name).toBe('plan_swap');
    expect(q?.arguments.amount).toBe('5');
    expect(q?.arguments.buy).toBe('usdc on base');
  });

  it('matches strategy accumulate ladder intents', () => {
    const q = quickIntent('accumulate MESH with 0.1 BCH', newId);
    expect(q?.name).toBe('plan_strategy');
    expect(q?.arguments.style).toBe('accumulate');
    expect(q?.arguments.token).toBe('MESH');
    expect(q?.arguments.budget).toBe('0.1');
  });

  it('matches take-profit intents', () => {
    const q = quickIntent('take profit on MESH with half my tokens', newId);
    expect(q?.name).toBe('plan_strategy');
    expect(q?.arguments.style).toBe('take-profit');
    expect(q?.arguments.token).toBe('MESH');
  });

  it('matches range market make intents', () => {
    const q = quickIntent('range strategy on MESH with 0.2 BCH', newId);
    expect(q?.name).toBe('plan_strategy');
    expect(q?.arguments.style).toBe('range');
    expect(q?.arguments.token).toBe('MESH');
  });

  it('matches limit order intents', () => {
    const q = quickIntent('limit buy MESH at 0.0001 BCH with 0.5 BCH', newId);
    expect(q?.name).toBe('plan_strategy');
    expect(q?.arguments.style).toBe('limit');
    expect(q?.arguments.token).toBe('MESH');
    expect(q?.arguments.price).toBe('0.0001');
  });

  it('matches loan queries', () => {
    const q = quickIntent('how much USDC could I borrow on my BTC safely?', newId);
    expect(q?.name).toBe('plan_loan');
  });

  it('matches explanation topics', () => {
    const q1 = quickIntent('explain dutch auction', newId);
    expect(q1?.name).toBe('explain');
    expect(q1?.arguments.topic).toBe('dutch-auction');

    const q2 = quickIntent('explain mesh positions', newId);
    expect(q2?.name).toBe('explain');
    expect(q2?.arguments.topic).toBe('mesh-position');
  });
});

describe('Local Strategy Planning & Top-up Support', () => {
  let idCounter = 0;
  const newId = () => `test-${++idCounter}`;

  it('plans a strategy successfully when balance is sufficient', () => {
    const snap = sampleSnapshot();
    const tool = toolByName('plan_strategy')!;
    const out = tool.run(
      { style: 'accumulate', token: 'MESH', budget: '0.1', risk: 'medium' },
      { snapshot: snap, now: Date.now(), newId },
    );
    expect(out.card.type).toBe('draft');
    if (out.card.type === 'draft' && out.card.draft.kind === 'mesh') {
      expect(out.card.draft.token.symbol).toBe('MESH');
      expect(out.card.draft.binCount).toBeGreaterThan(0);
      expect(out.card.draft.underfunded).toBeUndefined();
    }
  });

  it('builds a strategy draft and attaches top-up metadata when balance is insufficient', () => {
    const bchNet = networkOf('testnet', 'bch');
    const emptySnap = sampleSnapshot({
      assets: [
        {
          id: `${bchNet.key}:native`,
          network: bchNet,
          kind: 'native',
          ref: 'native',
          symbol: 'BCH',
          name: 'Bitcoin Cash',
          decimals: 8,
          balance: 0n, // Zero balance!
          verified: true,
        },
      ],
    });

    const tool = toolByName('plan_strategy')!;
    const out = tool.run(
      { style: 'accumulate', token: 'MESH', budget: '0.2', risk: 'medium' },
      { snapshot: emptySnap, now: Date.now(), newId },
    );

    // Strategy must still be built!
    expect(out.card.type).toBe('draft');
    if (out.card.type === 'draft' && out.card.draft.kind === 'mesh') {
      expect(out.card.draft.token.symbol).toBe('MESH');
      expect(out.card.draft.warnings).toContain('insufficient-balance');
      expect(out.card.draft.underfunded).toBeDefined();
      expect(out.card.draft.underfunded?.tokenSymbol).toBe('BCH');
      expect(BigInt(out.card.draft.underfunded!.missing)).toBeGreaterThan(0n);
    }
  });

  it('builds a swap draft and attaches top-up metadata when balance is insufficient', () => {
    const bchNet = networkOf('testnet', 'bch');
    const emptySnap = sampleSnapshot({
      assets: [
        {
          id: `${bchNet.key}:native`,
          network: bchNet,
          kind: 'native',
          ref: 'native',
          symbol: 'BCH',
          name: 'Bitcoin Cash',
          decimals: 8,
          balance: 0n, // Zero balance
          verified: true,
        },
      ],
    });

    const tool = toolByName('plan_swap')!;
    const out = tool.run(
      { sell: 'BCH', buy: 'MESH', amount: '0.1' },
      { snapshot: emptySnap, now: Date.now(), newId },
    );

    expect(out.card.type).toBe('draft');
    if (out.card.type === 'draft' && out.card.draft.kind === 'swap') {
      expect(out.card.draft.sell.symbol).toBe('BCH');
      expect(out.card.draft.buy.symbol).toBe('MESH');
      expect(out.card.draft.underfunded).toBeDefined();
      expect(out.card.draft.underfunded?.tokenSymbol).toBe('BCH');
      expect(out.card.draft.underfunded?.missing).toBe('10000000');
    }
  });
});

describe('Token Resolution and Suggestions', () => {
  it('parses token names with hints and aliases', () => {
    expect(parseName('bitcoin cash')?.symbol).toBe('BCH');
    expect(parseName('usdc on base')?.symbol).toBe('USDC');
    expect(parseName('usdc on base')?.networkHint).toContain('base');
    expect(parseName('$MESH')?.symbol).toBe('MESH');
  });

  it('finds tradeable tokens by symbol, name, and address prefix', () => {
    const snap = sampleSnapshot();
    const bySym = findTradeable(snap, 'MESH');
    expect(bySym?.symbol).toBe('MESH');

    const byName = findTradeable(snap, 'Mesh Token');
    expect(byName?.symbol).toBe('MESH');

    const byPrefix = findTradeable(snap, '111111111111');
    expect(byPrefix?.symbol).toBe('MESH');
  });

  it('suggests tokens based on prefix', () => {
    const snap = sampleSnapshot();
    const suggestions = suggestTokens(snap, 'me');
    expect(suggestions.length).toBe(1);
    expect(suggestions[0]!.symbol).toBe('MESH');

    const all = suggestTokens(snap, '');
    expect(all.length).toBe(2);
  });

  it('guesses correct swap products based on token refs', () => {
    const bchNet = networkOf('testnet', 'bch');
    const sellBch = { symbol: 'BCH', network: bchNet.key, networkName: 'BCH', ref: 'native', decimals: 8 };
    const buyMesh = { symbol: 'MESH', network: bchNet.key, networkName: 'BCH', ref: '1111111111111111111111111111111111111111111111111111111111111111', decimals: 2 };
    expect(guessProduct(sellBch, buyMesh, 'testnet')).toBe('cashtoken');

    const sellUsdcBase = { symbol: 'USDC', network: 'base-sepolia', networkName: 'Base', ref: '0x123', decimals: 6 };
    const buyUsdcArb = { symbol: 'USDC', network: 'arb-sepolia', networkName: 'Arbitrum', ref: '0x456', decimals: 6 };
    expect(guessProduct(sellUsdcBase, buyUsdcArb, 'testnet')).toBe('cctp');
  });
});
