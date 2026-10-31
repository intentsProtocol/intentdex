/**
 * stress_fill_throughput.ts — load-test the LIVE relayer's fill pipeline.
 *
 * ⚠️  BROADCASTS REAL TRANSACTIONS. Chipnet only.
 *
 * Unlike e2e_lifecycle_multi.ts (which drives the solver classes in-process),
 * this drives the **running server** through its public API and measures what
 * it actually does under concurrent load:
 *
 *   1. Split the solver wallet into enough funding UTXOs that concurrency is
 *      not starved (the covenant enforces exactly 2 inputs, so every fill needs
 *      its own UTXO ≥ price + fee, held reserved for up to 5 min).
 *   2. POST /intent/create × N so the live server owns the intents.
 *   3. Fund all N covenants in one batched transaction.
 *   4. Watch /ws + poll /intents and /router/metrics until every order settles
 *      or the deadline expires.
 *
 * Reports per-order funding→fill latency (p50/p90/max), throughput, realized
 * vs predicted profit, and any failure reasons.
 *
 * Run:
 *   npx tsx test/stress_fill_throughput.ts [orders] [minutes]
 *   ORDERS=12 MINUTES=10 npx tsx test/stress_fill_throughput.ts
 */
import { SignatureTemplate, TransactionBuilder } from 'cashscript';
import { TestNetWallet, Config } from 'mainnet-js';
import { cashAddressToLockingBytecode } from '@bitauth/libauth';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ElectrumSupervisor } from '../src/electrum.js';
import { ENV } from '../src/config.js';

(Config as any).EnforceCashScript = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELAYER = process.env.RELAYER_URL || `http://localhost:${process.env.PORT || 3006}`;
const ORDERS  = parseInt(process.argv[2] || process.env.ORDERS  || '12', 10);
const MINUTES = parseFloat(process.argv[3] || process.env.MINUTES || '10');

const SELL_SATS = 50_000n;   // locked per covenant
const BUY_SATS  = 40_000n;   // paid to maker → ~10k gross spread per fill
const FUND_UTXO = 60_000n;   // per-fill funding UTXO the solver will consume

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const nowMs = () => Date.now();
const txUrl = (id: string) => `https://chipnet.chaingraph.cash/tx/${id}`;
const pct = (a: number[], p: number) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;

function lb(address: string): Uint8Array {
    const r = cashAddressToLockingBytecode(address);
    if (typeof r === 'string') throw new Error(r);
    return r.bytecode;
}
function p2pkh(pkh: Uint8Array): Uint8Array {
    return Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);
}

interface Tracked {
    intentId: string;
    address: string;
    type: 'limit' | 'dutch';
    tCreate: number;
    tFunded?: number;
    tSettled?: number;
    status: string;
    fillTxid?: string;
    failReason?: string;
    skipReason?: string;
}

