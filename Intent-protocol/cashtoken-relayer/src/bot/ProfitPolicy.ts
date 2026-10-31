/**
 * ProfitPolicy — BPS-aware "is this fill acceptable" gate.
 *
 * Policy is composed of three thresholds. A quote is accepted only if it
 * clears ALL of them simultaneously:
 *   1. profit ≥ minAbsoluteSats     (covers fees + dust)
 *   2. profit/trade ≥ minBps        (margin floor in basis points)
 *   3. slippageBps ≤ maxSlippageBps (don't blow through thin pools)
 *
 * Per-token overrides via the `perToken` map let stablecoins / blue chips
 * trade on tighter margins than illiquid memecoins.
 */

import * as fs from 'fs';

const BPS_DEN = 10_000n;

// ── Config & defaults ─────────────────────────────────────────────────────────

export interface PolicyConfig {
    minAbsoluteSats: bigint;
    minBps: number;
    maxSlippageBps: number;
    perToken?: Record<string, Partial<PolicyConfig>>;
}

export const DEFAULT_POLICY: PolicyConfig = {
    minAbsoluteSats: BigInt(process.env.PROFIT_MIN_SATS    ?? '1500'),
    minBps:           Number(process.env.PROFIT_MIN_BPS     ?? '30'),
    maxSlippageBps:   Number(process.env.MAX_SLIPPAGE_BPS   ?? '500'),
};

/**
 * Load a policy, merging file overrides on top of env defaults.
 * If `PROFIT_POLICY_FILE` is set and exists, its contents are parsed as
 * `Partial<PolicyConfig>` and merged onto DEFAULT_POLICY.
 */
export function loadPolicy(): PolicyConfig {
    const path = process.env.PROFIT_POLICY_FILE;
    if (!path || !fs.existsSync(path)) return DEFAULT_POLICY;

    try {
        const raw = JSON.parse(fs.readFileSync(path, 'utf8')) as Partial<PolicyConfig>;
        return {
            minAbsoluteSats: raw.minAbsoluteSats !== undefined
                ? BigInt(raw.minAbsoluteSats as any)
                : DEFAULT_POLICY.minAbsoluteSats,
            minBps:         raw.minBps         ?? DEFAULT_POLICY.minBps,
            maxSlippageBps: raw.maxSlippageBps ?? DEFAULT_POLICY.maxSlippageBps,
            perToken:       raw.perToken,
        };
    } catch (e: any) {
        console.warn(`[ProfitPolicy] failed to load ${path}: ${e.message}; using defaults`);
        return DEFAULT_POLICY;
    }
}

// ── Evaluation ────────────────────────────────────────────────────────────────

export interface EvalInput {
    profitSats:     bigint;
    tradeValueSats: bigint;
    slippageBps:    number;
    tokenId?:       string;
}

export interface EvalResult {
    acceptable:    boolean;
    reason:        string;
    effectiveBps:  number;
    appliedFloor:  PolicyConfig;
}

export function evaluate(input: EvalInput, base: PolicyConfig = DEFAULT_POLICY): EvalResult {
    const applied = mergeOverride(base, input.tokenId);
    const effectiveBps = bpsOf(input.profitSats, input.tradeValueSats);

    if (input.tradeValueSats <= 0n) {
        return { acceptable: false, reason: 'trade value is zero', effectiveBps: 0, appliedFloor: applied };
    }
    if (input.profitSats < applied.minAbsoluteSats) {
        return {
            acceptable: false,
            reason: `profit ${input.profitSats} sats < floor ${applied.minAbsoluteSats} sats`,
            effectiveBps, appliedFloor: applied,
        };
    }
    if (effectiveBps < applied.minBps) {
        return {
            acceptable: false,
            reason: `margin ${effectiveBps} bps < floor ${applied.minBps} bps`,
            effectiveBps, appliedFloor: applied,
        };
    }
    if (input.slippageBps > applied.maxSlippageBps) {
        return {
            acceptable: false,
            reason: `slippage ${input.slippageBps} bps > cap ${applied.maxSlippageBps} bps`,
            effectiveBps, appliedFloor: applied,
        };
    }
    return {
        acceptable: true,
        reason: `OK (+${input.profitSats} sats, ${effectiveBps} bps, slip ${input.slippageBps} bps)`,
        effectiveBps, appliedFloor: applied,
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mergeOverride(base: PolicyConfig, tokenId?: string): PolicyConfig {
    if (!tokenId || !base.perToken || !base.perToken[tokenId]) return base;
    const o = base.perToken[tokenId]!;
    return {
        minAbsoluteSats: o.minAbsoluteSats !== undefined ? BigInt(o.minAbsoluteSats as any) : base.minAbsoluteSats,
        minBps:          o.minBps         ?? base.minBps,
        maxSlippageBps:  o.maxSlippageBps ?? base.maxSlippageBps,
    };
}

function bpsOf(profit: bigint, value: bigint): number {
    if (value <= 0n) return 0;
    if (profit < 0n) return -Number((-profit * BPS_DEN) / value);
    return Number((profit * BPS_DEN) / value);
}
