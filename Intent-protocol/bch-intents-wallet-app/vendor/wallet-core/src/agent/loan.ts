/**
 * Loan maths for borrowing USDC against BTC (Liquidium's Simple Loan), from a saved BTC price. Plan only:
 * the wallet does not open loans yet.
 *
 * Terms from borrow&lend/liquidium-research-doc (October 2026): BTC pool max LTV 65%, Simple Loans stay two
 * points under it, liquidation at 74%. Formulas from the extension's borrow-implementation-plan.md:
 *   health = collateral value × liquidation threshold ÷ debt
 *   liquidation price of BTC = debt ÷ (collateral amount × liquidation threshold)
 */
import { toNumber } from '../format';
import type { LoanPlan } from './types';

export const LIQUIDIUM_BTC = { maxLtv: 0.65, liquidationLtv: 0.74, simpleLoanMargin: 0.02, defaultLtv: 0.4 } as const;

export function planLoan(collateralSats: bigint, btcUsd: number, priceAt: number, ltv: number = LIQUIDIUM_BTC.defaultLtv): LoanPlan {
  const cap = LIQUIDIUM_BTC.maxLtv - LIQUIDIUM_BTC.simpleLoanMargin;
  const chosen = Math.min(Math.max(ltv > 1 ? ltv / 100 : ltv, 0.05), cap);
  const btc = toNumber(collateralSats, 8);
  const collateralUsd = btc * btcUsd;
  const borrowUsd = Math.floor(collateralUsd * chosen * 100) / 100;
  return {
    kind: 'loan',
    collateral: { value: collateralSats.toString(), decimals: 8, symbol: 'BTC' },
    btcUsd,
    ltv: chosen,
    maxLtv: cap,
    liquidationLtv: LIQUIDIUM_BTC.liquidationLtv,
    borrowUsd,
    liquidationPriceUsd: btc > 0 ? borrowUsd / (btc * LIQUIDIUM_BTC.liquidationLtv) : 0,
    health: borrowUsd > 0 ? (collateralUsd * LIQUIDIUM_BTC.liquidationLtv) / borrowUsd : Infinity,
    priceAt,
  };
}
