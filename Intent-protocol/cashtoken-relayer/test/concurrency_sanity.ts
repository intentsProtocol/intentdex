

/**
 * Concurrency sanity test — UtxoReservation race safety (no chain, no server).
 *
 * The bot loop now processes SOLVER_CONCURRENCY matched intents in parallel
 * (see index.ts / UtxoReservation.ts). The one property that MUST hold under
 * concurrency is: two "in-flight" fills can never pick the same solver-wallet
 * UTXO as an input before either has broadcast — otherwise they'd build
 * conflicting transactions.
 *
 * This test doesn't touch the network. It simulates N concurrent workers
 * racing over a shared pool of M synthetic UTXOs, using the real
 * UtxoReservation module exactly the way DutchAuctionExecutor.ts and
 * CauldronRouter.ts use it: fetch → filterAvailable() → pick → reserve()
 * → (simulated broadcast delay) → done. It asserts:
 *
 *   1. No UTXO is ever claimed by more than one worker.
 *   2. Every UTXO that CAN be claimed (pool size >= worker count) IS claimed
 *      exactly once — no capital is left stranded by over-eager reservation.
 *   3. Workers that lose the race when capital runs out fail gracefully
 *      (this is exactly the "insufficient solver capital" scenario for 100
 *      concurrent users sharing a finite wallet).
 */

import * as assert from 'assert';
import { reserveOutpoint, filterAvailable, isReserved, reservationCount, clearReservations } from '../src/bot/UtxoReservation.js';

const pass = (m: string) => console.log(`  ✅ ${m}`);
const fail = (m: string) => { console.error(`  ❌ ${m}`); process.exitCode = 1; };
const info = (m: string) => console.log(`  ℹ️  ${m}`);
const banner = (m: string) => console.log(`\n${'═'.repeat(72)}\n  ${m}\n${'═'.repeat(72)}`);

interface FakeUtxo { txid: string; vout: number; satoshis: bigint; }

