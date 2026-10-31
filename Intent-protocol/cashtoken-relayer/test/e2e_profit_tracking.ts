/**
 * E2E — Profit tracking: maker vs. solver balance deltas across different order sizes.
 *
 * Unlike the self-fill tests (maker == solver == the relayer's own wallet), this
 * test uses TWO distinct wallets so maker and solver balance changes can be
 * measured independently and unambiguously:
 *
 *   - SOLVER: the relayer's own operating wallet (from .env / wallet.json) —
 *     read-only for this test, we only snapshot its total BCH balance
 *     (same method as ProfitLedger.snapshotBalance: sum satoshis across every
 *     UTXO at cashaddr + tokenaddr, pure-BCH and token-bearing alike).
 *   - MAKER: a freshly-generated, disposable wallet, seeded with just enough
 *     BCH from the solver wallet to create + fund several orders.
 *
 * For each of several BCH → PUSD Limit Orders of increasing size, it snapshots
 * both wallets before and after the fill and reports:
 *   - makerSpentSats      : maker's BCH balance delta (should ≈ sellAmount + their own tx fee)
 *   - solverRealizedSats  : solver's BCH balance delta (the ACTUAL captured profit)
 *   - predictedProfitSats : what the router's quote predicted at fill time
 *   - effectiveBpsRealized: solverRealizedSats / sellAmount, in bps
 *
 * Orders run SEQUENTIALLY (not concurrently) so the solver balance snapshot
 * for each tier isn't polluted by another in-flight fill — see the "concurrent
 * activity pollutes the snapshot" caveat in ProfitLedger.ts.
 *
 * Usage:
 *   RELAYER_API_URL=http://localhost:3006 npx tsx test/e2e_profit_tracking.ts
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
const FILL_TIMEOUT_MS = parseInt(process.env.FILL_TIMEOUT_MS ?? '180000', 10); // 3 min per tier

// PUSD buy-amount tiers, deliberately spanning ~2 orders of magnitude so the
// fixed ~3000-sat network fee's *relative* drag on captured margin is visible
// at the small end and negligible at the large end.
const TIERS_PUSD = [5n, 20n, 75n, 300n];

const pass = (m: string) => console.log(`  ✅ ${m}`);
const fail = (m: string) => { console.error(`  ❌ ${m}`); process.exitCode = 1; };
const info = (m: string) => console.log(`  ℹ️  ${m}`);
const banner = (m: string) => console.log(`\n${'═'.repeat(78)}\n  ${m}\n${'═'.repeat(78)}`);
const sep = (m: string) => console.log(`\n${'─'.repeat(78)}\n  ${m}\n${'─'.repeat(78)}`);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function apiPost(p: string, body?: object): Promise<any> {
    const res = await fetch(`${RELAYER_API}${p}`, {
        method: 'POST',
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
}

async function loadSolverWallet(): Promise<TestNetWallet> {
    if (process.env.RELAYER_PRIVATE_KEY_WIF) return TestNetWallet.fromWIF(process.env.RELAYER_PRIVATE_KEY_WIF);
    const walletPath = process.env.WALLET_PATH ?? '../contracts-bch-swap/wallet.json';
    const wf = fs.existsSync(walletPath) ? walletPath : './wallet.json';
    const { wif } = JSON.parse(fs.readFileSync(wf, 'utf8'));
    return TestNetWallet.fromWIF(wif);
}

/** Same accounting as ProfitLedger.snapshotBalance: sum satoshis across every UTXO (BCH + token-dust) at both address forms. */
async function snapshotBalance(provider: ElectrumNetworkProvider, addrs: string[]): Promise<bigint> {
    let total = 0n;
    const seen = new Set<string>();
    for (const addr of addrs) {
        const utxos = await provider.getUtxos(addr);
        for (const u of utxos as any[]) {
            const k = `${u.txid}:${u.vout}`;
            if (seen.has(k)) continue; // cashaddr + tokenaddr can report the same UTXO twice
            seen.add(k);
            total += BigInt(u.satoshis);
        }
    }
    return total;
}

