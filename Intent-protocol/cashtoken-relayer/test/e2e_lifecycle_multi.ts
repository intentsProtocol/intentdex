/**
 * e2e_lifecycle_multi.ts — LIVE multi-transaction lifecycle test on BCH chipnet.
 *
 * ⚠️  BROADCASTS REAL TRANSACTIONS. Chipnet only.
 *
 * Drives the ACTUAL production pipeline end-to-end:
 *
 *     Scanner.scanAddresses()  →  RelayerSolver.solve()
 *                              →  CauldronRouter.quote()
 *                              →  RelayerExecutor.execute()
 *
 * over four covenants funded in one batched transaction, exercising every
 * behaviour changed in the fund-safety / discovery work:
 *
 *   A) DUTCH, buy-token has no Cauldron pool and is not whitelisted.
 *      Skipped while live, then REFUNDED once decay + grace elapses.
 *      → proves Dutch cancel() is wired (previously never triggered, so a
 *        fully-decayed auction sat at floor price forever), AND that the
 *        refund branch now runs BEFORE the whitelist gate (previously the
 *        gate returned early and stranded exactly these funds).
 *
 *   B) DUTCH mid-decay, BCH→BCH  → FILLED.
 *
 *   C) LIMIT past its wall-clock expiry but before MTP catch-up → FILLED.
 *      → proves the ~2h self-imposed blackout is gone. The covenant always
 *        accepted this fill (locktime = realNow−7200 is still < expiryTime);
 *        the old solver declined it and lost the revenue.
 *
 *   D) LIMIT well inside its window, BCH→BCH → FILLED (control).
 *
 * Every outcome is verified by decoding the broadcast transaction and
 * checking output[0] actually pays the maker, not by trusting return values.
 *
 * Run:
 *   DUTCH_FLOOR_GRACE_SEC=0 npx tsx test/e2e_lifecycle_multi.ts
 *
 * Needs a chipnet wallet (wallet.json or RELAYER_PRIVATE_KEY_WIF) with tBCH.
 * Total cost ≈ 0.002 tBCH in covenant funding (all of it returns to the
 * wallet, since this wallet is both maker and solver) plus miner fees.
 */
import { Contract, SignatureTemplate, TransactionBuilder } from 'cashscript';
import { TestNetWallet, Config } from 'mainnet-js';
import { cashAddressToLockingBytecode, decodeTransaction, hexToBin, binToHex } from '@bitauth/libauth';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { ElectrumSupervisor } from '../src/electrum.js';
import { Scanner } from '../src/scanner.js';
import { RelayerSolver } from '../src/bot/DutchAuctionSolver.js';
import { RelayerExecutor } from '../src/bot/DutchAuctionExecutor.js';
import { CauldronPoolCache } from '../src/bot/CauldronPoolCache.js';
import { CauldronRouter } from '../src/bot/CauldronRouter.js';
import { loadPolicy } from '../src/bot/ProfitPolicy.js';
import { KNOWN_AUCTIONS, KNOWN_LIMIT_ORDERS } from '../src/registry.js';
import { ENV } from '../src/config.js';
import { covenantNow, getSpendLocktime } from '../src/bot/CovenantClock.js';
import { reserveOutpoint, filterAvailable } from '../src/bot/UtxoReservation.js';
import type { ScannedUtxo } from '../src/scanner.js';

(Config as any).EnforceCashScript = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DUTCH_ARTIFACT = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/artifacts/DutchAuctionSwap.json'), 'utf8'));
const LIMIT_ARTIFACT = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/artifacts/LimitOrderSwap.json'), 'utf8'));

