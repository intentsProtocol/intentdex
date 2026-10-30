/**
 * fees.ts — our margin on both products. Pure functions, unit-tested.
 *
 * Cross-chain USDC: CCTP has no integrator fee, so the fee is a USDC transfer to our treasury on the source
 * chain, next to the burn (Circle's documented pattern; Bridge Kit does the same). The user enters what they
 * send; the fee comes out of it and the rest is burned.
 *
 * Solana swaps: Jupiter's referral fee (50-255 bps on the order), taken inside the swap into our referral
 * token accounts. Jupiter keeps 20 % of it.
 */
import { ceilDiv, parseUsdc } from './cctp/encoding.js';
import type { CctpSettings, SolanaSettings } from './settings.js';

export const JUPITER_REFERRAL_SHARE = 0.8;   // we keep 80 % of the referral fee

/** Our fee on a cross-chain transfer of `amount` (base units) to `dst`: bps part, clamped, plus the destination gas charge. */
export function protocolFeeFor(amount: bigint, s: Pick<CctpSettings, 'feeBps' | 'feeMinUsdc' | 'feeMaxUsdc' | 'gasFeeUsdc'>, dst: string): bigint {
    let fee = s.feeBps > 0 ? ceilDiv(amount * BigInt(Math.round(s.feeBps * 100)), 1_000_000n) : 0n;
    const min = s.feeMinUsdc > 0 ? parseUsdc(s.feeMinUsdc) : 0n;
    const max = s.feeMaxUsdc > 0 ? parseUsdc(s.feeMaxUsdc) : 0n;
    if (fee < min) fee = min;
    if (max > 0n && fee > max) fee = max;
    const gas = s.gasFeeUsdc[dst] ?? 0;
    if (gas > 0) fee += parseUsdc(gas);
    return fee;
}

export interface TokenKind { isStock?: boolean; tags?: string[] }

/** Referral fee (bps) for a Jupiter swap: stocks and stable-to-stable pairs can be priced apart from the rest. */
export function referralBpsFor(s: Pick<SolanaSettings, 'referralFeeBps' | 'stocksFeeBps' | 'stablesFeeBps'>, input?: TokenKind, output?: TokenKind): number {
    if ((input?.isStock || output?.isStock) && s.stocksFeeBps !== null) return s.stocksFeeBps;
    const stable = (t?: TokenKind) => !!t?.tags?.includes('stable');
    if (stable(input) && stable(output) && s.stablesFeeBps !== null) return s.stablesFeeBps;
    return s.referralFeeBps;
}

/**
 * The fee Jupiter actually took on an executed swap, from /execute's amounts: on the input side
 * (totalInputAmount − inputAmountResult) or the output side (outputAmountResult − totalOutputAmount).
 * Returns the total fee and our share of it.
 */
export function collectedFee(r: { totalInputAmount?: string; inputAmountResult?: string; totalOutputAmount?: string; outputAmountResult?: string }, feeMint: string | undefined, inputMint: string, outputMint: string) {
    const big = (v?: string) => { try { return v === undefined ? undefined : BigInt(v); } catch { return undefined; } };
    const tin = big(r.totalInputAmount), ain = big(r.inputAmountResult), tout = big(r.totalOutputAmount), aout = big(r.outputAmountResult);
    let total: bigint | undefined;
    if (feeMint === inputMint && tin !== undefined && ain !== undefined) total = tin - ain;
    else if (feeMint === outputMint && tout !== undefined && aout !== undefined) total = aout - tout;
    if (total === undefined || total < 0n) return undefined;
    return { mint: feeMint!, total: total.toString(), ours: ((total * 80n) / 100n).toString() };
}
