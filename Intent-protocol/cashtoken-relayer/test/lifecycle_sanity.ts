/**
 * lifecycle_sanity.ts — offline checks on the intent lifecycle state machine.
 *
 * No network, no broadcasts, no intents.json writes. Pure logic assertions over
 * RelayerSolver.solve() covering the two fund-safety fixes and the fill-window
 * correction:
 *
 *   1. Dutch auctions become refundable after decay + DUTCH_FLOOR_GRACE_SEC
 *      (Dutch has no cancelEarly() by design, so this is the maker's ONLY exit).
 *   2. Dutch stays fillable at floor price DURING the grace window.
 *   3. Limit orders stay fillable right up to the instant they become refundable
 *      (the old code blacked out ~2h of still-valid fill time).
 *   4. Limit orders flip to isExpired exactly at the covenant's cancel() boundary.
 *
 * Run:  npx tsx test/lifecycle_sanity.ts
 */
import { RelayerSolver } from '../src/bot/DutchAuctionSolver.js';
import { KNOWN_AUCTIONS, KNOWN_LIMIT_ORDERS } from '../src/registry.js';
import { ENV } from '../src/config.js';
import type { ScannedUtxo } from '../src/scanner.js';

/**
 * Simulated median-time-past — the clock the covenants actually evaluate against.
 *
 * The absolute value is irrelevant; only offsets from it matter. Deadlines used to be
 * expressed as `wallClock − 7200` here to mirror a hardcoded backdated locktime. That
 * constant is gone: the executor now reads real MTP from the chain, and creation
 * records deadlines in the same space, so the test simply works in MTP directly.
 */
/** Simulated locktime — the value the executor would stamp on a spend. */
const MTP = BigInt(Math.floor(Date.now() / 1000));
const nowSec = () => BigInt(Math.floor(Date.now() / 1000));

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = '') {
    if (cond) { console.log(`  ✅ ${label}${detail ? ` (${detail})` : ''}`); passed++; }
    else      { console.log(`  ❌ ${label}${detail ? ` (${detail})` : ''}`); failed++; }
}

const solver = new RelayerSolver('chipnet');
const utxoFor = (address: string, sats: bigint): ScannedUtxo => ({
    address, txid: '11'.repeat(32), vout: 0, satoshis: sats,
});

// Registry entries are keyed by address; any unique placeholder works since we
// never touch the chain — solve() only matches on address + token category.
const makerPkh = new Uint8Array(20).fill(7);
let seq = 0;
const addr = () => `bchtest:placeholder-${seq++}`;

/**
 * Build a Dutch auction whose decay ENDED `endedAgoSec` real seconds ago.
 * startTime is expressed on the MTP clock, matching how index.ts creates them
 * (startTime = createTime − 7200).
 */
function dutchEndedAgo(endedAgoSec: bigint, duration = 600n) {
    const a = addr();
    const startTime = MTP - duration - endedAgoSec;
    KNOWN_AUCTIONS.push({
        address: a, makerPkh,
        sellTokenCategory: '0x', buyTokenCategory: '0x',
        sellAmount: 100_000n, startBuyAmount: 100_000n, endBuyAmount: 50_000n,
        startTime, duration,
    });
    return a;
}

