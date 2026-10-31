/**
 * DutchAuctionScheduler — patient fill-deferral for Dutch auctions.
 *
 * Dutch auctions decay linearly from startBuyAmount → endBuyAmount over
 * `duration` seconds. For a relayer that BUYS tokens to satisfy the maker,
 * the relayer's cost drops as the auction ages. So if a fill is barely
 * profitable now but waiting a few seconds would yield clearly more, the
 * patient strategy is to defer.
 *
 * Rules (locked to "patient" stance):
 *   1. If predicted profit ≥ 2 × minAbsoluteSats → fill now (don't risk it).
 *   2. Else if there is still > MIN_TIME_BEFORE_END_SEC slack inside the
 *      auction deadline AND projected profit at (now + waitWindow) is
 *      strictly higher AND would still clear the policy floor → defer.
 *   3. Else → fill now (last-chance window or no upside from waiting).
 */

import type { AuctionSolution } from './DutchAuctionSolver.js';
import type { DutchAuctionIntent } from '../registry.js';
import type { RouteQuote, CauldronRouter } from './CauldronRouter.js';
import type { PolicyConfig } from './ProfitPolicy.js';

const MIN_TIME_BEFORE_END_SEC = 60n;     // always fill in final 60s of decay
const DEFAULT_WAIT_WINDOW_SEC = 30n;     // re-evaluate ~3 sleep cycles ahead
// (no MAX_STALE_PAST_END_SEC: the Dutch fill() contract has no upper time bound — see DutchAuctionSwap.cash)

export type ScheduleDecision =
    | { fill: true;  reason: string }
    | { fill: false; reason: string; deferUntilSec?: number };

/**
 * Decide whether to fill a Dutch auction solution now, or defer to the
 * next scan cycle.
 *
 * Pass in a callback `requoteAt(price)` that re-runs the router quote with
 * a hypothetical decayed price; the scheduler uses it to project profit
 * at the wait-window boundary without calling the network twice.
 */
export async function shouldFillNow(args: {
    solution:        AuctionSolution;
    currentQuote:    RouteQuote;
    policy:          PolicyConfig;
    waitWindowSec?:  bigint;
    requoteAt:       (projectedPrice: bigint) => Promise<RouteQuote>;
    nowMTPSec?:      bigint;
}): Promise<ScheduleDecision> {
    const {
        solution, currentQuote, policy,
        waitWindowSec = DEFAULT_WAIT_WINDOW_SEC,
        requoteAt,
    } = args;

    // Not a Dutch auction → always fill (limit orders don't decay)
    if (solution.type !== 'DUTCH_AUCTION') {
        return { fill: true, reason: 'not a Dutch auction' };
    }

    // Solution must be a DutchAuctionIntent for type narrowing
    const params = solution.params as DutchAuctionIntent;
    // Required: the caller's median-time-past for this cycle. Defaulting to a guess
    // here would let the patience logic reason on a different clock from the one the
    // covenant prices against, so a missing value is a programming error rather than
    // something to paper over.
    if (args.nowMTPSec === undefined) {
        throw new Error('shouldFillNow requires nowMTPSec — see CovenantClock.ts');
    }
    const nowMTP = args.nowMTPSec;
    const endTime = params.startTime + params.duration;
    const slackSec = endTime - nowMTP;

    // NOTE: No staleness filter here.
    // The Dutch fill() contract clause has NO upper time bound (only `currentTime >= startTime`),
    // and the `min(elapsed, duration)` clamp pins the price at endBuyAmount after decay completes.
    // A fully-decayed auction is fillable indefinitely — that's by design (resolver picks up the
    // floor-price spread). If the scanner found a funded UTXO and the router quoted profit, fill.
    // Filtering "old abandoned" intents at this stage just leaves money on the table.

    // Last-chance window (MTP-time, for fill validity) — fill regardless
    if (slackSec <= MIN_TIME_BEFORE_END_SEC) {
        return { fill: true, reason: `auction near deadline (${slackSec}s MTP slack)` };
    }

    // Clear edge — don't second-guess
    const fillNowThreshold = policy.minAbsoluteSats * 2n;
    if (currentQuote.netProfitSats >= fillNowThreshold) {
        return { fill: true, reason: `profit ${currentQuote.netProfitSats} ≥ 2× floor (${fillNowThreshold})` };
    }

    // Project decayed price at (now + waitWindow). Cap inside [endBuy, currentPrice].
    const projectedAt = nowMTP + waitWindowSec;
    const projectedPrice = projectDutchPrice(params, projectedAt);

    if (projectedPrice >= solution.currentPrice) {
        // Already at floor — no more decay; fill now.
        return { fill: true, reason: `price already at decay floor (${solution.currentPrice})` };
    }

    // Re-quote with the lower projected price
    let projectedQuote: RouteQuote;
    try {
        projectedQuote = await requoteAt(projectedPrice);
    } catch (e: any) {
        return { fill: true, reason: `requote failed (${e.message}) — defaulting to fill` };
    }

    // Defer only if the projected fill is strictly better AND still acceptable
    if (
        projectedQuote.profitable
        && projectedQuote.netProfitSats > currentQuote.netProfitSats
    ) {
        const gain = projectedQuote.netProfitSats - currentQuote.netProfitSats;
        return {
            fill: false,
            reason: `defer ${waitWindowSec}s: projected +${gain} sats more (curr=${currentQuote.netProfitSats}, proj=${projectedQuote.netProfitSats})`,
            deferUntilSec: Number(projectedAt),
        };
    }

    return { fill: true, reason: `waiting gives no edge (curr=${currentQuote.netProfitSats}, proj=${projectedQuote.netProfitSats})` };
}

/** Linear decay: price(t) = startBuy − (startBuy − endBuy) × (t − startTime) / duration */
export function projectDutchPrice(da: DutchAuctionIntent, atSec: bigint): bigint {
    if (atSec <= da.startTime) return da.startBuyAmount;
    const endTime = da.startTime + da.duration;
    if (atSec >= endTime)     return da.endBuyAmount;

    const elapsed   = atSec - da.startTime;
    const priceDiff = da.startBuyAmount - da.endBuyAmount;
    const decay     = (priceDiff * elapsed) / da.duration;
    const price     = da.startBuyAmount - decay;
    return price < da.endBuyAmount ? da.endBuyAmount : price;
}
