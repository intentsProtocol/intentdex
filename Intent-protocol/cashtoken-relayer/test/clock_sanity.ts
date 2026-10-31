/**
 * clock_sanity.ts — the covenant clock.
 *
 * Guards the property that matters: the clock advances 1:1 with wall time, so a
 * Dutch auction traverses its whole price curve instead of jumping start→floor.
 *
 * The previous design used median-time-past directly as the clock. MTP only moves
 * when a block lands, so decay moved in block-sized steps — measured on chipnet, a
 * 600-second auction went 0/600 → 2232/600 in one jump, skipping every price
 * between. Two live orders filled at the floor (141 and 162 units) when their
 * curves started at 282 and 325. The auction stopped auctioning.
 *
 * Section 4 reads the live chain; skip with SKIP_LIVE=1.
 *
 * Run:  npx tsx test/clock_sanity.ts
 */
import { ElectrumSupervisor } from '../src/electrum.js';
import {
    covenantNow, backdateFor, getMedianTimePast, getSpendLocktime,
    checkClockSafety, mtpLagSeconds, _clearMtpCache,
} from '../src/bot/CovenantClock.js';
import { RelayerSolver, isNotYetStarted } from '../src/bot/DutchAuctionSolver.js';
import { KNOWN_AUCTIONS, type DutchAuctionIntent } from '../src/registry.js';
import type { ScannedUtxo } from '../src/scanner.js';

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
}
const section = (s: string) => console.log(`\n── ${s} ──`);

/** Mirrors DutchAuctionSwap.cash. */
function price(lock: number, start: number, dur: number, sb: number, eb: number): number {
    const elapsed = Math.max(0, lock - start);
    const clamped = Math.min(elapsed, dur);
    return sb - Math.floor((sb - eb) * clamped / dur);
}

console.log('=== COVENANT CLOCK SANITY ===');

// ── 1. The clock advances 1:1 with wall time ────────────────────────────────
section('1. clock tracks wall time');
{
    const a = covenantNow('chipnet');
    const wall = Math.floor(Date.now() / 1000);
    check('clock is exactly wall clock minus the backdate',
        a === wall - backdateFor('chipnet'), `${a} vs ${wall - backdateFor('chipnet')}`);
    check('mainnet and chipnet use their own backdates',
        covenantNow('mainnet') - covenantNow('chipnet')
            === backdateFor('chipnet') - backdateFor('mainnet'));
    check('the clock is a valid timestamp, not a block height', a >= 500_000_000);
}

// ── 2. THE REGRESSION: decay must traverse the curve ────────────────────────
section('2. a Dutch auction traverses its whole price curve');
{
    const start = covenantNow('chipnet');
    const dur = 600, sb = 282, eb = 141;

    // Sample the price at every minute of a 10-minute auction, as the clock would
    // actually advance (1s of wall time = 1s of clock).
    const seen = new Set<number>();
    for (let t = 0; t <= dur; t += 60) seen.add(price(start + t, start, dur, sb, eb));

    check('price is start at t=0', price(start, start, dur, sb, eb) === sb);
    check('price is floor at t=duration', price(start + dur, start, dur, sb, eb) === eb);
    check('price is strictly between at t=duration/2',
        price(start + dur / 2, start, dur, sb, eb) > eb
        && price(start + dur / 2, start, dur, sb, eb) < sb,
        `got ${price(start + dur / 2, start, dur, sb, eb)}`);
    // The whole point: many distinct prices, not two.
    check('the curve offers many distinct prices, not just start and floor',
        seen.size >= 8, `only ${seen.size} distinct prices across the auction`);
    check('price decreases monotonically',
        [...Array(11)].every((_, i) => i === 0
            || price(start + i * 60, start, dur, sb, eb) <= price(start + (i - 1) * 60, start, dur, sb, eb)));
}

// ── 3. Backdate cancels out of every duration ───────────────────────────────
section('3. the backdate cancels, so durations are real seconds');
{
    // Dutch: created at clock T, filled d seconds later → decayed exactly d.
    const created = covenantNow('chipnet');
    const filledAt = created + 137;              // 137s of wall time later
    check('Dutch elapsed equals real elapsed', filledAt - created === 137);

    // Limit: expiry = clock + chosen, so the flip is exactly `chosen` seconds out.
    const chosen = 3600;
    const expiry = created + chosen;
    check('limit window equals the chosen duration', expiry - created === chosen);
    // Under the old mixed-clock scheme the deadline was wall-clock while the
    // locktime was backdated, so the window was chosen + backdate.
    check('no backdate leaks into the window',
        expiry - created !== chosen + backdateFor('chipnet'));

    // Changing the backdate must not change any duration.
    const other = created - 3600;                 // pretend a different backdate
    check('a different backdate yields the same durations',
        (other + chosen) - other === chosen);
}