async function api(method: 'GET' | 'POST', pathname: string, body?: any): Promise<any> {
    const res = await fetch(RELAYER + pathname, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
}

async function main() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  STRESS TEST — live relayer fill pipeline (REAL chipnet txs)     ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(`relayer=${RELAYER}  orders=${ORDERS}  window=${MINUTES}min\n`);

    const health = await api('GET', '/health');
    console.log(`server: network=${health.network} watching=${health.watching} active=${health.activeIntents} paused=${health.routerPaused}`);
    if (health.routerPaused) { console.error('Router is PAUSED — resume it first (POST /router/resume).'); process.exit(2); }

    const baseMetrics = await api('GET', '/router/metrics');
    const baseFills = Number(baseMetrics?.totalFills ?? 0);

    const wif = ENV.RELAYER_PRIVATE_KEY_WIF
        || JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', ENV.WALLET_PATH), 'utf8')).wif;
    const wallet: any = await TestNetWallet.fromWIF(wif);
    const sig = new SignatureTemplate(wif);
    const selfPkh: Uint8Array = wallet.publicKeyHash;
    const cashaddr = wallet.cashaddr as string;

    const sup = new ElectrumSupervisor('chipnet');
    await sup.start();
    const provider = sup.provider;

    // ── Step 1: ensure enough funding UTXOs for concurrent fills ────────────
    console.log(`\n── Step 1 — ensure ≥${ORDERS} funding UTXOs of ${FUND_UTXO} sats ──`);
    let plain = (await provider.getUtxos(cashaddr)).filter((u: any) => !u.token);
    const usable = plain.filter((u: any) => BigInt(u.satoshis) >= BUY_SATS + 3000n && BigInt(u.satoshis) <= FUND_UTXO * 3n);
    console.log(`  plain BCH utxos=${plain.length}, already-usable for a fill=${usable.length}`);

    if (usable.length < ORDERS) {
        const need = ORDERS - usable.length + 2;
        const src: any = plain.sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)))[0];
        const total = FUND_UTXO * BigInt(need) + 5000n;
        if (BigInt(src.satoshis) < total) throw new Error(`Largest UTXO ${src.satoshis} < ${total} needed to split`);
        const tb = new TransactionBuilder({ provider });
        tb.addInput({ txid: src.txid, vout: src.vout, satoshis: BigInt(src.satoshis) }, sig.unlockP2PKH());
        for (let i = 0; i < need; i++) tb.addOutput({ to: p2pkh(selfPkh), amount: FUND_UTXO });
        tb.addOutput({ to: p2pkh(selfPkh), amount: BigInt(src.satoshis) - FUND_UTXO * BigInt(need) - 5000n });
        const r = await tb.send();
        console.log(`  split tx (${need} new UTXOs): ${txUrl(r.txid)}`);
        await sleep(6000);
    } else {
        console.log('  sufficient funding UTXOs already — skipping split');
    }

    // ── Step 2: create N intents through the live API ───────────────────────
    console.log(`\n── Step 2 — POST /intent/create × ${ORDERS} ──`);
    const tracked: Tracked[] = [];
    for (let i = 0; i < ORDERS; i++) {
        const type: 'limit' | 'dutch' = i % 2 === 0 ? 'limit' : 'dutch';
        const created = await api('POST', '/intent/create', {
            makerAddress: cashaddr,
            sellToken: 'BCH',
            buyToken: 'BCH',
            sellAmount: SELL_SATS.toString(),
            buyAmount: BUY_SATS.toString(),
            orderType: type,
            duration: 3600,
            expiryTime: Math.floor(Date.now() / 1000) + 3600,
            network: 'chipnet',
        });
        tracked.push({
            intentId: created.intentId, address: created.contractAddress,
            type, tCreate: nowMs(), status: 'created',
        });
    }
    console.log(`  created ${tracked.length} intents (${tracked.filter(t => t.type === 'limit').length} limit / ${tracked.filter(t => t.type === 'dutch').length} dutch)`);

    // ── Step 3: fund every covenant in ONE transaction ──────────────────────
    console.log(`\n── Step 3 — fund all ${ORDERS} covenants in one tx ──`);
    plain = (await provider.getUtxos(cashaddr)).filter((u: any) => !u.token);
    // Deliberately spend the LARGEST coin so the split's small UTXOs stay free
    // for the solver to use as per-fill funding inputs.
    const fundSrc: any = plain.sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)))[0];
    const fundNeed = SELL_SATS * BigInt(ORDERS) + 5000n;
    if (BigInt(fundSrc.satoshis) < fundNeed) throw new Error(`Funding UTXO ${fundSrc.satoshis} < ${fundNeed}`);

    const fundTb = new TransactionBuilder({ provider });
    fundTb.addInput({ txid: fundSrc.txid, vout: fundSrc.vout, satoshis: BigInt(fundSrc.satoshis) }, sig.unlockP2PKH());
    for (const t of tracked) fundTb.addOutput({ to: lb(t.address), amount: SELL_SATS });
    fundTb.addOutput({ to: p2pkh(selfPkh), amount: BigInt(fundSrc.satoshis) - SELL_SATS * BigInt(ORDERS) - 5000n });
    const fundRes = await fundTb.send();
    const tFunded = nowMs();
    for (const t of tracked) { t.tFunded = tFunded; t.status = 'funded'; }
    console.log(`  funding tx: ${txUrl(fundRes.txid)}`);
    console.log(`  ⏱  clock starts now — measuring funding → fill for all ${ORDERS} orders`);

    // ── Step 4: watch until settled or deadline ─────────────────────────────
    const byId = new Map(tracked.map(t => [t.intentId, t]));
    const wsEvents: Array<{ t: number; type: string; id?: string }> = [];
    let ws: WebSocket | undefined;
    try {
        ws = new WebSocket(RELAYER.replace(/^http/, 'ws') + '/ws');
        ws.onmessage = (evt) => {
            try {
                const m = JSON.parse(String(evt.data));
                const id = m.data?.id ?? m.data?.intentId;
                wsEvents.push({ t: nowMs(), type: m.type, id });
                const t = id ? byId.get(id) : undefined;
                if (t && (m.type === 'intent:filled' || m.type === 'intent:refunded')) {
                    t.tSettled ??= nowMs();
                    t.status = m.data?.status ?? 'filled';
                    t.fillTxid = m.data?.fillTxid;
                    const lat = ((t.tSettled - t.tFunded!) / 1000).toFixed(1);
                    console.log(`  [WS ${((nowMs() - tFunded) / 1000).toFixed(0)}s] ${m.type} ${t.type} ${id?.slice(-6)} — fill latency ${lat}s`);
                }
            } catch { /* ignore */ }
        };
        ws.onerror = () => console.log('  (WS unavailable — falling back to polling only)');
    } catch { /* ignore */ }

    const deadline = tFunded + MINUTES * 60_000;
    let lastReport = 0;
    while (nowMs() < deadline) {
        await sleep(5000);

        for (const t of tracked) {
            if (t.tSettled) continue;
            try {
                const intent = await api('GET', `/intent/${t.intentId}`);
                t.status = intent.status;
                t.skipReason = intent.lastSkipReason;
                t.failReason = intent.failReason;
                if (['filled', 'refunded', 'cancelled', 'abandoned'].includes(intent.status)) {
                    t.tSettled = nowMs();
                    t.fillTxid = intent.fillTxid ?? intent.refundTxid;
                    const lat = ((t.tSettled - t.tFunded!) / 1000).toFixed(1);
                    console.log(`  [poll ${((nowMs() - tFunded) / 1000).toFixed(0)}s] ${t.type} ${t.intentId.slice(-6)} → ${intent.status} (${lat}s)`);
                }
            } catch { /* transient */ }
        }

        const settled = tracked.filter(t => t.tSettled).length;
        const elapsed = (nowMs() - tFunded) / 1000;
        if (elapsed - lastReport >= 30) {
            lastReport = elapsed;
            const h = await api('GET', '/health').catch(() => ({}));
            console.log(`  ── t+${elapsed.toFixed(0)}s: settled ${settled}/${ORDERS}, watching=${h.watching ?? '?'}, active=${h.activeIntents ?? '?'}`);
        }
        if (settled === ORDERS) { console.log(`\n  ✅ all ${ORDERS} orders settled after ${(elapsed).toFixed(1)}s`); break; }
    }
    try { ws?.close(); } catch { /* ignore */ }

    // ── Report ──────────────────────────────────────────────────────────────
    const finalMetrics = await api('GET', '/router/metrics').catch(() => null);
    const finalStatus = await api('GET', '/router/status').catch(() => null);
    const latencies = tracked.filter(t => t.tSettled).map(t => (t.tSettled! - t.tFunded!) / 1000);
    const filled = tracked.filter(t => t.status === 'filled');
    const unsettled = tracked.filter(t => !t.tSettled);
    const totalWindow = (nowMs() - tFunded) / 1000;

    console.log(`\n${'═'.repeat(66)}`);
    console.log('  STRESS TEST REPORT');
    console.log('═'.repeat(66));
    console.log(`  orders submitted      : ${ORDERS} (funded simultaneously in 1 tx)`);
    console.log(`  settled               : ${latencies.length}/${ORDERS}`);
    console.log(`  filled                : ${filled.length}`);
    console.log(`  observation window    : ${totalWindow.toFixed(0)}s`);
    if (latencies.length) {
        console.log(`\n  funding → settle latency`);
        console.log(`    min : ${Math.min(...latencies).toFixed(1)}s`);
        console.log(`    p50 : ${pct(latencies, 0.5).toFixed(1)}s`);
        console.log(`    p90 : ${pct(latencies, 0.9).toFixed(1)}s`);
        console.log(`    max : ${Math.max(...latencies).toFixed(1)}s`);
        console.log(`  throughput          : ${(latencies.length / (totalWindow / 60)).toFixed(1)} fills/min`);
    }
    const byType = (ty: string) => {
        const l = tracked.filter(t => t.type === ty && t.tSettled).map(t => (t.tSettled! - t.tFunded!) / 1000);
        return l.length ? `${l.length} settled, p50 ${pct(l, 0.5).toFixed(1)}s` : 'none settled';
    };
    console.log(`\n  by type:  limit → ${byType('limit')}   dutch → ${byType('dutch')}`);

    if (unsettled.length) {
        console.log(`\n  UNSETTLED (${unsettled.length}):`);
        for (const t of unsettled) {
            console.log(`    ${t.type} ${t.intentId.slice(-6)} status=${t.status}`);
            if (t.skipReason) console.log(`      skip: ${t.skipReason.slice(0, 140)}`);
            if (t.failReason) console.log(`      fail: ${t.failReason.slice(0, 140)}`);
        }
    }

    if (finalMetrics?.ready) {
        const newFills = Number(finalMetrics.totalFills) - baseFills;
        console.log(`\n  ledger: +${newFills} fills this run`);
        console.log(`    predicted total : ${finalMetrics.totalPredictedSats} sats`);
        console.log(`    realized total  : ${finalMetrics.totalRealizedSats} sats`);
        console.log(`    hit rate        : ${(finalMetrics.hitRate * 100).toFixed(0)}%`);
        console.log(`    avg |delta|     : ${finalMetrics.avgDeltaBps} bps`);
    }
    if (finalStatus) {
        console.log(`  router: totalFills=${finalStatus.totalFills} totalProfit=${finalStatus.totalProfitSats} sats`);
        const errs = (finalStatus.recentRoutes ?? []).filter((r: any) => r.error);
        if (errs.length) {
            console.log(`\n  ROUTE ERRORS (${errs.length}):`);
            for (const e of errs.slice(0, 8)) console.log(`    ${e.routeType}: ${e.error}`);
        }
    }
    console.log(`\n  WS events received: ${wsEvents.length}`);
    console.log('═'.repeat(66) + '\n');

    await sup.stop();
    process.exit(unsettled.length === 0 ? 0 : 1);
}

main().catch(e => { console.error('\nSTRESS TEST CRASHED:', e); process.exit(1); });