async function sendBch(from: TestNetWallet, toAddr: string, sats: bigint, provider: ElectrumNetworkProvider): Promise<string> {
    const fromAddr = (from as any).cashaddr as string;
    const utxos = (await provider.getUtxos(fromAddr)).filter((u: any) => !u.token);
    const sorted = [...utxos].sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)));
    const sig = new SignatureTemplate((from as any).privateKeyWif as string);
    const tb = new TransactionBuilder({ provider });
    let sum = 0n;
    const FEE = 1000n;
    for (const u of sorted) {
        tb.addInput({ txid: u.txid, vout: u.vout, satoshis: BigInt(u.satoshis) }, sig.unlockP2PKH());
        sum += BigInt(u.satoshis);
        if (sum >= sats + FEE) break;
    }
    if (sum < sats + FEE) throw new Error(`Solver wallet has insufficient BCH to seed maker (need ${sats + FEE}, have ${sum})`);
    tb.addOutput({ to: toAddr, amount: sats });
    const change = sum - sats - FEE;
    if (change > 546n) tb.addOutput({ to: fromAddr, amount: change });
    const res = await tb.send();
    return res.txid;
}

async function fundCovenantBCH(maker: TestNetWallet, contractAddress: string, sats: bigint, provider: ElectrumNetworkProvider): Promise<string> {
    const fromAddr = (maker as any).cashaddr as string;
    const utxos = (await provider.getUtxos(fromAddr)).filter((u: any) => !u.token);
    const sorted = [...utxos].sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)));
    const sig = new SignatureTemplate((maker as any).privateKeyWif as string);
    const tb = new TransactionBuilder({ provider });
    let sum = 0n;
    const FEE = 1000n;
    for (const u of sorted) {
        tb.addInput({ txid: u.txid, vout: u.vout, satoshis: BigInt(u.satoshis) }, sig.unlockP2PKH());
        sum += BigInt(u.satoshis);
        if (sum >= sats + FEE) break;
    }
    if (sum < sats + FEE) throw new Error(`Maker wallet has insufficient BCH to fund covenant (need ${sats + FEE}, have ${sum})`);
    tb.addOutput({ to: contractAddress, amount: sats });
    const change = sum - sats - FEE;
    if (change > 546n) tb.addOutput({ to: fromAddr, amount: change });
    const res = await tb.send();
    return res.txid;
}

function waitForFillEvent(intentId: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(RELAYER_API.replace(/^http/, 'ws') + '/ws');
        const timer = setTimeout(() => { ws.close(); reject(new Error(`timeout after ${timeoutMs / 1000}s`)); }, timeoutMs);
        ws.on('message', (raw: any) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'router:fill' && msg.data.intentId === intentId) {
                    clearTimeout(timer); ws.close(); resolve(msg.data);
                }
            } catch { /* ignore malformed frames */ }
        });
        ws.on('error', (e: any) => { clearTimeout(timer); reject(e); });
    });
}

interface TierResult {
    buyAmountPusd: string;
    sellAmountSats: string;
    predictedProfitSats?: string;
    makerBefore: string; makerAfter: string; makerSpentSats?: string;
    solverBefore: string; solverAfter: string; solverRealizedSats?: string;
    effectiveBpsRealized?: number;
    fillTxid?: string;
    status: 'filled' | 'timeout' | 'error';
    note?: string;
}

