/**
 * The wallet's state as plain JSON, saved after each successful refresh so the agent can answer offline.
 * Balances and public data only: no key, no seed, no address book.
 */
import type { ActivityEntry } from '../activity';
import { priceOf, type Asset } from '../assets';
import type { NetworkMode } from '../chains';
import type { TradeableToken } from '../cashtokens';
import { priceRange } from '../mesh/v4';
import type { NftHolding } from '../nfts';
import type { PriceMap } from '../prices';
import type { SnapshotPosition, SnapshotToken, WalletSnapshot } from './types';

export interface SnapshotInput {
  at: number;
  mode: NetworkMode;
  accountIndex: number;
  assets: Asset[];
  prices: PriceMap;
  tradeable: TradeableToken[];
  positions: NftHolding[];
  activity: ActivityEntry[];
  /** Token prices from the last snapshot, used when the list cannot be fetched now (offline). */
  previousTokens?: SnapshotToken[];
}

const USD_SYMBOLS = ['BCH', 'BTC', 'ETH', 'SOL', 'USDC'];

export function buildSnapshot(input: SnapshotInput): WalletSnapshot {
  const usd: Record<string, number> = {};
  for (const s of USD_SYMBOLS) { const p = input.prices[s]?.usd; if (p) usd[s] = p; }
  const tokenOf = (cat: string): { symbol: string; decimals: number } | undefined =>
    input.tradeable.find(t => t.category === cat) ?? input.previousTokens?.find(t => t.category === cat);
  const positions: SnapshotPosition[] = [];
  for (const n of input.positions) {
    const c = n.position?.commitment;
    if (!c) continue;
    const range = priceRange(c);
    const t = tokenOf(c.tokenCat);
    positions.push({
      id: n.id, category: n.category, name: n.name, tokenCat: c.tokenCat, tokenSymbol: t?.symbol, tokenDecimals: t?.decimals,
      shape: c.shape, binStepBps: c.binStepBps, lowIndex: c.lowIndex, highIndex: c.highIndex, binCount: c.binCount,
      lowSatsPerUnit: range.lowSatsPerUnit, highSatsPerUnit: range.highSatsPerUnit,
    });
  }
  return {
    version: 1,
    at: input.at,
    mode: input.mode,
    accountIndex: input.accountIndex,
    assets: input.assets.map(a => ({
      id: a.id, network: a.network.key, family: a.network.family, networkName: a.network.name, kind: a.kind, ref: a.ref,
      symbol: a.symbol, name: a.name, decimals: a.decimals, balance: a.balance.toString(), usd: priceOf(a, input.prices),
    })),
    tokens: input.tradeable.length
      ? input.tradeable.filter(t => t.priceSats > 0).slice(0, 60).map(t => ({
        category: t.category, symbol: t.symbol, name: t.name, decimals: t.decimals, priceSats: t.priceSats,
      }))
      : input.previousTokens ?? [],
    positions,
    activity: input.activity.slice(0, 20).map(e => ({ kind: e.kind, status: e.status, at: e.at, network: e.network, sent: e.sent, received: e.received })),
    usd,
  };
}

/** True for a snapshot this code can read. Anything else is ignored rather than trusted. */
export function isSnapshot(v: unknown): v is WalletSnapshot {
  const s = v as WalletSnapshot | null;
  return !!s && s.version === 1 && typeof s.at === 'number' && Array.isArray(s.assets) && Array.isArray(s.tokens)
    && Array.isArray(s.positions) && Array.isArray(s.activity) && typeof s.usd === 'object' && s.usd !== null;
}