function makePool(size: number, namespace: string): FakeUtxo[] {
    return Array.from({ length: size }, (_, i) => ({
        txid: `${namespace}_${i.toString().padStart(4, '0')}`,
        vout: 0,
        satoshis: 100_000n,
    }));
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Mirrors the real selection pattern used in DutchAuctionExecutor.execute():
 *   fetch fresh UTXO list → filterAvailable() → pick candidate → reserve()
 *   IMMEDIATELY (before any await) → simulate the async broadcast.
 */
async function simulateWorker(
    workerId: number,
    fetchPool: () => FakeUtxo[],
    claimed: Map<string, number>,
    broadcastDelayMs: number,
): Promise<{ workerId: number; claimedOutpoint: string | null }> {
    // Random jitter before starting, so workers genuinely interleave rather
    // than run in strict launch order.
    await sleep(Math.random() * 5);

    const available = filterAvailable(fetchPool());
    if (available.length === 0) {
        return { workerId, claimedOutpoint: null };
    }
    const picked = available[0];
    const outpoint = `${picked.txid}:${picked.vout}`;

    // Reserve synchronously, before any further await — this is the exact
    // safety property the real executor/router code relies on.
    reserveOutpoint(outpoint);

    // Simulate network latency for building + broadcasting the tx.
    await sleep(broadcastDelayMs);

    // Record the claim AFTER the "broadcast" completes, same as the real
    // code recording consumedOutpoints post-hoc — but the reservation
    // already happened before this await, which is what prevents collisions.
    if (claimed.has(outpoint)) {
        // Two workers claimed the same UTXO — this must never happen.
        claimed.set(outpoint, (claimed.get(outpoint) ?? 0) + 1);
    } else {
        claimed.set(outpoint, 1);
    }
    return { workerId, claimedOutpoint: outpoint };
}

async function main() {
    banner('CONCURRENCY SANITY: UtxoReservation race safety');

    // ── Test 1: exact contention — N workers, N UTXOs, all should succeed ──
    {
        clearReservations();
        const N = 20;
        const pool = makePool(N, 'test1');
        const claimed = new Map<string, number>();
        info(`Test 1: ${N} concurrent workers racing over exactly ${N} UTXOs (variable broadcast latency 5-40ms)`);

        const results = await Promise.all(
            Array.from({ length: N }, (_, i) =>
                simulateWorker(i, () => pool, claimed, 5 + Math.random() * 35))
        );

        const successes = results.filter(r => r.claimedOutpoint !== null);
        const collisions = [...claimed.values()].filter(count => count > 1);

        if (successes.length === N) pass(`All ${N} workers claimed a distinct UTXO`);
        else fail(`Expected ${N} successful claims, got ${successes.length}`);

        if (collisions.length === 0) pass('No UTXO was ever claimed by more than one worker');
        else fail(`${collisions.length} UTXO(s) were double-claimed — RACE CONDITION`);

        const distinctOutpoints = new Set(successes.map(r => r.claimedOutpoint));
        if (distinctOutpoints.size === N) pass('All claimed outpoints are distinct (no duplicates across workers)');
        else fail(`Expected ${N} distinct outpoints, got ${distinctOutpoints.size}`);
    }

    // ── Test 2: capital exhaustion — more workers than UTXOs ────────────────
    {
        clearReservations();
        const POOL_SIZE = 8;
        const WORKER_COUNT = 25; // simulates ~25 concurrent orders vs a smaller wallet
        const pool = makePool(POOL_SIZE, 'test2');
        const claimed = new Map<string, number>();
        info(`Test 2: ${WORKER_COUNT} concurrent workers racing over only ${POOL_SIZE} UTXOs (simulates insufficient solver capital)`);

        const results = await Promise.all(
            Array.from({ length: WORKER_COUNT }, (_, i) =>
                simulateWorker(i, () => pool, claimed, 5 + Math.random() * 35))
        );

        const successes = results.filter(r => r.claimedOutpoint !== null);
        const failures = results.filter(r => r.claimedOutpoint === null);
        const collisions = [...claimed.values()].filter(count => count > 1);

        if (successes.length === POOL_SIZE) pass(`Exactly ${POOL_SIZE} workers succeeded (matches available capital)`);
        else fail(`Expected ${POOL_SIZE} successes, got ${successes.length}`);

        if (failures.length === WORKER_COUNT - POOL_SIZE) {
            pass(`Remaining ${failures.length} workers correctly saw no available capital and backed off (no crash, no partial tx)`);
        } else {
            fail(`Expected ${WORKER_COUNT - POOL_SIZE} graceful failures, got ${failures.length}`);
        }

        if (collisions.length === 0) pass('No double-claim under capital exhaustion either');
        else fail(`${collisions.length} UTXO(s) were double-claimed under contention — RACE CONDITION`);
    }

    // ── Test 3: isReserved() / filterAvailable() basic correctness ──────────
    {
        clearReservations();
        info('Test 3: isReserved()/filterAvailable() basic correctness');
        const before = reservationCount();
        const utxo = { txid: 'basic_check', vout: 3, satoshis: 1000n };
        assert.strictEqual(isReserved(`${utxo.txid}:${utxo.vout}`), false, 'fresh outpoint should not be reserved');
        reserveOutpoint(`${utxo.txid}:${utxo.vout}`);
        assert.strictEqual(isReserved(`${utxo.txid}:${utxo.vout}`), true, 'outpoint should be reserved after reserveOutpoint()');
        const filtered = filterAvailable([utxo, { txid: 'other', vout: 0, satoshis: 1000n }]);
        assert.strictEqual(filtered.length, 1, 'filterAvailable() should drop the reserved UTXO and keep the other one');
        assert.strictEqual(filtered[0].txid, 'other');
        pass('isReserved()/filterAvailable() behave correctly in isolation');
        info(`Reservation registry size: ${before} → ${reservationCount()} (grows monotonically within a cycle, pruned by TTL across cycles)`);
    }

    const failed = process.exitCode === 1;
    console.log(`\n${'═'.repeat(72)}`);
    if (!failed) console.log('  🎉 ALL CONCURRENCY SANITY CHECKS PASSED');
    else console.log('  ⚠️  CONCURRENCY SANITY CHECKS FAILED — see above');
    console.log('═'.repeat(72));
}

main().catch(e => { console.error(e); process.exitCode = 1; });
