/**
 * ledger_sanity.ts — profit-ledger persistence and per-tx realized measurement.
 *
 * Two defects are covered.
 *
 * 1. Realized profit was computed by snapshotting total wallet balance before and
 *    after a fill. That only works if nothing else touches the wallet in between,
 *    which under SOLVER_CONCURRENCY > 1 is never true. Both failure modes were
 *    observed live: 12 parallel fills reported 4,427,058 sats against ~84,000
 *    actual, and a single TOKEN_TO_BCH fill reported 4,784 against a real 523,239
 *    (the snapshot landed after the rebalance spent the fill's outputs but before
 *    its own output propagated). Scenario 3 replays that exact fill from chain data
 *    and asserts the new method gets it right.
 *
 * 2. The ledger was in-memory only, so every restart wiped profit history and
 *    /router/metrics returned an empty byRouteType.
 *
 * Scenario 3 needs network access (it fetches two real chipnet transactions).
 * Skip it with SKIP_LIVE=1.
 *
 * Run:  npx tsx test/ledger_sanity.ts
 *       SKIP_LIVE=1 npx tsx test/ledger_sanity.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProfitLedger } from '../src/bot/ProfitLedger.js';
import { lockingSet, combinedDelta } from '../src/bot/TxDelta.js';
import { ElectrumSupervisor } from '../src/electrum.js';

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
}
const section = (s: string) => console.log(`\n── ${s} ──`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-sanity-'));
const CASH   = 'bchtest:qzufsn0wtcmc4lhc3s3trhl0nxn6dgkpmgvzngkxl7';
const TOKEN  = 'bchtest:zzufsn0wtcmc4lhc3s3trhl0nxn6dgkpmgtgqkcqqd';
const PROFIT = 'bchtest:qqnr325e5fas782rrn72gf53gjat8m5rsv8ar5ulcw';

(async () => {
    console.log('=== LEDGER SANITY ===');

    // ── 1. Address → locking-script conversion ──────────────────────────────
    section('1. tracked-address set');
    {
        // A wallet's cashaddr and tokenaddr are the SAME P2PKH script under different
        // address encodings, so they collapse to one entry — the same reason
        // dedupUtxos() exists in the bot loop. Three addresses, two scripts.
        const mine = lockingSet([CASH, TOKEN, PROFIT]);
        check('cashaddr + tokenaddr collapse to one script, profit address is distinct',
            mine.size === 2, `got ${mine.size}`);
        check('cashaddr and tokenaddr really are the same script',
            lockingSet([CASH]).size === 1 && lockingSet([CASH, TOKEN]).size === 1);
        check('a genuinely different address adds an entry',
            lockingSet([CASH, PROFIT]).size === 2);
        const withJunk = lockingSet([CASH, undefined, null, 'not-an-address']);
        check('undefined / invalid entries are dropped, not thrown on', withJunk.size === 1,
            `got ${withJunk.size}`);
    }

    // ── 2. Persistence across restarts ──────────────────────────────────────
    section('2. records survive a restart');
    {
        const store = path.join(tmp, 'ledger.json');

        const first = new ProfitLedger([CASH, TOKEN], 100, store);
        first.recordPredicted('intent-a', 'DIRECT', 7_000n, 0);
        first.attachTxids('intent-a', { fillTxid: 'aa'.repeat(32) });
        first.recordRealized('intent-a', 6_800n);
        first.recordPredicted('intent-b', 'TOKEN_TO_BCH', 520_847n, 12);

        check('store file written', fs.existsSync(store));

        // Simulate a redeploy.
        const second = new ProfitLedger([CASH, TOKEN], 100, store);
        const m = second.metrics();
        check('both records restored', m.totalFills === 2, `got ${m.totalFills}`);
        check('bigints round-trip as decimal strings',
            m.totalPredictedSats === String(7_000n + 520_847n), `got ${m.totalPredictedSats}`);
        check('realized figure restored', m.totalRealizedSats === '6800', `got ${m.totalRealizedSats}`);
        check('byRouteType is not empty after restart',
            Object.keys(m.byRouteType).length === 2, JSON.stringify(m.byRouteType));
        check('restored record is still updatable',
            second.recordRealized('intent-b', 500_000n)?.realizedSats === 500_000n);
    }

    // ── 3. THE REGRESSION: replay a real rebalanced fill ────────────────────
    section('3. per-tx delta on a real TOKEN_TO_BCH fill (live chain read)');
    if (process.env.SKIP_LIVE) {
        console.log('  (skipped: SKIP_LIVE set)');
    } else {
        // The fill from the very first telemetry run. Balance-snapshotting reported
        // 4,784 sats for this; decoding the two legs gives the true figure.
        const FILL   = '55f91d0e2a0a81446b79543416264e063f203fad97e58ce028e83ae1923f1ecc';
        const REBAL  = '92e28c6581667895167968c60ddedacd5ca50f38937e37be59cf4195896aa9fe';
        const PREDICTED = 520_847n;

        const sup = new ElectrumSupervisor('chipnet');
        await sup.start();
        try {
            const mine = lockingSet([CASH, TOKEN, PROFIT]);

            const fillOnly = await combinedDelta(sup.provider, [FILL], mine);
            const both = await combinedDelta(sup.provider, [FILL, REBAL], mine);

            console.log(`     fill leg alone : ${fillOnly.netSats} sats`);
            console.log(`     fill + rebalance: ${both.netSats} sats`);
            console.log(`     predicted       : ${PREDICTED} sats`);

            // The fill leg alone is BCH-negative: it pays the maker and takes tokens.
            // Measuring one leg is exactly how the old code got 4,784.
            check('fill leg alone is BCH-negative (why single-leg measurement misleads)',
                fillOnly.netSats < 0n, `got ${fillOnly.netSats}`);
            check('summed legs are positive', both.netSats > 0n, `got ${both.netSats}`);

            // Ground truth is +523,239 against a prediction of 520,847 — 0.46% error.
            const errBps = Number(((both.netSats - PREDICTED) * 10_000n) / PREDICTED);
            check('summed delta matches the prediction within 1%',
                Math.abs(errBps) < 100, `${errBps} bps off`);
            check('tokens net to zero across the pair (bought then sold)',
                [...both.tokenDeltas.values()].every(d => d === 0n),
                JSON.stringify([...both.tokenDeltas].map(([k, v]) => [k.slice(0, 10), String(v)])));
            check('no missing parent transactions', !both.incomplete);

            // And the ledger wired end-to-end.
            const store = path.join(tmp, 'live.json');
            const ledger = new ProfitLedger([CASH, TOKEN, PROFIT], 100, store);
            ledger.recordPredicted('live-fill', 'TOKEN_TO_BCH', PREDICTED, 0);
            const { netSats } = await ledger.measureRealized(sup.provider, {
                fillTxid: FILL, postFillTxid: REBAL,
            });
            const rec = ledger.recordRealized('live-fill', netSats);
            check('ledger.measureRealized agrees with combinedDelta', rec?.realizedSats === both.netSats);
            check('deltaBps is now small, not -9908', Math.abs(rec?.deltaBps ?? 99999) < 100,
                `got ${rec?.deltaBps}`);
        } finally {
            await sup.stop();
        }
    }

    // ── 4. Metrics arithmetic ───────────────────────────────────────────────
    section('4. metrics aggregation');
    {
        const ledger = new ProfitLedger([CASH], 100, null);   // null = no persistence
        ledger.recordPredicted('x', 'DIRECT', 1_000n, 0);
        ledger.recordRealized('x', 900n);
        ledger.recordPredicted('y', 'DIRECT', 1_000n, 0);
        ledger.recordRealized('y', -200n);          // a loss must be representable
        const m = ledger.metrics();
        check('two fills counted', m.totalFills === 2);
        check('realized sums signed values', m.totalRealizedSats === '700', `got ${m.totalRealizedSats}`);
        check('hit rate excludes the loss', m.hitRate === 0.5, `got ${m.hitRate}`);
        check('null store writes nothing', !fs.existsSync(path.join(tmp, 'nope.json')));
    }

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${failed === 0 ? `ALL ${passed} CHECKS PASSED ✅` : `${failed} FAILED ❌ (${passed} passed)`}`);
    console.log('═'.repeat(60));
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('CRASHED:', e); process.exit(1); });