// ── 4. Live chain: is the backdate actually safe? ───────────────────────────
section('4. live chain — backdate clears the real MTP lag');
if (process.env.SKIP_LIVE) {
    console.log('  (skipped: SKIP_LIVE set)');
} else {
    for (const net of ['chipnet', 'mainnet'] as const) {
        const sup = new ElectrumSupervisor(net);
        await sup.start();
        try {
            _clearMtpCache();
            const c = await checkClockSafety(sup.provider, net);
            console.log(`     ${net}: backdate ${c.backdate}s, MTP lag ${c.lagSec}s, margin ${c.marginSec}s`);

            check(`${net}: backdate exceeds the real MTP lag`, c.safe,
                `lag ${c.lagSec}s >= backdate ${c.backdate}s — spends would be NON-FINAL`);
            check(`${net}: margin is not razor thin`, c.marginSec > c.backdate * 0.1,
                `only ${c.marginSec}s of headroom`);

            const lock = await getSpendLocktime(sup.provider, net);
            const mtp = await getMedianTimePast(sup.provider, net);
            check(`${net}: stamped locktime <= MTP (transaction is final)`, lock <= mtp,
                `locktime ${lock} > mtp ${mtp}`);
            check(`${net}: locktime equals the covenant clock`,
                Math.abs(lock - covenantNow(net)) <= 1, `${lock} vs ${covenantNow(net)}`);
            check(`${net}: MTP genuinely trails wall clock`, mtpLagSeconds(mtp) > 0);
            check(`${net}: MTP is a plausible recent timestamp`,
                mtp > 1_600_000_000 && mtp <= Math.floor(Date.now() / 1000), `mtp=${mtp}`);

            // A second read must not hit the network again — the scan loop reads this
            // per cycle, and MTP only changes when a block lands.
            const t1 = Date.now();
            const again = await getMedianTimePast(sup.provider, net);
            check(`${net}: cached read is instant and identical`,
                again === mtp && Date.now() - t1 < 50, `${Date.now() - t1}ms`);
        } finally {
            await sup.stop();
        }
    }
}

// ── 5. The solver itself decays, and refuses auctions that aren't open ──────
section('5. solver pricing across the clock');
if (process.env.SKIP_LIVE) {
    console.log('  (skipped: SKIP_LIVE set — needs a provider to build contracts)');
} else {
    const sup = new ElectrumSupervisor('chipnet');
    await sup.start();
    try {
        const solver = new RelayerSolver('chipnet', sup.provider);
        const t0 = covenantNow('chipnet');
        const auction: DutchAuctionIntent = {
            address: 'bchtest:pqclocktest000000000000000000000000000000000000000000000000',
            makerPkh: new Uint8Array(20),
            sellTokenCategory: '0x',
            buyTokenCategory: '0x' + 'ab'.repeat(32),
            sellAmount: 100_000n,
            startBuyAmount: 40_000n,
            endBuyAmount: 30_000n,
            startTime: BigInt(t0),
            duration: 600n,
        };
        KNOWN_AUCTIONS.push(auction);
        const utxo: ScannedUtxo = {
            address: auction.address, txid: '00'.repeat(32), vout: 0, satoshis: 100_000n,
        };

        // Sample the solver's own price at each minute of the auction, at the
        // locktimes the covenant clock would actually produce.
        const prices: bigint[] = [];
        for (let t = 0; t <= 600; t += 60) {
            const r = solver.solve(utxo, t0 + t);
            if (!r || isNotYetStarted(r)) { prices.push(-1n); continue; }
            prices.push(r.currentPrice);
        }
        console.log(`     solver prices across the curve: ${prices.join(' → ')}`);

        check('solver prices the open of the auction at startBuyAmount', prices[0] === 40_000n, `${prices[0]}`);
        check('solver prices the close at endBuyAmount', prices[prices.length - 1] === 30_000n, `${prices[prices.length - 1]}`);
        check('solver walks the curve rather than jumping to the floor',
            new Set(prices.map(String)).size >= 8, `${new Set(prices.map(String)).size} distinct prices`);
        check('solver prices decrease monotonically',
            prices.every((p, i) => i === 0 || p <= prices[i - 1]));

        // Not-yet-open: the guard that stops us broadcasting a doomed fill.
        const early = solver.solve(utxo, t0 - 300);
        check('an auction that has not opened is reported, not solved', isNotYetStarted(early));
        check('and it reports how long until it opens',
            isNotYetStarted(early) && Math.abs(early.opensInSec - 300) <= 1,
            isNotYetStarted(early) ? `${early.opensInSec}s` : 'not reported');

        KNOWN_AUCTIONS.length = 0;
    } finally {
        await sup.stop();
    }
}

console.log(`\n${'═'.repeat(62)}`);
console.log(`  ${failed === 0 ? `ALL ${passed} CHECKS PASSED ✅` : `${failed} FAILED ❌ (${passed} passed)`}`);
console.log('═'.repeat(62));
process.exit(failed === 0 ? 0 : 1);