/** Build a limit order expiring `fromNowSec` real seconds from now. */
function limitExpiringIn(fromNowSec: bigint) {
    const a = addr();
    KNOWN_LIMIT_ORDERS.push({
        address: a, makerPkh,
        sellTokenCategory: '0x', buyTokenCategory: '0x',
        sellAmount: 100_000n, buyAmount: 99_000n,
        expiryTime: MTP + fromNowSec,
    });
    return a;
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  LIFECYCLE SANITY: refund windows & fill windows');
console.log('═══════════════════════════════════════════════════════════\n');
console.log(`  DUTCH_FLOOR_GRACE_SEC = ${ENV.DUTCH_FLOOR_GRACE_SEC}\n`);

const grace = BigInt(ENV.DUTCH_FLOOR_GRACE_SEC);

// ── 1. Dutch mid-decay: fillable, never expired ─────────────────────────────
{
    const a = addr();
    const duration = 600n;
    KNOWN_AUCTIONS.push({
        address: a, makerPkh,
        sellTokenCategory: '0x', buyTokenCategory: '0x',
        sellAmount: 100_000n, startBuyAmount: 100_000n, endBuyAmount: 50_000n,
        startTime: MTP - 300n,                   // 300s into a 600s decay
        duration,
    });
    const s = solver.solve(utxoFor(a, 100_000n), Number(MTP));
    check('Dutch mid-decay → not expired', s !== null && !s.isExpired);
    check('Dutch mid-decay → price between floor and start',
        !!s && s.currentPrice > 50_000n && s.currentPrice < 100_000n, `price=${s?.currentPrice}`);
}

// ── 2. Dutch inside grace window: still fillable at floor ───────────────────
{
    const a = dutchEndedAgo(grace / 2n);
    const s = solver.solve(utxoFor(a, 100_000n), Number(MTP));
    check('Dutch inside grace → still fillable (not expired)', s !== null && !s.isExpired);
    check('Dutch inside grace → pinned at floor price',
        !!s && s.currentPrice === 50_000n, `price=${s?.currentPrice}`);
}

// ── 3. Dutch past grace: refundable (the designed exit, now wired) ──────────
{
    const a = dutchEndedAgo(grace + 60n);
    const s = solver.solve(utxoFor(a, 100_000n), Number(MTP));
    check('Dutch past grace → isExpired (refund triggered)', s !== null && s.isExpired === true);
}

// ── 4. Limit before nominal expiry: fillable ────────────────────────────────
{
    const a = limitExpiringIn(3600n);
    const s = solver.solve(utxoFor(a, 100_000n), Number(MTP));
    check('Limit before expiry → fillable', s !== null && !s.isExpired);
}

// ── 5. The maker's chosen duration is what they get ─────────────────────────
//     Deadlines and the locktime now share one clock (real MTP), so a 1h order is
//     fillable for 1h — not 3h. Previously the deadline was written in wall-clock
//     while the locktime was backdated 7200s, and that difference landed on top as
//     a silent skew, so an order stayed fillable for its duration PLUS two hours.
{
    const oneHour = 3600n;
    const fresh = limitExpiringIn(oneHour);
    const s0 = solver.solve(utxoFor(fresh, 100_000n), Number(MTP));
    check('Limit within its window → fillable', s0 !== null && !s0.isExpired);

    // One second past the chosen duration it must flip, with no 2h grace tacked on.
    const s1 = solver.solve(utxoFor(fresh, 100_000n), Number(MTP + oneHour + 1n));
    check('Limit one second past its chosen expiry → refundable, no +2h skew',
        s1 !== null && s1.isExpired === true,
        s1 && !s1.isExpired ? 'still fillable — skew has returned' : '');

    // And explicitly: it must NOT still be fillable an hour later, which is what
    // the old convention did.
    const s2 = solver.solve(utxoFor(fresh, 100_000n), Number(MTP + oneHour + 3600n));
    check('Limit is not silently fillable an hour past expiry', s2 !== null && s2.isExpired === true);
}

// ── 6. Limit past its deadline: refundable ─────────────────────────────────
{
    const a = limitExpiringIn(-600n);             // expired 600s ago on the MTP clock
    const s = solver.solve(utxoFor(a, 100_000n), Number(MTP));
    check('Limit past MTP catch-up → isExpired (refund)', s !== null && s.isExpired === true);
}

// ── 7. Complementary windows: no gap where both fill and cancel are invalid ─
{
    const a = limitExpiringIn(5n);               // 5s before the flip
    const b = limitExpiringIn(-5n);              // 5s after the flip
    const sa = solver.solve(utxoFor(a, 100_000n), Number(MTP));
    const sb = solver.solve(utxoFor(b, 100_000n), Number(MTP));
    check('Just before boundary → fillable, not expired', sa !== null && !sa.isExpired);
    check('Just after boundary → expired (refundable)', sb !== null && sb.isExpired === true);
    check('No dead zone: every limit order is either fillable or refundable',
        sa !== null && sb !== null);
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log(`  RESULT: ${failed === 0 ? 'PASSED ✅' : `FAILED ❌ (${failed} of ${passed + failed})`}`);
console.log('═══════════════════════════════════════════════════════════\n');
process.exit(failed === 0 ? 0 : 1);
