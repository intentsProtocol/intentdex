/**
 * Mesh strategies as numbers: a goal ("accumulate", "take profit", "range"…) and a risk level become a V4
 * position plan — bin step, range on the price grid, shape and deposits — computed offline from a saved price.
 *
 * The grid rules match the Mesh server (`meshserver/src/pools/v4/positionPlanner.ts` and `api/routes/v4.ts`):
 * a level is `round(ln(price) / ln(1 + step/10⁴))`; bins at or below the market level hold BCH (they buy),
 * bins above hold tokens (they sell); at most 128 bins; a buying bin needs at least 2,000 sats. The server
 * plans the exact outputs later; this decides what to ask it for.
 */
import { gridPriceNum } from '../mesh/v4';
import type { MeshDraft, MeshShape, Risk, StrategyStyle, StrategyWarning } from './types';

export const MESH_MAX_BINS = 128;
export const MIN_BID_BIN_SATS = 2000n;
/** The agent keeps positions small so the genesis transaction stays small and cheap. */
export const AGENT_MAX_BINS = 32;
const STEPS = [10, 25, 50, 100, 200, 400, 800] as const;

export const STRATEGY_STYLES: readonly StrategyStyle[] = ['accumulate', 'take-profit', 'range', 'market-make', 'peg', 'limit'];

/** How far the range reaches from the market, as a fraction of the price, per side that has bins. */
const REACH: Record<Exclude<StrategyStyle, 'limit'>, Record<Risk, number>> = {
  accumulate: { low: 0.1, medium: 0.25, high: 0.5 },
  'take-profit': { low: 0.1, medium: 0.3, high: 0.6 },
  range: { low: 0.1, medium: 0.2, high: 0.4 },
  'market-make': { low: 0.02, medium: 0.04, high: 0.08 },
  peg: { low: 0.005, medium: 0.01, high: 0.02 },
};

/** Bins we aim for across the whole range. */
const TARGET_BINS: Record<Exclude<StrategyStyle, 'limit'>, number> = {
  accumulate: 10, 'take-profit': 10, range: 16, 'market-make': 12, peg: 8,
};

/**
 * Where the weight goes. `bidask` puts more at the far ends (buy more as it dips, sell more as it rises),
 * `curve` near the market (tight market making), `spot` evenly.
 */
const SHAPE: Record<StrategyStyle, MeshShape> = {
  accumulate: 'bidask', 'take-profit': 'bidask', range: 'spot', 'market-make': 'curve', peg: 'curve', limit: 'spot',
};
const STRENGTH: Record<Risk, MeshDraft['strength']> = { low: 'gentle', medium: 'standard', high: 'aggressive' };

export const levelOf = (price: number, stepBps: number) => Math.round(Math.log(price) / Math.log1p(stepBps / 10_000));

export interface StrategyInput {
  style: StrategyStyle;
  risk: Risk;
  token: { category: string; symbol: string; decimals: number };
  /** Sats per token base unit. */
  marketPrice: number;
  /** BCH the user puts in, sats. */
  bchBudget: bigint;
  /** Tokens the user puts in, base units. */
  tokenBudget: bigint;
  /** Sats per token base unit; only for `limit`. */
  targetPrice?: number;
  testnet?: boolean;
}

export type StrategyResult =
  | { ok: true; draft: MeshDraft }
  | { ok: false; code: 'no-price' | 'no-balance' | 'too-small'; minSats?: bigint };

interface Range { step: number; low: number; high: number; market: number }

export function planStrategy(input: StrategyInput): StrategyResult {
  const { style, risk, marketPrice } = input;
  if (!(marketPrice > 0) || !Number.isFinite(marketPrice)) return { ok: false, code: 'no-price' };
  const warnings: StrategyWarning[] = [];
  if (input.testnet) warnings.push('testnet-price');

  let wantBuy: boolean;
  let wantSell: boolean;
  let range: Range;

  if (style === 'limit') {
    const target = input.targetPrice;
    if (!(target && target > 0)) return { ok: false, code: 'no-price' };
    const step = 25;
    const market = levelOf(marketPrice, step);
    const at = levelOf(target, step);
    wantBuy = at <= market;
    wantSell = !wantBuy;
    range = { step, low: at, high: at, market };
  } else {
    const reach = REACH[style][risk];
    wantBuy = style !== 'take-profit';
    wantSell = style !== 'accumulate';
    if (wantSell && input.tokenBudget <= 0n) {
      if (style === 'take-profit') return { ok: false, code: 'no-balance' };
      // Nothing to sell: keep the buying half of the range.
      wantSell = false;
      warnings.push('no-tokens-to-sell');
    }
    if (wantBuy && input.bchBudget <= 0n) return { ok: false, code: 'no-balance' };
    const sides = (wantBuy ? 1 : 0) + (wantSell ? 1 : 0);
    const target = Math.max(2, Math.round((TARGET_BINS[style] * sides) / 2));
    const fits = (step: number): Range => {
      const market = levelOf(marketPrice, step);
      const low = wantBuy ? levelOf(marketPrice * (1 - reach), step) : market + 1;
      const high = wantSell ? levelOf(marketPrice * (1 + reach), step) : market;
      return { step, low: Math.min(low, wantBuy ? market : low), high: Math.max(high, wantSell ? market + 1 : high), market };
    };
    range = fits(STEPS[STEPS.length - 1]!);
    for (const step of STEPS) {
      const r = fits(step);
      if (r.high - r.low + 1 <= target) { range = r; break; }
    }
    if (reach >= 0.5) warnings.push('wide-range');
  }

  // A buying bin needs MIN_BID_BIN_SATS: widen the step until the budget covers every buying bin.
  const buyBinsOf = (r: Range) => (wantBuy ? Math.max(0, Math.min(r.high, r.market) - r.low + 1) : 0);
  if (wantBuy) {
    let i = STEPS.indexOf(range.step as (typeof STEPS)[number]);
    while (BigInt(buyBinsOf(range)) * MIN_BID_BIN_SATS > input.bchBudget && style !== 'limit' && i >= 0 && i < STEPS.length - 1) {
      i += 1;
      const step = STEPS[i]!;
      const scale = range.step / step;
      const market = levelOf(marketPrice, step);
      range = { step, market, low: market - Math.ceil((range.market - range.low) * scale), high: market + Math.ceil((range.high - range.market) * scale) };
    }
    const need = BigInt(buyBinsOf(range)) * MIN_BID_BIN_SATS;
    if (need > input.bchBudget) return { ok: false, code: 'too-small', minSats: need };
  }

  const binCount = range.high - range.low + 1;
  if (binCount > Math.min(AGENT_MAX_BINS, MESH_MAX_BINS)) return { ok: false, code: 'too-small' };
  const buyBins = buyBinsOf(range);
  const sellBins = binCount - buyBins;
  if (wantBuy && wantSell && (input.bchBudget < BigInt(buyBins) * MIN_BID_BIN_SATS * 2n)) warnings.push('budget-split-thin');

  return {
    ok: true,
    draft: {
      kind: 'mesh', style, risk, token: input.token,
      shape: SHAPE[style], strength: STRENGTH[risk],
      binStepBps: range.step, lowIndex: range.low, highIndex: range.high, marketIndex: range.market,
      binCount, buyBins, sellBins,
      marketPrice, lowPrice: gridPriceNum(range.step, range.low), highPrice: gridPriceNum(range.step, range.high + 1),
      depositSats: (buyBins > 0 ? input.bchBudget : 0n).toString(),
      depositTokens: (sellBins > 0 ? input.tokenBudget : 0n).toString(),
      warnings,
    },
  };
}
