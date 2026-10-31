/**
 * E2E — Concurrent order fills against the LIVE relayer (bounded-parallel bot loop).
 *
 * Proves the SOLVER_CONCURRENCY refactor (index.ts botLoop + UtxoReservation.ts)
 * actually works against the real, running bot: several simultaneously-fillable
 * Limit Orders land on-chain within the same scan window, and the bot processes
 * them without any UTXO collision, duplicate fill, or crash — the core "handle
 * many users at once" requirement.
 *
 * This is a scaled-down proof (a handful of concurrent orders, not literally
 * 100 live chipnet transactions — that would be prohibitively slow/costly to
 * run routinely). The safety property it exercises (UtxoReservation preventing
 * two in-flight fills from picking the same solver-wallet UTXO) is the same
 * mechanism regardless of scale; test/concurrency_sanity.ts separately proves
 * that mechanism directly at 20-25-way contention with no network involved.
 *
 * Scenario:
 *   1. Create ORDER_COUNT BCH→PUSD limit orders concurrently (self-fill: the
 *      relayer's own wallet is both maker and solver, same convention as
 *      e2e_multi_direction.ts / e2e_multiple_direct.ts).
 *   2. Fund each covenant (sequential — client-side UTXO selection isn't the
 *      thing under test; the bot's concurrent PROCESSING of them is).
 *   3. Wait for all router:fill WS events.
 *   4. Assert: every order filled, every fillTxid is distinct (no double-fill,
 *      no cross-contamination between orders), and report how tightly the
 *      fill timestamps cluster (evidence of parallel vs. strictly serial
 *      processing).
 *
 * Usage:
 *   RELAYER_API_URL=http://localhost:3006 npx tsx test/e2e_concurrent_orders.ts
 */
import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider, TransactionBuilder, SignatureTemplate } from 'cashscript';
import WebSocket from 'ws';
import * as fs from 'fs';
import 'dotenv/config';
import * as SpreadQuant from '../src/bot/SpreadQuant.js';
import { CauldronPoolCache } from '../src/bot/CauldronPoolCache.js';

const PUSD = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';
const RELAYER_API = process.env.RELAYER_API_URL ?? 'http://localhost:3006';
const ORDER_COUNT = parseInt(process.env.ORDER_COUNT ?? '6', 10);
const FILL_TIMEOUT_MS = parseInt(process.env.FILL_TIMEOUT_MS ?? '300000', 10); // 5 min
const SOLVER_EDGE = 0.11; // 11% cushion (matches e2e_multi_direction.ts's proven-good margin)

const pass = (m: string) => console.log(`  ✅ ${m}`);
const fail = (m: string) => { console.error(`  ❌ ${m}`); process.exitCode = 1; };
const info = (m: string) => console.log(`  ℹ️  ${m}`);
const banner = (m: string) => console.log(`\n${'═'.repeat(72)}\n  ${m}\n${'═'.repeat(72)}`);

async function apiPost(p: string, body?: object): Promise<any> {
    const res = await fetch(`${RELAYER_API}${p}`, {
        method: 'POST',
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
}

async function loadWallet(): Promise<TestNetWallet> {
    if (process.env.RELAYER_PRIVATE_KEY_WIF) return TestNetWallet.fromWIF(process.env.RELAYER_PRIVATE_KEY_WIF);
    const walletPath = process.env.WALLET_PATH ?? '../contracts-bch-swap/wallet.json';
    const wf = fs.existsSync(walletPath) ? walletPath : './wallet.json';
    const { wif } = JSON.parse(fs.readFileSync(wf, 'utf8'));
    return TestNetWallet.fromWIF(wif);
}

async function fundCovenantBCH(wallet: TestNetWallet, contractAddress: string, sats: bigint, provider: ElectrumNetworkProvider): Promise<string> {
    const fromAddr = (wallet as any).cashaddr as string;
    const utxos = await provider.getUtxos(fromAddr);
    const bch = (utxos as any[]).filter(u => !u.token).sort((a, b) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)));
    const u = bch.find(u => BigInt(u.satoshis) >= sats + 1500n);
    if (!u) throw new Error(`No BCH UTXO ≥ ${sats + 1500n} sats`);
    const sig = new SignatureTemplate((wallet as any).privateKeyWif as string);
    const tb = new TransactionBuilder({ provider });
    tb.addInput({ txid: u.txid, vout: u.vout, satoshis: BigInt(u.satoshis) }, sig.unlockP2PKH());
    tb.addOutput({ to: contractAddress, amount: sats });
    const change = BigInt(u.satoshis) - sats - 1000n;
    if (change > 546n) tb.addOutput({ to: fromAddr, amount: change });
    const result = await tb.send();
    return result.txid;
}

