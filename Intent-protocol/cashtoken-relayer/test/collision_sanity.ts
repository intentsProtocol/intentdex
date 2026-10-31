/**
 * collision_sanity.ts — covenant address collision handling. No network calls.
 *
 * Guards a fund-stranding bug reproduced live with real coins.
 *
 * Covenant addresses are NOT unique per intent: constructor params are baked into
 * the P2SH32 address, and both order types derive a time field at second
 * granularity (Dutch `startTime = now − 7200`, limit `expiryTime = now + preset`).
 * Three intents created in the same second therefore shared ONE address. The
 * solver filled one UTXO, `markIntentDone()` resolved by address via `.find()` so
 * only the first record settled, then it dropped the address from WATCH_ADDRESSES —
 * orphaning the other two funded UTXOs. 100,000 sats became unreachable and two
 * records sat 'pending' forever.
 *
 * Run:  npx tsx test/collision_sanity.ts
 */
import {
    pickIntentForOutpoint, hasOpenIntentsAt, isNonTerminalStatus,
    TERMINAL_STATUSES, NON_TERMINAL_STATUSES, ALL_STATUSES,
} from '../src/intentStore.js';
import type { StoredIntent, IntentStatus, Outpoint } from '../src/intentStore.js';

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
}
const section = (s: string) => console.log(`\n── ${s} ──`);

const ADDR  = 'bchtest:pwwrn000rtgquvv4pcxhut0he580gdpx84ggxtjrv3t395hwjzack380pstyk';
const OTHER = 'bchtest:pzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
const FUND  = '41e0650067f15227467202f731fb03f0100b6a55d48207209e09615e42bea1a3';

let seq = 0;
function intent(over: Partial<StoredIntent> = {}): StoredIntent {
    return {
        id: `intent_${++seq}`,
        type: 'DUTCH_AUCTION',
        makerAddress: 'bchtest:qmaker',
        contractAddress: ADDR,
        tokenAddress: 'bchtest:rtoken',
        sellToken: 'BCH', buyToken: 'BCH',
        sellAmount: '50000', buyAmount: '40000',
        status: 'pending',
        createdAt: Date.now(),
        ...over,
    } as StoredIntent;
}
const op = (vout: number): Outpoint => ({ txid: FUND, vout });

console.log('=== COLLISION SANITY (address is not a unique key) ===');

// ── 1. Status bookkeeping is derived, not duplicated ────────────────────────
section('1. terminal / non-terminal sets are consistent');
{
    check('every status is classified exactly once',
        ALL_STATUSES.every(s => TERMINAL_STATUSES.has(s) !== isNonTerminalStatus(s)));
    check('no overlap between the two sets',
        !NON_TERMINAL_STATUSES.some(s => TERMINAL_STATUSES.has(s)));
    check('union covers every declared status',
        ALL_STATUSES.length === TERMINAL_STATUSES.size + NON_TERMINAL_STATUSES.length,
        `${ALL_STATUSES.length} vs ${TERMINAL_STATUSES.size}+${NON_TERMINAL_STATUSES.length}`);
    // 'failed' and 'expired' must stay non-terminal: both describe a covenant that
    // is still FUNDED and still needs the bot to come back to it.
    check("'failed' is non-terminal (still funded)", isNonTerminalStatus('failed' as IntentStatus));
    check("'expired' is non-terminal (refund pending)", isNonTerminalStatus('expired' as IntentStatus));
    check("'abandoned' is terminal (never funded)", TERMINAL_STATUSES.has('abandoned' as IntentStatus));
}