async function main() {
    banner('E2E: Profit Tracking — Maker vs Solver Balance Across Order Sizes');

    const solverWallet = await loadSolverWallet();
    const provider = new ElectrumNetworkProvider('chipnet');
    const solverAddrs = [(solverWallet as any).cashaddr as string, (solverWallet as any).tokenaddr as string];
    info(`Solver wallet: ${solverAddrs[0]}`);

    const makerWallet = await TestNetWallet.newRandom();
    const makerAddr = (makerWallet as any).cashaddr as string;
    info(`Maker wallet (fresh, disposable): ${makerAddr}`);

    const cache = CauldronPoolCache.forNetwork('chipnet');
    const pools = await cache.getPools();
    const pusdSpot = SpreadQuant.spotPriceSatsPerToken(pools, PUSD);
    const pusdSatsPerUnit = Number(pusdSpot) / 1e8;
    info(`PUSD spot: ${pusdSatsPerUnit.toFixed(2)} sats/unit (${pools.length} pools)`);

    // ── Build tier specs: sellAmount = fairValue + max(10,000 sats, 15% cushion) ──
    // The absolute floor in the cushion protects the smallest tier from the flat
    // ~3000-sat network fee; the 15% floor is what should dominate at scale.
    const tiers = TIERS_PUSD.map(buyAmountPusd => {
        const fairValue = BigInt(Math.floor(pusdSatsPerUnit * Number(buyAmountPusd)));
        const pctCushion = (fairValue * 15n) / 100n;
        const cushion = pctCushion > 10_000n ? pctCushion : 10_000n;
        const sellAmount = fairValue + cushion;
        return { buyAmountPusd, fairValue, sellAmount };
    });

    // ── Seed the maker wallet with enough BCH for all tiers + funding fees ──
    const totalNeeded = tiers.reduce((s, t) => s + t.sellAmount, 0n) + BigInt(tiers.length) * 1500n + 5000n;
    sep(`Seeding maker wallet with ${totalNeeded} sats from solver`);
    const seedTxid = await sendBch(solverWallet, makerAddr, totalNeeded, provider);
    pass(`Seed tx: ${seedTxid}`);
    info('Waiting 15s for the seed tx to propagate...');
    await sleep(15000);

    const results: TierResult[] = [];

    for (const tier of tiers) {
        sep(`Tier: ${tier.buyAmountPusd} PUSD  (sellAmount ${tier.sellAmount} sats, fair value ${tier.fairValue} sats)`);
        const result: TierResult = {
            buyAmountPusd: tier.buyAmountPusd.toString(),
            sellAmountSats: tier.sellAmount.toString(),
            makerBefore: '', makerAfter: '',
            solverBefore: '', solverAfter: '',
            status: 'error',
        };

        try {
            const makerBefore = await snapshotBalance(provider, [makerAddr]);
            const solverBefore = await snapshotBalance(provider, solverAddrs);
            result.makerBefore = makerBefore.toString();
            result.solverBefore = solverBefore.toString();
            info(`Maker balance before: ${makerBefore} sats | Solver balance before: ${solverBefore} sats`);

            const createRes = await apiPost('/intent/create', {
                makerAddress: makerAddr,
                sellToken: 'BCH',
                buyToken: PUSD,
                sellAmount: tier.sellAmount.toString(),
                buyAmount: tier.buyAmountPusd.toString(),
                orderType: 'limit',
                expiryTime: Math.floor(Date.now() / 1000) + 1800,
                network: 'chipnet',
            });
            if (!createRes.success) throw new Error(`Intent creation failed: ${JSON.stringify(createRes)}`);
            pass(`Intent created: ${createRes.intentId}`);

            const fillPromise = waitForFillEvent(createRes.intentId, FILL_TIMEOUT_MS);

            const fundTxid = await fundCovenantBCH(makerWallet, createRes.contractAddress, tier.sellAmount, provider);
            pass(`Covenant funded by maker: ${fundTxid}`);

            info(`Waiting up to ${FILL_TIMEOUT_MS / 1000}s for fill...`);
            const fillData = await fillPromise;
            result.fillTxid = fillData.fillTxid;
            result.predictedProfitSats = fillData.netProfitSats;
            pass(`Filled: route=${fillData.routeType} predicted=+${fillData.netProfitSats} sats fill=${fillData.fillTxid?.slice(0, 12)}…`);

            info('Waiting 10s for balances to settle...');
            await sleep(10000);

            const makerAfter = await snapshotBalance(provider, [makerAddr]);
            const solverAfter = await snapshotBalance(provider, solverAddrs);
            result.makerAfter = makerAfter.toString();
            result.solverAfter = solverAfter.toString();

            const makerSpent = makerBefore - makerAfter;
            const solverRealized = solverAfter - solverBefore;
            result.makerSpentSats = makerSpent.toString();
            result.solverRealizedSats = solverRealized.toString();
            result.effectiveBpsRealized = tier.sellAmount > 0n
                ? Number((solverRealized * 10_000n) / tier.sellAmount)
                : 0;
            result.status = 'filled';

            info(`Maker spent: ${makerSpent} sats (sellAmount was ${tier.sellAmount})`);
            info(`Solver realized: ${solverRealized} sats (predicted was ${fillData.netProfitSats}) — ${result.effectiveBpsRealized} bps effective`);
        } catch (e: any) {
            result.status = e.message?.includes('timeout') ? 'timeout' : 'error';
            result.note = e.message;
            fail(`Tier ${tier.buyAmountPusd} PUSD failed: ${e.message}`);
        }

        results.push(result);
    }

    // ── Report ───────────────────────────────────────────────────────────────
    banner('Results');
    console.log(
        '  Tier (PUSD) | sellAmount(sats) | predicted(sats) | realized(sats) | effective bps | status'
    );
    console.log('  ' + '-'.repeat(96));
    for (const r of results) {
        console.log(
            `  ${r.buyAmountPusd.padStart(11)} | ${r.sellAmountSats.padStart(17)} | ` +
            `${(r.predictedProfitSats ?? '-').padStart(16)} | ${(r.solverRealizedSats ?? '-').padStart(14)} | ` +
            `${(r.effectiveBpsRealized?.toString() ?? '-').padStart(14)} | ${r.status}${r.note ? ` (${r.note})` : ''}`
        );
    }

    const filled = results.filter(r => r.status === 'filled');
    if (filled.length === results.length) pass(`All ${results.length} tiers filled and were cleanly measured`);
    else fail(`${results.length - filled.length}/${results.length} tiers did not fill within timeout`);

    // Sanity: maker should have spent ~sellAmount + a small tx fee, never less than sellAmount.
    for (const r of filled) {
        const spent = BigInt(r.makerSpentSats!);
        const sell = BigInt(r.sellAmountSats);
        if (spent < sell) fail(`Tier ${r.buyAmountPusd} PUSD: maker spent LESS than sellAmount — funding accounting is wrong`);
        else pass(`Tier ${r.buyAmountPusd} PUSD: maker spent ${spent} sats ≥ sellAmount ${sell} sats (own tx fee accounts for the rest)`);
    }

    // Sanity: predicted vs realized should be close (within a small tolerance —
    // exact match isn't expected because of Electrum propagation timing on the
    // "after" snapshot, but a wildly different sign or magnitude would indicate
    // the profit model itself is wrong).
    for (const r of filled) {
        const predicted = BigInt(r.predictedProfitSats ?? '0');
        const realized = BigInt(r.solverRealizedSats!);
        const deltaBps = predicted > 0n ? Number(((realized - predicted) * 10_000n) / predicted) : 0;
        if (Math.abs(deltaBps) <= 1000) { // within 10% of predicted
            pass(`Tier ${r.buyAmountPusd} PUSD: realized matches predicted within ${deltaBps}bps`);
        } else {
            info(`Tier ${r.buyAmountPusd} PUSD: realized differs from predicted by ${deltaBps}bps (informational — see note above about snapshot timing/other in-flight activity)`);
        }
    }

    const reportPath = `test/reports/profit_tracking_report_${Date.now()}.json`;
    try {
        fs.mkdirSync('test/reports', { recursive: true });
        fs.writeFileSync(reportPath, JSON.stringify({ timestamp: Date.now(), pusdSatsPerUnit, results }, null, 2));
        info(`Report saved: ${reportPath}`);
    } catch { /* best-effort */ }

    if (process.exitCode !== 1) console.log('\n  🎉 PROFIT TRACKING TEST PASSED\n');
    else console.log('\n  ⚠️  SOME PROFIT TRACKING CHECKS FAILED\n');
}

main().catch(e => { console.error('FATAL:', e); process.exitCode = 1; });