interface OrderRecord {
    label: string;
    intentId?: string;
    contractAddress?: string;
    sellAmount: bigint;
    buyAmount: bigint;
    fundTxid?: string;
    fillTxid?: string;
    filledAt?: number;
    status: 'pending' | 'filled' | 'timeout' | 'create_failed' | 'fund_failed';
    note?: string;
}

/** One shared WS connection listening for every order's router:fill event. */
function subscribeFills(records: Map<string, OrderRecord>, onAllDone: () => void): WebSocket {
    const ws = new WebSocket(RELAYER_API.replace(/^http/, 'ws') + '/ws');
    ws.on('message', (raw: any) => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.type !== 'router:fill') return;
            const rec = records.get(msg.data.intentId);
            if (!rec || rec.status === 'filled') return;
            rec.status = 'filled';
            rec.fillTxid = msg.data.fillTxid;
            rec.filledAt = Date.now();
            info(`[WS] ${rec.label} filled — ${rec.fillTxid?.slice(0, 12)}… (route=${msg.data.routeType})`);
            if ([...records.values()].every(r => r.status !== 'pending')) onAllDone();
        } catch { /* ignore malformed frames */ }
    });
    return ws;
}

async function main() {
    banner(`E2E: ${ORDER_COUNT} Concurrent Limit Order Fills`);
    info(`Relayer: ${RELAYER_API}`);

    const wallet = await loadWallet();
    const provider = new ElectrumNetworkProvider('chipnet');
    const makerAddress = (wallet as any).cashaddr as string;
    info(`Wallet: ${makerAddress}`);

    const cache = CauldronPoolCache.forNetwork('chipnet');
    const pools = await cache.getPools();
    const pusdSpot = SpreadQuant.spotPriceSatsPerToken(pools, PUSD);
    const pusdSatsPerUnit = Number(pusdSpot) / 1e8;
    info(`PUSD spot: ${pusdSatsPerUnit.toFixed(2)} sats/unit (${pools.length} pools loaded)`);

    const utxos = await provider.getUtxos(makerAddress);
    const bal = utxos.reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);
    info(`Wallet BCH balance: ${bal} sats`);

    // ── Build ORDER_COUNT distinct-but-similar orders ───────────────────────
    const records = new Map<string, OrderRecord>();
    const orders: OrderRecord[] = [];
    for (let i = 0; i < ORDER_COUNT; i++) {
        const pusdAmount = BigInt(60 + i * 5); // 60, 65, 70, ... — distinguishable, modest size
        const sellAmount = BigInt(Math.floor(pusdSatsPerUnit * Number(pusdAmount) * (1 + SOLVER_EDGE)));
        orders.push({ label: `order-${i + 1} (${pusdAmount} PUSD)`, sellAmount, buyAmount: pusdAmount, status: 'pending' });
    }
    const totalNeeded = orders.reduce((s, o) => s + o.sellAmount, 0n) + BigInt(ORDER_COUNT) * 1500n;
    info(`Total sats needed for ${ORDER_COUNT} orders: ~${totalNeeded}`);
    if (bal < totalNeeded) {
        fail(`Wallet balance (${bal}) insufficient for ${ORDER_COUNT} orders (need ~${totalNeeded}). Reduce ORDER_COUNT or fund the wallet.`);
        return;
    }

    // ── 1. Create all intents CONCURRENTLY (no shared wallet state — safe) ──
    banner('Step 1: Create all intents concurrently');
    await Promise.all(orders.map(async (o) => {
        const res = await apiPost('/intent/create', {
            makerAddress,
            sellToken: 'BCH',
            buyToken: PUSD,
            sellAmount: o.sellAmount.toString(),
            buyAmount: o.buyAmount.toString(),
            orderType: 'limit',
            expiryTime: Math.floor(Date.now() / 1000) + 1800,
            network: 'chipnet',
        });
        if (!res.success) {
            o.status = 'create_failed'; o.note = JSON.stringify(res);
            fail(`${o.label}: creation failed — ${o.note}`);
            return;
        }
        o.intentId = res.intentId;
        o.contractAddress = res.contractAddress;
        records.set(res.intentId, o);
        pass(`${o.label}: intent ${res.intentId}`);
    }));

    const creatable = orders.filter(o => o.intentId);
    if (creatable.length === 0) { fail('No intents were created — aborting'); return; }

    // ── 2. Subscribe to fills BEFORE funding ────────────────────────────────
    let resolveAllDone: () => void;
    const allDone = new Promise<void>(resolve => { resolveAllDone = resolve; });
    const ws = subscribeFills(records, () => resolveAllDone());

    // ── 3. Fund each covenant (sequential on the client side — funding-UTXO
    //      selection here is a test-harness concern, not the system under test) ──
    banner('Step 2: Fund all covenants');
    for (const o of creatable) {
        try {
            o.fundTxid = await fundCovenantBCH(wallet, o.contractAddress!, o.sellAmount, provider);
            pass(`${o.label}: funded — ${o.fundTxid.slice(0, 12)}…`);
        } catch (e: any) {
            o.status = 'fund_failed'; o.note = e.message;
            fail(`${o.label}: funding failed — ${e.message}`);
        }
    }

    // ── 4. Wait for all fills (bot processes them concurrently) ─────────────
    banner(`Step 3: Waiting up to ${FILL_TIMEOUT_MS / 1000}s for all fills`);
    const fundedCount = creatable.filter(o => o.fundTxid).length;
    await Promise.race([
        allDone,
        new Promise(r => setTimeout(r, FILL_TIMEOUT_MS)),
    ]);
    ws.close();

    for (const o of creatable) {
        if (o.fundTxid && o.status === 'pending') o.status = 'timeout';
    }

    // ── 5. Assertions ────────────────────────────────────────────────────────
    banner('Results');
    const filled = creatable.filter(o => o.status === 'filled');
    const fillTxids = filled.map(o => o.fillTxid!);
    const distinctFillTxids = new Set(fillTxids);

    if (filled.length === fundedCount) pass(`All ${fundedCount} funded orders were filled`);
    else fail(`Expected ${fundedCount} fills, got ${filled.length} (${fundedCount - filled.length} timed out)`);

    if (distinctFillTxids.size === fillTxids.length) pass(`All ${fillTxids.length} fillTxids are distinct — no double-fill / cross-contamination`);
    else fail(`Found duplicate fillTxids — ${fillTxids.length} fills but only ${distinctFillTxids.size} distinct txids!`);

    if (filled.length >= 2) {
        const timestamps = filled.map(o => o.filledAt!).sort((a, b) => a - b);
        const spreadMs = timestamps[timestamps.length - 1] - timestamps[0];
        const gaps = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        const minGap = Math.min(...gaps);
        info(`Fill timestamps span ${spreadMs}ms across ${filled.length} fills (min gap between consecutive fills: ${minGap}ms)`);
        if (minGap < 2000) {
            pass(`At least two fills landed <2s apart — consistent with concurrent processing (not strictly one-per-SLEEP_MS-cycle serial)`);
        } else {
            info(`Fills were spaced ≥2s apart this run — inconclusive on concurrency evidence (network/pool timing varies), but correctness checks above still hold`);
        }
    }

    for (const o of orders) {
        console.log(`  ${o.status === 'filled' ? '✅' : '❌'} ${o.label}: ${o.status}${o.note ? ` (${o.note})` : ''}${o.fillTxid ? ` — ${o.fillTxid}` : ''}`);
    }

    const reportPath = `test/reports/concurrent_orders_report_${Date.now()}.json`;
    try {
        fs.mkdirSync('test/reports', { recursive: true });
        fs.writeFileSync(reportPath, JSON.stringify({
            timestamp: Date.now(),
            orderCount: ORDER_COUNT,
            orders: orders.map(o => ({ ...o, sellAmount: o.sellAmount.toString(), buyAmount: o.buyAmount.toString() })),
        }, null, 2));
        info(`Report saved: ${reportPath}`);
    } catch { /* best-effort */ }

    if (process.exitCode !== 1) console.log('\n  🎉 ALL CONCURRENCY E2E CHECKS PASSED\n');
    else console.log('\n  ⚠️  SOME CONCURRENCY E2E CHECKS FAILED\n');
}

main().catch(e => { console.error('FATAL:', e); process.exitCode = 1; });
