/**
 * DutchAuctionScheduler sanity. Synthetic in-memory tests, no network.
 */

import { shouldFillNow, projectDutchPrice } from '../src/bot/DutchAuctionScheduler.js';
import type { AuctionSolution } from '../src/bot/DutchAuctionSolver.js';
import type { DutchAuctionIntent } from '../src/registry.js';
import type { RouteQuote } from '../src/bot/CauldronRouter.js';
import type { PolicyConfig } from '../src/bot/ProfitPolicy.js';
import * as assert from 'assert';

const pass = (m: string) => console.log(`  ✅ ${m}`);
const fail = (m: string) => { console.error(`  ❌ ${m}`); process.exitCode = 1; };

const policy: PolicyConfig = { minAbsoluteSats: 1500n, minBps: 30, maxSlippageBps: 500 };

function makeAuction(startBuy: bigint, endBuy: bigint, startTime: bigint, duration: bigint): AuctionSolution {
    const params: DutchAuctionIntent = {
        address: 'bchtest:p0...',
        makerPkh: new Uint8Array(20),
        sellTokenCategory: '0x',
        buyTokenCategory:  `0x${'aa'.repeat(32)}`,
        sellAmount: 30_000n,
        startBuyAmount: startBuy,
        endBuyAmount:   endBuy,
        startTime, duration,
    };
    return {
        utxo: { address: params.address, txid: 'a'.repeat(64), vout: 0, satoshis: 30_000n },
        params,
        currentPrice: startBuy,
        contract: {} as any,
        type: 'DUTCH_AUCTION',
        isExpired: false,
    } as any;
}

function makeQuote(profit: bigint, slip = 100): RouteQuote {
    return {
        profitable: true, routeType: 'BCH_TO_TOKEN',
        netProfitSats: profit,
        preFillTrade: null, postFillTrade: null,
        preFillTokenId: null, postFillTokenId: null,
        reason: `synthetic +${profit}`, slippageBps: slip, effectiveBps: 0, candidatesConsidered: 1,
    };
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  DutchAuctionScheduler Sanity');
    console.log('═══════════════════════════════════════════════════════════\n');

    const now = BigInt(Math.floor(Date.now() / 1000) - 7200);  // MTP
    const startTime = now - 100n;   // started 100s ago (MTP-time)
    const duration  = 600n;          // 10 min auction

    // Case 1: Clear edge (profit ≥ 2× floor) → fill now
    {
        const sol  = makeAuction(2000n, 1000n, startTime, duration);
        const q    = makeQuote(3500n);   // ≥ 2 × 1500 = 3000
        const dec  = await shouldFillNow({
            solution: sol, currentQuote: q, policy,
            requoteAt: async () => q,
            nowMTPSec: now,
        });
        if (dec.fill) pass(`clear edge → fill now (${dec.reason})`);
        else          fail(`clear edge should fill, got defer (${dec.reason})`);
    }

    // Case 2: Marginal edge, waiting yields more → defer
    {
        const sol  = makeAuction(2000n, 1000n, startTime, duration);
        const qNow = makeQuote(1500n);   // exactly at floor
        const qLater = makeQuote(2200n); // better after wait
        const dec = await shouldFillNow({
            solution: sol, currentQuote: qNow, policy,
            requoteAt: async () => qLater,
            nowMTPSec: now,
        });
        if (!dec.fill) pass(`marginal edge w/ better projection → defer (${dec.reason})`);
        else           fail(`marginal w/ better projection should defer (${dec.reason})`);
    }

    // Case 3: Near end-window (<60s slack) → fill regardless
    {
        const nearEndStart = now - 580n;  // 20s slack on a 600s auction
        const sol = makeAuction(2000n, 1000n, nearEndStart, duration);
        const q   = makeQuote(1700n);
        const dec = await shouldFillNow({
            solution: sol, currentQuote: q, policy,
            requoteAt: async () => makeQuote(2000n),
            nowMTPSec: now,
        });
        if (dec.fill) pass(`end-window → fill now (${dec.reason})`);
        else          fail(`end-window should fill, got defer (${dec.reason})`);
    }

    // Case 4: Projection NOT better → fill now (no point waiting)
    {
        const sol  = makeAuction(2000n, 1000n, startTime, duration);
        const qNow = makeQuote(1700n);
        const qLater = makeQuote(1600n);
        const dec = await shouldFillNow({
            solution: sol, currentQuote: qNow, policy,
            requoteAt: async () => qLater,
            nowMTPSec: now,
        });
        if (dec.fill) pass(`projection worse → fill now (${dec.reason})`);
        else          fail(`projection worse should fill, got defer (${dec.reason})`);
    }

    // Case 5: projectDutchPrice math sanity
    {
        const da: DutchAuctionIntent = {
            address: '', makerPkh: new Uint8Array(20),
            sellTokenCategory: '0x', buyTokenCategory: `0x${'aa'.repeat(32)}`,
            sellAmount: 0n,
            startBuyAmount: 1000n, endBuyAmount: 100n,
            startTime: 1000n, duration: 100n,
        };
        const halfway = projectDutchPrice(da, 1050n);
        assert.ok(halfway === 550n, `halfway should be 550, got ${halfway}`);
        const beyondEnd = projectDutchPrice(da, 1200n);
        assert.ok(beyondEnd === 100n, `beyond end should be 100, got ${beyondEnd}`);
        const beforeStart = projectDutchPrice(da, 999n);
        assert.ok(beforeStart === 1000n, `before start should be 1000, got ${beforeStart}`);
        pass('projectDutchPrice math correct');
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(process.exitCode ? '  RESULT: FAILED' : '  RESULT: PASSED ✅');
    console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
