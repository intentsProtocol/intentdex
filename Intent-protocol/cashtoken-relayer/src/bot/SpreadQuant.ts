/**
 * SpreadQuant — pure quant helpers over a list of Cauldron PoolV0 objects.
 *
 * Cauldron pools are constant-product AMMs: k = bch_reserve × token_reserve.
 * For a target demand of `Δd` tokens, the supply cost in sats is
 *     Δs = (R_bch × Δd) / (R_token − Δd)
 * which, after the 0.3 % LP fee, becomes
 *     Δs_with_fee ≈ Δs / (1 − 0.003).
 *
 * The marginal price equals the slope dΔs/dΔd at the trade's mid-point.
 * For routing decisions we compare it against the volume-weighted spot
 * price across all pools for the same token; the gap, expressed in bps,
 * is the slippage of that trade.
 */

import type { PoolV0 } from '@cashlab/cauldron';

const FEE_NUM = 997n;   // 0.3 % LP fee: out_with_fee = out × 997 / 1000
const FEE_DEN = 1000n;
const BPS_DEN = 10_000n;

// ── Public surface ────────────────────────────────────────────────────────────

export interface MarginalQuote {
    /** Effective price the caller pays (sats per 1 token unit, ×1e8 fixed-point). */
    effectivePriceSatsPerTokenFP: bigint;
    /** Spot price for comparison (sats per 1 token unit, ×1e8 fixed-point). */
    spotPriceSatsPerTokenFP: bigint;
    /** Slippage as basis points above the spot price (0 = no slippage). */
    slippageBps: number;
    /** Total sats paid for `demand` tokens (rounded up). */
    supplySats: bigint;
    /** Pool was too shallow for the trade. */
    insufficientLiquidity: boolean;
}

/** Fixed-point scale used internally so 18.5 sats/token is representable. */
export const PRICE_SCALE = 100_000_000n; // 1e8

/**
 * Volume-weighted spot price (sats per token unit, ×PRICE_SCALE).
 * Weight = BCH reserve of the pool. Returns 0n if no pools.
 */
export function spotPriceSatsPerToken(pools: PoolV0[], tokenId: string): bigint {
    const relevant = pools.filter(p => p.output.token.token_id === tokenId);
    if (relevant.length === 0) return 0n;

    let weightedNum = 0n;
    let weightedDen = 0n;
    for (const p of relevant) {
        const bch  = p.output.amount;
        const tok  = p.output.token.amount;
        if (tok === 0n) continue;
        // sats per token = bch / tok ; weighted by bch reserve
        weightedNum += (bch * PRICE_SCALE * bch) / tok;
        weightedDen += bch;
    }
    return weightedDen === 0n ? 0n : weightedNum / weightedDen;
}

/**
 * Fair value (sats) of `tokenUnits` using the spot price.
 * Use this to value the solver's inventory in a DIRECT route.
 */
export function fairValueSats(pools: PoolV0[], tokenId: string, tokenUnits: bigint): bigint {
    const spot = spotPriceSatsPerToken(pools, tokenId);
    if (spot === 0n) return 0n;
    return (spot * tokenUnits) / PRICE_SCALE;
}

/**
 * Quote a target-demand trade against the best single pool and compute
 * the slippage vs the volume-weighted spot price.
 *
 * For routing decisions we only need the *best* single-pool slippage; the
 * router still uses cashlab's `ExchangeLab.constructTradeBestRateForTargetDemand`
 * to build the actual trade (which may span multiple pools).
 */
export function marginalPriceForTrade(
    pools: PoolV0[],
    supplyId: string,        // 'BCH' or token category
    demandId: string,        // 'BCH' or token category
    demand: bigint,
): MarginalQuote {
    const tokenId = supplyId === 'BCH' ? demandId : supplyId;
    const relevant = pools.filter(p => p.output.token.token_id === tokenId);
    const spot = spotPriceSatsPerToken(pools, tokenId);

    if (relevant.length === 0 || demand <= 0n) {
        return {
            effectivePriceSatsPerTokenFP: 0n,
            spotPriceSatsPerTokenFP: spot,
            slippageBps: 0,
            supplySats: 0n,
            insufficientLiquidity: relevant.length === 0,
        };
    }

    // Pick the deepest single pool for this estimate (router uses multi-pool for the real trade).
    const pool = relevant.reduce((a, b) => (a.output.amount >= b.output.amount ? a : b));
    const R_bch   = pool.output.amount;
    const R_token = pool.output.token.amount;

    let supplySats = 0n;
    let effectivePriceFP = 0n;
    let insufficient = false;

    if (supplyId === 'BCH') {
        // Buying `demand` tokens with BCH. Needs R_token > demand.
        if (R_token <= demand) {
            insufficient = true;
        } else {
            // Cauldron CPMM with 0.3 % LP fee (rearranged constant-product):
            //   Δs_in × 997 × R_token = Δd × 1000 × (R_bch + Δs_in × 997/1000)
            //   solving for Δs_in (round up):
            const num = R_bch * demand * FEE_DEN;
            const den = (R_token - demand) * FEE_NUM;
            supplySats = (num + den - 1n) / den;
            effectivePriceFP = (supplySats * PRICE_SCALE) / demand;
        }
    } else {
        // Selling `demand` BCH (target = BCH out) for tokens supplied.
        // For our routing we only quote BCH-supply / token-demand and token-supply / BCH-demand.
        // demand here is in BCH sats; price is "tokens spent per BCH received".
        if (R_bch <= demand) {
            insufficient = true;
        } else {
            // Δt_in × 997 × R_bch = Δd_bch × 1000 × (R_token + Δt_in × 997/1000)
            const num = R_token * demand * FEE_DEN;
            const den = (R_bch - demand) * FEE_NUM;
            const tokensSpent = (num + den - 1n) / den;
            supplySats = tokensSpent;  // re-purpose field — units = tokens
            effectivePriceFP = demand === 0n ? 0n : (tokensSpent * PRICE_SCALE) / demand;
        }
    }

    const slippageBps = computeSlippageBps(effectivePriceFP, spot);
    return {
        effectivePriceSatsPerTokenFP: effectivePriceFP,
        spotPriceSatsPerTokenFP: spot,
        slippageBps,
        supplySats,
        insufficientLiquidity: insufficient,
    };
}

/**
 * Slippage in basis points: (effective − spot) / spot × 10000.
 * Always ≥ 0 (returns 0 for negative).
 */
export function computeSlippageBps(effectiveFP: bigint, spotFP: bigint): number {
    if (spotFP <= 0n || effectiveFP <= spotFP) return 0;
    const diff = effectiveFP - spotFP;
    return Number((diff * BPS_DEN) / spotFP);
}
