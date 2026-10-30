/**
 * lendbch math — the same integer arithmetic the Paryon contracts use, kept in one pure, unit-tested place.
 *
 * Units (see types.ts): BCH in satoshis, PUSD in cents, oracle price in US cents, interest rate per 10-million per
 * 144-block period. The contracts floor every division; we mirror that with bigint so a quote never promises more
 * than `Borrowing.cash` would allow. Percentages returned for display are plain numbers.
 */

export const SATS_PER_BCH = 100_000_000n;
export const MIN_LOAN_CENTS = 100_00n;          // 100.00 PUSD contract minimum
export const MIN_BORROW_FEE_SATS = 1000n;       // contract clamp on the 0.25% protocol fee
export const RATE_SCALE = 10_000_000n;          // interest rate is per 10-million...
export const PERIODS_PER_YEAR = 365n;           // ...per ~1-day period
/** Contract minimum collateral ratio: collateral must be ≥ 110% of debt (maxBorrowBase = collateral × 10/11). */
export const CONTRACT_RATIO_NUM = 11n;
export const CONTRACT_RATIO_DEN = 10n;

/** Value in US cents of `sats` of BCH at `priceCents` ($/BCH in cents). Floored, as the contract does. */
export function bchToUsdCents(sats: bigint, priceCents: bigint): bigint {
    return (sats * priceCents) / SATS_PER_BCH;
}

/** BCH (sats) worth `cents` of USD at `priceCents`. Floored. */
export function usdCentsToBch(cents: bigint, priceCents: bigint): bigint {
    if (priceCents <= 0n) return 0n;
    return (cents * SATS_PER_BCH) / priceCents;
}

/**
 * Most PUSD (cents) that `collateralSats` can borrow at `priceCents`, exactly as `Borrowing.cash`:
 * maxBorrow = (collateral × 10 / 11) × price / 1e8.
 */
export function maxBorrowCents(collateralSats: bigint, priceCents: bigint): bigint {
    const maxBorrowBase = (collateralSats * 10n) / CONTRACT_RATIO_NUM;   // collateral × 10/11, floored
    return (maxBorrowBase * priceCents) / SATS_PER_BCH;
}

/** Collateral ratio as a percentage (150 = 150%), or null when there is no debt. Floored to whole percent. */
export function collateralRatioPct(collateralSats: bigint, debtCents: bigint, priceCents: bigint): number | null {
    if (debtCents <= 0n) return null;
    const collateralCents = collateralSats * priceCents / SATS_PER_BCH;
    return Number((collateralCents * 100n) / debtCents);
}

/**
 * Price (US cents) at which this loan reaches the 110% liquidation line: liqPrice = debt × 11/10 × 1e8 / collateral.
 * Below this price the loan is liquidatable. Null when there is no debt or no collateral.
 */
export function liquidationPriceCents(collateralSats: bigint, debtCents: bigint): bigint | null {
    if (debtCents <= 0n || collateralSats <= 0n) return null;
    return (debtCents * CONTRACT_RATIO_NUM * SATS_PER_BCH) / (CONTRACT_RATIO_DEN * collateralSats);
}

/** Contract borrow fee in sats: 0.25% of the borrowed BCH value, clamped to a 1000-sat minimum. */
export function protocolBorrowFeeSats(borrowedCents: bigint, priceCents: bigint): bigint {
    const borrowedBch = usdCentsToBch(borrowedCents, priceCents);
    const fee = (borrowedBch * 25n) / 10_000n;
    return fee > MIN_BORROW_FEE_SATS ? fee : MIN_BORROW_FEE_SATS;
}

/** Our front-end fee in sats: `feeBps` of the borrowed BCH value (D1 default 25 bps). No minimum. */
export function frontendFeeSats(borrowedCents: bigint, priceCents: bigint, feeBps: number): bigint {
    if (feeBps <= 0) return 0n;
    const borrowedBch = usdCentsToBch(borrowedCents, priceCents);
    return (borrowedBch * BigInt(Math.round(feeBps))) / 10_000n;
}

/** Interest-rate unit → APR percent. rate × 365 / 100000 (so 137 ≈ 0.50% APR). */
export function rateToAprPct(rate: number | bigint): number {
    return Number(BigInt(rate) * PERIODS_PER_YEAR) / Number(RATE_SCALE) * 100;
}

/** APR percent → the nearest on-chain rate unit. */
export function aprPctToRate(aprPct: number): number {
    return Math.round((aprPct / 100) * Number(RATE_SCALE) / Number(PERIODS_PER_YEAR));
}

/** System period for a block height, as the contracts derive it: floor((height − start) / periodLength). */
export function periodForHeight(height: number, startBlockHeight: number, periodLengthBlocks: number): number {
    if (periodLengthBlocks <= 0) return 0;
    return Math.floor((height - startBlockHeight) / periodLengthBlocks);
}

/** Median of a list of numbers (the on-chain rates). Returns 0 for an empty list. */
export function median(values: number[]): number {
    if (!values.length) return 0;
    const s = [...values].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : Math.floor((s[mid - 1] + s[mid]) / 2);
}
