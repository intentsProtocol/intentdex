/**
 * dust_sanity.ts — token-UTXO dust floor. No network calls.
 *
 * Guards the inventory ratchet.
 *
 * A DIRECT (inventory) fill has to pay its fee out of the token UTXO's own sats,
 * because the covenant enforces exactly 2 inputs. CauldronRouter therefore requires
 * a token UTXO to carry >= MIN_TOKEN_UTXO_DUST_SATS before DIRECT is viable.
 *
 * The executor used to mint token change with a floor of 1000 while the router
 * required 3500. So every fill handed back change below the router's own bar: a
 * Cauldron pre-fill mints a viable 5000-sat token UTXO, the fill eats it and
 * produces a dead one, and the next fill has to go through Cauldron again. Live
 * inventory showed the end state — 14444 units on 657 sats and 9 units on 1000
 * sats, neither usable, while /router/wallet reported a healthy token balance.
 *
 * Run:  npx tsx test/dust_sanity.ts
 */
import { CauldronPoolCache } from '../src/bot/CauldronPoolCache.js';
import { CauldronRouter } from '../src/bot/CauldronRouter.js';
import { splitProfit, estimateBchFillFee } from '../src/bot/DutchAuctionExecutor.js';
import { DEFAULT_POLICY } from '../src/bot/ProfitPolicy.js';
import { ENV } from '../src/config.js';
import type { AuctionSolution } from '../src/bot/DutchAuctionSolver.js';

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
}
const section = (s: string) => console.log(`\n── ${s} ──`);

const TOKEN = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';
const FLOOR = ENV.MIN_TOKEN_UTXO_DUST_SATS;

/** Empty indexer URL ⇒ refresh() returns early ⇒ zero pools, zero network calls. */
const emptyCache = new CauldronPoolCache('', 0);
const router = new CauldronRouter(emptyCache, DEFAULT_POLICY, /*profitOutput=*/true);

/** A BCH→Token intent: covenant holds `sellSats`, maker wants `buyUnits` tokens. */
function solution(sellSats: bigint, buyUnits: bigint): AuctionSolution {
    return {
        utxo: { address: 'bchtest:pcov', txid: '00'.repeat(32), vout: 0, satoshis: sellSats },
        params: {
            address: 'bchtest:pcov',
            makerPkh: new Uint8Array(20),
            sellTokenCategory: '0x',
            buyTokenCategory: `0x${TOKEN}`,
            sellAmount: sellSats,
            buyAmount: buyUnits,
            expiryTime: BigInt(Math.floor(Date.now() / 1000) + 3600),
        } as any,
        currentPrice: buyUnits,
        contract: {} as any,
        type: 'LIMIT_ORDER',
        isExpired: false,
    };
}

/** A solver-wallet token UTXO carrying `units` tokens on `sats` satoshis. */
const tokenUtxo = (units: bigint, sats: bigint) => ({
    txid: '11'.repeat(32), vout: 0, satoshis: sats,
    token: { amount: units, category: TOKEN },
});