// ── Parameters ───────────────────────────────────────────────────────────────
const SELL_SATS      = 50_000n;   // locked in each covenant
const BUY_SATS       = 40_000n;   // paid to the maker on a BCH→BCH fill
/**
 * Deadlines are set relative to CURRENT MEDIAN-TIME-PAST, not wall clock, because
 * that is the clock the covenants evaluate against.
 *
 * Cases that must be past their deadline are constructed already-past rather than
 * waited out: MTP advances in block-sized jumps, so on chipnet (10-25 min gaps) a
 * 90-second auction can take many minutes of real time to actually become
 * refundable. Building them pre-expired keeps the test deterministic and fast.
 */
const DUTCH_DURATION = 60n;       // Dutch A: short, and started before MTP
const DUTCH_BACKDATE = 300n;      // Dutch A startTime sits this far behind MTP
/** A category with no chipnet Cauldron pool and not in FILL_TOKEN_WHITELIST. */
const NO_POOL_TOKEN  = '53636bc8c1afbe35a7ba169eadfac0aebadeacf96954a9a066a483e885580ed4';

// ── Helpers ──────────────────────────────────────────────────────────────────
const reverseHex = (h: string) => h.match(/.{2}/g)!.reverse().join('');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const txUrl = (id: string) => `https://chipnet.chaingraph.cash/tx/${id}`;
const nowSec = () => Math.floor(Date.now() / 1000);

let passed = 0, failed = 0;
const ok  = (m: string) => { passed++; console.log(`  ✅ ${m}`); };
const bad = (m: string) => { failed++; console.error(`  ❌ ${m}`); };
const step = (m: string) => console.log(`\n${'─'.repeat(66)}\n── ${m}\n${'─'.repeat(66)}`);

function p2pkh(pkh: Uint8Array): Uint8Array {
    return Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);
}
function lb(address: string): Uint8Array {
    const r = cashAddressToLockingBytecode(address);
    if (typeof r === 'string') throw new Error(r);
    return r.bytecode;
}