// ── 2. THE BUG: three records, one address ─────────────────────────────────
section('2. three colliding records distribute 1:1 across three UTXOs');
{
    const all = [intent(), intent(), intent()];

    // Cycle 1: the scanner reports three UTXOs at the one address. Each should
    // claim a different record — the old code stamped all three onto the first.
    const claimed: string[] = [];
    for (const vout of [0, 1, 2]) {
        const picked = pickIntentForOutpoint(all, ADDR, op(vout));
        if (!picked) { check(`vout ${vout} resolved`, false); continue; }
        claimed.push(picked.id);
        picked.fundingTxid = FUND;          // simulate markIntentActive claiming it
        picked.fundingVout = vout;
        picked.status = 'active';
    }
    check('all three UTXOs resolved', claimed.length === 3);
    check('each UTXO claimed a DISTINCT record', new Set(claimed).size === 3,
        `claimed: ${claimed.join(', ')}`);

    // Cycle 2: re-resolving must be stable — same outpoint, same record.
    const stable = [0, 1, 2].every(v => {
        const p = pickIntentForOutpoint(all, ADDR, op(v));
        return p?.fundingVout === v;
    });
    check('re-resolution is stable per outpoint', stable);

    // Settle only vout 1. The other two must remain untouched and still open.
    const target = pickIntentForOutpoint(all, ADDR, op(1))!;
    target.status = 'filled';
    check('only the matching record settled',
        all.filter(i => i.status === 'filled').length === 1);
    check('siblings remain non-terminal',
        all.filter(i => isNonTerminalStatus(i.status)).length === 2);

    // THE STRANDING GUARD: the address must stay watched.
    check('address still has open intents → stays watched', hasOpenIntentsAt(all, ADDR));

    // Settle the rest; only then may it be unwatched.
    for (const i of all) if (isNonTerminalStatus(i.status)) i.status = 'filled';
    check('address released once all records settle', !hasOpenIntentsAt(all, ADDR));
}

// ── 3. Fewer UTXOs than records (the reaper hazard) ────────────────────────
section('3. one funded UTXO, three records — reaper must not tear down');
{
    const all = [intent(), intent(), intent()];
    const funded = pickIntentForOutpoint(all, ADDR, op(0))!;
    funded.fundingTxid = FUND; funded.fundingVout = 0; funded.status = 'active';

    // The other two never got funded, so the reaper marks them abandoned.
    for (const i of all) if (i.fundingTxid === undefined) i.status = 'abandoned';
    check('two unfunded records abandoned',
        all.filter(i => i.status === 'abandoned').length === 2);
    check('funded sibling still open', isNonTerminalStatus(funded.status));
    check('reaper must NOT unwatch — funded UTXO still live', hasOpenIntentsAt(all, ADDR));
}

// ── 4. Non-colliding addresses are unaffected ─────────────────────────────
section('4. distinct addresses resolve independently');
{
    const all = [intent(), intent({ contractAddress: OTHER })];
    const a = pickIntentForOutpoint(all, ADDR, op(0));
    const b = pickIntentForOutpoint(all, OTHER, op(0));
    check('each address resolves its own record', !!a && !!b && a.id !== b.id);
    check('settling one leaves the other watched', (() => {
        a!.status = 'filled';
        return !hasOpenIntentsAt(all, ADDR) && hasOpenIntentsAt(all, OTHER);
    })());
}

// ── 5. Fallbacks ──────────────────────────────────────────────────────────
section('5. resolution fallbacks');
{
    const all = [intent({ fundingTxid: FUND, fundingVout: 7, status: 'active' })];
    check('address-only resolution still works (no outpoint given)',
        pickIntentForOutpoint(all, ADDR)?.id === all[0].id);
    // An outpoint we have never seen, with every record already claimed: fall back
    // rather than silently dropping the settlement on the floor.
    check('unknown outpoint falls back to an open record at the address',
        pickIntentForOutpoint(all, ADDR, op(99))?.id === all[0].id);
    check('unknown address resolves to nothing',
        pickIntentForOutpoint(all, OTHER, op(0)) === undefined);

    const settled = [intent({ status: 'filled' })];
    check('terminal-only address resolves to nothing',
        pickIntentForOutpoint(settled, ADDR, op(0)) === undefined);
    check('terminal-only address is not watched', !hasOpenIntentsAt(settled, ADDR));
}

// ── 6. Status filtering is honoured ───────────────────────────────────────
section('6. explicit status filters');
{
    const all = [intent({ status: 'failed' }), intent({ status: 'pending' })];
    check('restricting to pending/active skips the failed record',
        pickIntentForOutpoint(all, ADDR, op(0), ['pending', 'active'])?.status === 'pending');
    check('default filter includes failed',
        pickIntentForOutpoint(all, ADDR, undefined)?.status === 'failed');
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`  ${failed === 0 ? `ALL ${passed} CHECKS PASSED ✅` : `${failed} FAILED ❌ (${passed} passed)`}`);
console.log('═'.repeat(60));
process.exit(failed === 0 ? 0 : 1);