(async () => {
    console.log('=== DUST SANITY (token UTXO viability floor) ===');
    console.log(`MIN_TOKEN_UTXO_DUST_SATS = ${FLOOR}\n`);

    // ── 1. Router viability flips exactly at the shared floor ───────────────
    section('1. router DIRECT viability keys off the shared constant');
    {
        const sol = solution(500_000n, 9n);

        const below = await router.quote(sol, [tokenUtxo(1000n, FLOOR - 1n)] as any);
        const at    = await router.quote(sol, [tokenUtxo(1000n, FLOOR)] as any);

        // Below the floor the router explicitly reports fragmented inventory rather
        // than silently trying (and failing) a 2-input fill it cannot fund.
        check('below floor → DIRECT not viable',
            /no single utxo|fragmented/i.test(below.reason), `reason: ${below.reason}`);
        check('at floor → DIRECT becomes viable',
            !/no single utxo|fragmented/i.test(at.reason), `reason: ${at.reason}`);
        check('at floor → route is DIRECT', at.routeType === 'DIRECT', `got ${at.routeType}`);
        check('at floor → profitable with a real (non-zero) profit',
            at.profitable && at.netProfitSats > 0n, `profit=${at.netProfitSats}`);
    }

    // ── 2. Insufficient token units is a separate failure from dust ─────────
    section('2. unit shortfall is distinguished from dust shortfall');
    {
        const sol = solution(500_000n, 9n);
        const q = await router.quote(sol, [tokenUtxo(3n, FLOOR * 2n)] as any);
        check('not enough units → no route (not a dust complaint)',
            !q.profitable && !/no single utxo/i.test(q.reason), `reason: ${q.reason}`);
    }

    // ── 3. The executor's change floor matches the router's bar ─────────────
    section('3. token change is minted at or above the router bar');
    {
        // Reproduce the executor's arithmetic: satChange split into operating change
        // and a profit slice, then the token output floored at FLOOR.
        const mint = (satChange: bigint, predictedProfit: bigint) => {
            const { profitSlice, operatingChange } = splitProfit(satChange, predictedProfit, true);
            const tokenOutSats = operatingChange > FLOOR ? operatingChange : FLOOR;
            const capped = tokenOutSats > satChange ? satChange : tokenOutSats;
            const bundledExtra = tokenOutSats > operatingChange ? tokenOutSats - operatingChange : 0n;
            const adjustedProfit = profitSlice > bundledExtra ? profitSlice - bundledExtra : 0n;
            return { tokenOutSats: capped, adjustedProfit, operatingChange, profitSlice };
        };

        // The exact shape that used to starve inventory: a healthy profit slice eats
        // operatingChange down to the dust minimum, so the old 1000 floor applied.
        const big = mint(10_000n, 9_000n);
        check('token change reaches the floor even when profit is large',
            big.tokenOutSats >= FLOOR, `got ${big.tokenOutSats}`);
        check('the extra dust is taken off the profit slice, not invented',
            big.tokenOutSats + big.adjustedProfit <= 10_000n,
            `${big.tokenOutSats} + ${big.adjustedProfit} > 10000`);
        check('profit slice is reduced, not zeroed, when it can afford it',
            big.adjustedProfit > 0n, `adjustedProfit=${big.adjustedProfit}`);

        // No segregation configured → all change is operating change.
        const noProfit = mint(10_000n, 0n);
        check('with no predicted profit, token change keeps the whole change',
            noProfit.tokenOutSats === 10_000n, `got ${noProfit.tokenOutSats}`);

        // Degenerate: less change than the floor. Must not over-spend the inputs.
        const tiny = mint(2_000n, 1_500n);
        check('never mints more than the change available',
            tiny.tokenOutSats <= 2_000n, `got ${tiny.tokenOutSats}`);
    }

    // ── 4. The ratchet is broken: change is re-usable next cycle ────────────
    section('4. a fill\'s own change is viable inventory for the next fill');
    {
        const { profitSlice, operatingChange } = splitProfit(10_000n, 9_000n, true);
        const tokenOutSats = operatingChange > FLOOR ? operatingChange : FLOOR;
        const sol = solution(500_000n, 9n);
        const q = await router.quote(sol, [tokenUtxo(5_000n, tokenOutSats)] as any);
        check('change minted by one fill funds a DIRECT fill next time',
            q.routeType === 'DIRECT' && !/no single utxo/i.test(q.reason),
            `dust=${tokenOutSats} route=${q.routeType} reason=${q.reason}`);
        void profitSlice;
    }

    // ── 5. BCH-buy fee is size-derived, not the old flat 3000 ──────────────
    section('5. BCH fill fee derives from transaction size');
    {
        const bare = estimateBchFillFee({});
        const withProfit = estimateBchFillFee({ hasProfitOutput: true });
        check('materially below the old flat 3000', bare < 3000n, `got ${bare}`);
        check('still clears min-relay for a ~500-byte tx', bare >= 500n, `got ${bare}`);
        check('profit output costs a little more', withProfit > bare);
        console.log(`     ${bare} sats (was 3000) → saves ${3000n - bare} sats per BCH-buy fill`);
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${failed === 0 ? `ALL ${passed} CHECKS PASSED ✅` : `${failed} FAILED ❌ (${passed} passed)`}`);
    console.log('═'.repeat(60));
    process.exit(failed === 0 ? 0 : 1);
})();