async function main() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  LIVE multi-transaction lifecycle test — chipnet (REAL txs)     ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');

    const grace = ENV.DUTCH_FLOOR_GRACE_SEC;
    if (grace > 120) {
        console.error(`\nDUTCH_FLOOR_GRACE_SEC is ${grace}s — this test would need to wait that long.`);
        console.error('Re-run with:  DUTCH_FLOOR_GRACE_SEC=0 npx tsx test/e2e_lifecycle_multi.ts\n');
        process.exit(2);
    }
    console.log(`\nDUTCH_FLOOR_GRACE_SEC=${grace}  SCAN_CONCURRENCY=${ENV.SCAN_CONCURRENCY}`);

    const wif = process.env.RELAYER_PRIVATE_KEY_WIF
        || JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', ENV.WALLET_PATH), 'utf8')).wif;
    const wallet: any = await TestNetWallet.fromWIF(wif);
    const sig = new SignatureTemplate(wif);
    const selfPkh: Uint8Array = wallet.publicKeyHash;
    const cashaddr = wallet.cashaddr as string;

    const sup = new ElectrumSupervisor('chipnet');
    await sup.start();
    const provider = sup.provider;

    const solver = new RelayerSolver('chipnet', provider);
    const executor = new RelayerExecutor();
    await executor.init(wallet, 'chipnet');
    executor.setProfitAddress(ENV.RELAYER_PROFIT_ADDRESS ?? null);
    const router = new CauldronRouter(
        CauldronPoolCache.forNetwork('chipnet'), loadPolicy(), !!ENV.RELAYER_PROFIT_ADDRESS,
    );

    console.log(`Wallet (maker == solver): ${cashaddr}`);

    // ── Build the four covenants ────────────────────────────────────────────
    step('Step 1 — build 4 covenants');

    // One clock read shared by every covenant here, so their deadlines are mutually
    // consistent and match what the executor will stamp as tx.locktime.
    const mtp = BigInt(covenantNow('chipnet'));
    console.log(`  covenant clock now: ${mtp} (wall clock minus the configured backdate)`);

    // A: already past decay + grace at creation → refundable straight away.
    const startTimeA   = mtp - DUTCH_BACKDATE;
    // B: starts now on the covenant clock → decay begins at zero, mid-curve when filled.
    const startTimeB   = mtp;   // fillable immediately: locktime is read from this same clock
    // C: already past its deadline → refundable straight away.
    const limitCExpiry = mtp - 60n;
    // D: comfortably inside its window → fillable.
    const limitDExpiry = mtp + 3600n;

    // A: DUTCH, wants a token with no pool → never fillable → must refund
    const dutchA = new Contract(DUTCH_ARTIFACT, [
        selfPkh, '0x', `0x${reverseHex(NO_POOL_TOKEN)}`,
        SELL_SATS, 30_000n, 20_000n, startTimeA, DUTCH_DURATION,
    ], { provider });

    // B: DUTCH mid-decay, BCH→BCH → fills
    const dutchB = new Contract(DUTCH_ARTIFACT, [
        selfPkh, '0x', '0x',
        SELL_SATS, BUY_SATS, 30_000n, startTimeB, 3600n,
    ], { provider });

    // C: LIMIT expiring mid-test → must STILL fill after wall-clock expiry
    const limitC = new Contract(LIMIT_ARTIFACT, [
        selfPkh, '0x', '0x', SELL_SATS, BUY_SATS, limitCExpiry,
    ], { provider });

    // D: LIMIT comfortably inside its window → control
    const limitD = new Contract(LIMIT_ARTIFACT, [
        selfPkh, '0x', '0x', SELL_SATS, BUY_SATS, limitDExpiry,
    ], { provider });

    const covenants = [
        { tag: 'A dutch/no-pool', contract: dutchA, expect: 'refund' },
        { tag: 'B dutch/fill',    contract: dutchB, expect: 'fill'   },
        { tag: 'C limit/expired', contract: limitC, expect: 'fill'   },
        { tag: 'D limit/control', contract: limitD, expect: 'fill'   },
    ];
    for (const c of covenants) console.log(`  ${c.tag.padEnd(18)} ${c.contract.address}`);

    // Register exactly as POST /intent/create does
    KNOWN_AUCTIONS.push(
        { address: dutchA.address, makerPkh: selfPkh, sellTokenCategory: '0x', buyTokenCategory: `0x${NO_POOL_TOKEN}`,
          sellAmount: SELL_SATS, startBuyAmount: 30_000n, endBuyAmount: 20_000n, startTime: startTimeA, duration: DUTCH_DURATION },
        { address: dutchB.address, makerPkh: selfPkh, sellTokenCategory: '0x', buyTokenCategory: '0x',
          sellAmount: SELL_SATS, startBuyAmount: BUY_SATS, endBuyAmount: 30_000n, startTime: startTimeB, duration: 3600n },
    );
    KNOWN_LIMIT_ORDERS.push(
        { address: limitC.address, makerPkh: selfPkh, sellTokenCategory: '0x', buyTokenCategory: '0x',
          sellAmount: SELL_SATS, buyAmount: BUY_SATS, expiryTime: limitCExpiry },
        { address: limitD.address, makerPkh: selfPkh, sellTokenCategory: '0x', buyTokenCategory: '0x',
          sellAmount: SELL_SATS, buyAmount: BUY_SATS, expiryTime: limitDExpiry },
    );
    ENV.WATCH_ADDRESSES = covenants.map(c => c.contract.address);

    // ── Fund all four in ONE transaction ────────────────────────────────────
    step('Step 2 — fund all 4 covenants (1 tx, 4 outputs)');

    const walletUtxos = await provider.getUtxos(cashaddr);
    const fundSrc: any = walletUtxos.filter((u: any) => !u.token)
        .sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)))[0];
    if (!fundSrc) { bad('No plain BCH UTXO to fund from'); return finish(sup); }

    const needed = SELL_SATS * 4n + 3000n;
    if (BigInt(fundSrc.satoshis) < needed) {
        bad(`Largest BCH UTXO ${fundSrc.satoshis} < needed ${needed} — consolidate the wallet first`);
        return finish(sup);
    }

    const fundTb = new TransactionBuilder({ provider });
    fundTb.addInput({ txid: fundSrc.txid, vout: fundSrc.vout, satoshis: BigInt(fundSrc.satoshis) }, sig.unlockP2PKH());
    for (const c of covenants) fundTb.addOutput({ to: lb(c.contract.address), amount: SELL_SATS });
    fundTb.addOutput({ to: p2pkh(selfPkh), amount: BigInt(fundSrc.satoshis) - SELL_SATS * 4n - 3000n });
    const fundRes = await fundTb.send();
    reserveOutpoint(`${fundSrc.txid}:${fundSrc.vout}`);
    console.log(`  funding tx: ${txUrl(fundRes.txid)}`);

    // Confirm all four appear via the REAL parallel scanner
    const scanner = new Scanner(provider, provider);
    let scanned: ScannedUtxo[] = [];
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
        scanned = await scanner.scanAddresses();
        if (scanned.length >= 4) break;
        await sleep(3000);
    }
    scanned.length >= 4
        ? ok(`All 4 covenants funded and discovered by Scanner (${scanned.length} UTXOs)`)
        : bad(`Only ${scanned.length}/4 covenants discovered`);
    if (scanned.length < 4) return finish(sup);

    // ── The pipeline, exactly as botLoop's processMatchedUtxo runs it ────────
    const results = new Map<string, { txid?: string; refund: boolean; reason?: string }>();

    async function runPipeline(onlyAddresses: string[]): Promise<void> {
        const utxos = (await scanner.scanAddresses()).filter(u => onlyAddresses.includes(u.address));
        for (const u of utxos) {
            const passLocktime = await getSpendLocktime(provider, 'chipnet');
            const solution = solver.solve(u, passLocktime);
            if (!solution) { results.set(u.address, { refund: false, reason: 'solve() returned null' }); continue; }

            // Refund branch runs BEFORE the whitelist gate (the ordering fix).
            if (solution.isExpired) {
                const r = await executor.execute(solution);
                results.set(u.address, { txid: r?.txid, refund: true, reason: r ? undefined : 'refund broadcast failed' });
                if (r) for (const op of r.consumedOutpoints) reserveOutpoint(op);
                continue;
            }

            const solverUtxos = filterAvailable([
                ...await provider.getUtxos(cashaddr),
                ...await provider.getUtxos(wallet.tokenaddr),
            ]);
            const quote = await router.quote(solution, solverUtxos);
            if (!quote.profitable) { results.set(u.address, { refund: false, reason: `unprofitable: ${quote.reason}` }); continue; }

            solution.predictedProfitSats = quote.netProfitSats > 0n ? quote.netProfitSats : 0n;
            const r = await executor.execute(solution);
            results.set(u.address, { txid: r?.txid, refund: false, reason: r ? undefined : 'fill broadcast failed' });
            if (r) for (const op of r.consumedOutpoints) reserveOutpoint(op);
        }
    }

    /**
     * Decode a broadcast tx and assert output[0] pays the maker within [min, max].
     *
     * A Dutch fill legitimately pays LESS than startBuyAmount — the price decays
     * with elapsed time, and the covenant only enforces `>= currentPrice`. So the
     * meaningful invariant for a Dutch fill is "somewhere in the decay band", not
     * "at least the start price". Limit fills and refunds are exact, so callers
     * pass min === max there.
     */
    async function assertPaysMaker(txid: string, min: bigint, label: string, max?: bigint) {
        const raw = await provider.getRawTransaction(txid);
        const decoded = decodeTransaction(hexToBin(raw));
        if (typeof decoded === 'string') { bad(`${label}: could not decode ${txid}`); return; }
        const out0 = decoded.outputs[0];
        const expected = binToHex(p2pkh(selfPkh));
        if (binToHex(out0.lockingBytecode) !== expected) { bad(`${label}: output[0] does not pay the maker`); return; }
        const v = out0.valueSatoshis;
        const upper = max ?? min;
        if (v < min)      bad(`${label}: output[0] pays ${v} sats, below the floor ${min}`);
        else if (v > upper) bad(`${label}: output[0] pays ${v} sats, above the ceiling ${upper}`);
        else ok(`${label}: output[0] pays maker ${v} sats (within [${min}, ${upper}])`);
    }

    // ── Phase 1: fill B and D now ───────────────────────────────────────────
    step('Step 3 — fill Dutch B + Limit D (2 fills)');
    await runPipeline([dutchB.address, limitD.address]);
    // Dutch B decays 40000 → 30000, so any payment inside that band is correct.
    // Limit D is a fixed price: exactly BUY_SATS.
    const expectations = [
        { tag: 'B dutch/fill',    c: dutchB, min: 30_000n, max: BUY_SATS },
        { tag: 'D limit/control', c: limitD, min: BUY_SATS, max: BUY_SATS },
    ];
    for (const { tag, c, min, max } of expectations) {
        const r = results.get(c.address);
        if (r?.txid && !r.refund) {
            ok(`${tag}: filled — ${txUrl(r.txid)}`);
            await assertPaysMaker(r.txid, min, tag, max);
        } else {
            bad(`${tag}: expected a fill, got ${r?.reason ?? 'nothing'}`);
        }
    }

    // ── Phase 2: Limit C is already past its deadline → refund ──────────────
    step('Step 4 — Limit C past its deadline, expect REFUND');
    console.log('  (deadline and locktime now share one clock, so a limit order flips');
    console.log('   from fillable to refundable at a single instant — no 2h skew, and no');
    console.log('   window where the covenant would accept neither)');

    await runPipeline([limitC.address]);
    {
        const r = results.get(limitC.address);
        if (r?.txid && r.refund) {
            ok(`C limit/expired: REFUNDED — ${txUrl(r.txid)}`);
            await assertPaysMaker(r.txid, SELL_SATS, 'C limit/expired');
        } else {
            bad(`C limit/expired: expected a refund, got ${r?.reason ?? 'nothing'}`);
        }
    }

    // ── Phase 3: Dutch A is already past decay + grace → refund ─────────────
    step('Step 5 — Dutch A past decay + grace, expect REFUND');
    console.log("  (Dutch has no cancelEarly() by design — cancel() is the maker's only exit)");

    await runPipeline([dutchA.address]);
    {
        const r = results.get(dutchA.address);
        if (r?.txid && r.refund) {
            ok(`A dutch/no-pool: REFUNDED — ${txUrl(r.txid)}`);
            await assertPaysMaker(r.txid, SELL_SATS, 'A dutch/no-pool');
            ok('Refund ran despite the buy token having no pool (whitelist-ordering fix)');
        } else {
            bad(`A dutch/no-pool: expected a refund, got ${r?.reason ?? 'nothing'}`);
        }
    }

    // ── Final: every covenant should now be spent ───────────────────────────
    step('Step 6 — verify all covenants are spent');
    for (const c of covenants) {
        const remaining = await provider.getUtxos(c.contract.address);
        remaining.length === 0
            ? ok(`${c.tag}: covenant fully spent`)
            : bad(`${c.tag}: still has ${remaining.length} unspent UTXO(s)`);
    }

    return finish(sup);
}

async function finish(sup: ElectrumSupervisor) {
    await sup.stop();
    console.log(`\n${'═'.repeat(66)}`);
    console.log(`  RESULT: ${failed === 0 ? `ALL ${passed} CHECKS PASSED ✅` : `${failed} FAILED ❌ (${passed} passed)`}`);
    console.log(`${'═'.repeat(66)}\n`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => {
    console.error('\nTEST CRASHED:', e);
    process.exit(1);
});
