/**
 * E2E — multiple swap directions, one script.
 *
 * Submits a sequence of self-fill intents through the live cashtoken-relayer
 * on chipnet and reports per-direction results in a summary table.
 *
 * Directions exercised:
 *   1. BCH → EGGS (Dutch 60s)           — exercises Cauldron BCH_TO_TOKEN
 *   2. BCH → EGGS (Limit, larger size)  — exercises Cauldron OR DIRECT depending on inventory
 *   3. BCH → PUSD (Dutch 60s)           — second token pair, separate Cauldron pool
 *   4. EGGS → BCH (Limit)               — exercises Cauldron TOKEN_TO_BCH post-fill rebalance
 *
 * Each test:
 *   - computes spot from live chipnet pools
 *   - chooses a size that should fill (≥ 0.015 BCH equivalent)
 *   - applies a 1 % solver edge so the bot's PROFIT_MIN_BPS=30 floor is cleared
 *   - creates the intent via POST /intent/create
 *   - funds the covenant (BCH or token as appropriate)
 *   - opens a WebSocket and waits for router:fill matching the intentId
 *   - records route type, predicted/realized profit, fill txid, latency
 *
 * Final summary prints a compact table.
 *
 * Usage:
 *   RELAYER_API_URL=http://localhost:3006 \
 *   RELAYER_PRIVATE_KEY_WIF=cT… \
 *   npx tsx test/e2e_multi_direction.ts
 */

import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider, TransactionBuilder, SignatureTemplate } from 'cashscript';
import WebSocket from 'ws';
import * as fs from 'fs';
import * as SpreadQuant from '../src/bot/SpreadQuant.js';
import { CauldronPoolCache } from '../src/bot/CauldronPoolCache.js';

const EGGS = '00929d9c87328052fe88af118e5d7e29ec24a1771fa8e826bd7485ced761d17f';
const PUSD = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';

const RELAYER_API = process.env.RELAYER_API_URL ?? 'http://localhost:3006';
const FILL_TIMEOUT_MS = parseInt(process.env.FILL_TIMEOUT_MS ?? '300000', 10); // 5 min per intent
const SOLVER_EDGE = 0.01; // 1 % cushion the maker grants the solver

// ─── helpers ────────────────────────────────────────────────────────────────

const pass = (m: string) => console.log(`  ✅ ${m}`);
const fail = (m: string) => { console.error(`  ❌ ${m}`); process.exitCode = 1; };
const info = (m: string) => console.log(`  ℹ️  ${m}`);
const banner = (m: string) => console.log(`\n${'═'.repeat(72)}\n  ${m}\n${'═'.repeat(72)}`);

async function apiPost(path: string, body?: object): Promise<any> {
    const res = await fetch(`${RELAYER_API}${path}`, {
        method: 'POST',
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
}

async function loadWallet(): Promise<TestNetWallet> {
    if (process.env.RELAYER_PRIVATE_KEY_WIF) {
        return TestNetWallet.fromWIF(process.env.RELAYER_PRIVATE_KEY_WIF);
    }
    const walletPath = process.env.WALLET_PATH ?? '../contracts-bch-swap/wallet.json';
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    return TestNetWallet.fromWIF(walletData.wif);
}

async function fundCovenantBCH(
    wallet: TestNetWallet, contractAddress: string, sats: bigint, provider: ElectrumNetworkProvider,
): Promise<string> {
    const fromAddr = (wallet as any).cashaddr as string;
    const utxos = await provider.getUtxos(fromAddr);
    const bch = (utxos as any[]).filter(u => !u.token).sort((a, b) =>
        Number(BigInt(b.satoshis) - BigInt(a.satoshis))
    );
    const u = bch.find(u => BigInt(u.satoshis) >= sats + 1500n);
    if (!u) throw new Error(`No BCH UTXO ≥ ${sats + 1500n} sats`);
    const wif = (wallet as any).privateKeyWif as string;
    const sig = new SignatureTemplate(wif);
    const tb = new TransactionBuilder({ provider });
    tb.addInput({ txid: u.txid, vout: u.vout, satoshis: BigInt(u.satoshis) }, sig.unlockP2PKH());
    tb.addOutput({ to: contractAddress, amount: sats });
    const change = BigInt(u.satoshis) - sats - 1000n;
    if (change > 546n) tb.addOutput({ to: fromAddr, amount: change });
    const result = await tb.send();
    return result.txid;
}

async function fundCovenantToken(
    wallet: TestNetWallet, tokenAddress: string, tokenCategory: string, tokenAmount: bigint,
    provider: ElectrumNetworkProvider,
): Promise<string> {
    const fromAddr = (wallet as any).cashaddr as string;
    const fromTok  = (wallet as any).tokenaddr as string;
    const utxos = [...await provider.getUtxos(fromAddr), ...await provider.getUtxos(fromTok)];
    // Dedup by txid:vout
    const seen = new Set<string>();
    const uniq = utxos.filter((u: any) => {
        const k = `${u.txid}:${u.vout}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });

    const allTokenUtxos = uniq.filter((u: any) => u.token?.category === tokenCategory);
    const bchUtxos      = uniq.filter((u: any) => !u.token);
    const totalAvail = allTokenUtxos.reduce((s, u: any) => s + BigInt(u.token!.amount), 0n);
    if (totalAvail < tokenAmount) {
        throw new Error(`Insufficient ${tokenCategory.slice(0,8)}…: have ${totalAvail}, need ${tokenAmount}`);
    }

    // Greedy: take largest-first until we cover tokenAmount. Keeps tx small.
    const sortedTokens = [...allTokenUtxos].sort((a: any, b: any) =>
        Number(BigInt(b.token!.amount) - BigInt(a.token!.amount))
    );
    const usedTokenUtxos: any[] = [];
    let usedTokenSum = 0n;
    for (const u of sortedTokens) {
        usedTokenUtxos.push(u);
        usedTokenSum += BigInt(u.token!.amount);
        if (usedTokenSum >= tokenAmount) break;
    }

    const wif = (wallet as any).privateKeyWif as string;
    const sig = new SignatureTemplate(wif);
    const tb = new TransactionBuilder({ provider });

    for (const u of usedTokenUtxos) {
        tb.addInput({
            txid: u.txid, vout: u.vout, satoshis: BigInt(u.satoshis),
            token: { amount: BigInt(u.token!.amount), category: tokenCategory },
        }, sig.unlockP2PKH());
    }
    const totalTokens   = usedTokenSum;
    const tokenSatsIn   = usedTokenUtxos.reduce((s, u: any) => s + BigInt(u.satoshis), 0n);

    // Add BCH inputs if we need more sats for fee + dust outputs.
    // Token tx with N inputs is ~150n + 300 bytes; min-relay is ~1 sat/byte.
    // Use 3000 sats — safely covers up to 18 token-bearing inputs with margin.
    const TOKEN_FUND_FEE = 3000n;
    const needSats = 1000n + 1000n + TOKEN_FUND_FEE;  // contract dust + change dust + fee
    let bchIn = 0n;
    if (tokenSatsIn < needSats) {
        const sortedBch = [...bchUtxos].sort((a, b: any) => Number(BigInt(a.satoshis) - BigInt(b.satoshis)));
        for (const u of sortedBch) {
            tb.addInput({ txid: (u as any).txid, vout: (u as any).vout, satoshis: BigInt((u as any).satoshis) }, sig.unlockP2PKH());
            bchIn += BigInt((u as any).satoshis);
            if (tokenSatsIn + bchIn >= needSats) break;
        }
    }

    // Output 0: tokens to contract's TOKEN address with dust BCH
    tb.addOutput({
        to: tokenAddress,
        amount: 1000n,
        token: { amount: tokenAmount, category: tokenCategory },
    });

    // Output 1: token change + leftover BCH back to our token address
    const tokenChange = totalTokens - tokenAmount;
    const totalSatsIn = tokenSatsIn + bchIn;
    const fee = TOKEN_FUND_FEE;
    const remaining = totalSatsIn - 1000n - fee;
    if (tokenChange > 0n) {
        const changeSats = remaining > 1000n ? 1000n : remaining;
        tb.addOutput({
            to: fromTok,
            amount: changeSats,
            token: { amount: tokenChange, category: tokenCategory },
        });
        const satChange = remaining - changeSats;
        if (satChange > 546n) tb.addOutput({ to: fromAddr, amount: satChange });
    } else if (remaining > 546n) {
        tb.addOutput({ to: fromAddr, amount: remaining });
    }

    const result = await tb.send();
    return result.txid;
}

interface FillEvent {
    intentId: string;
    routeType: string;
    netProfitSats: string;
    preFillTxid?: string;
    fillTxid?: string;
    postFillTxid?: string;
    preFillExplorerUrl?: string;
    fillExplorerUrl?: string;
    postFillExplorerUrl?: string;
}

function waitForFillEvent(intentId: string, timeoutMs: number): Promise<FillEvent> {
    return new Promise((resolve, reject) => {
        const wsUrl = RELAYER_API.replace(/^http/, 'ws') + '/ws';
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => { ws.close(); reject(new Error(`timeout after ${timeoutMs/1000}s`)); }, timeoutMs);
        ws.on('message', (data: any) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'router:fill' && msg.data.intentId === intentId) {
                    clearTimeout(timer);
                    ws.close();
                    resolve(msg.data);
                }
            } catch {}
        });
        ws.on('error', (e: any) => { clearTimeout(timer); reject(e); });
    });
}

// ─── per-test runner ────────────────────────────────────────────────────────

interface SwapTestSpec {
    name: string;
    sellToken: 'BCH' | string;     // category hex or 'BCH'
    buyToken:  'BCH' | string;
    sellAmount: bigint;            // base units (sats for BCH, token units for tokens)
    buyAmount:  bigint;
    orderType:  'limit' | 'dutch';
    durationSec?: number;          // dutch only
    expirySec?:  number;           // limit only — seconds from now
}

interface SwapTestResult {
    name: string;
    intentId?:    string;
    fillTxid?:    string;
    routeType?:   string;
    predictedSats?: string;
    elapsedMs?:   number;
    status: 'PASSED' | 'TIMEOUT' | 'CREATE_FAILED' | 'FUND_FAILED';
    note?:        string;
}

async function runSwap(
    spec: SwapTestSpec, wallet: TestNetWallet, provider: ElectrumNetworkProvider,
): Promise<SwapTestResult> {
    const relayerAddr = (wallet as any).cashaddr as string;
    const result: SwapTestResult = { name: spec.name, status: 'PASSED' };
    const t0 = Date.now();
    banner(`TEST ▸ ${spec.name}`);

    info(`sellToken: ${spec.sellToken === 'BCH' ? 'BCH' : spec.sellToken.slice(0,8) + '…'} sellAmount: ${spec.sellAmount}`);
    info(`buyToken:  ${spec.buyToken === 'BCH'  ? 'BCH' : spec.buyToken.slice(0,8) + '…'} buyAmount:  ${spec.buyAmount}`);
    info(`orderType: ${spec.orderType}${spec.orderType === 'dutch' ? ` (duration=${spec.durationSec}s)` : ''}`);

    // 1. Create intent
    const body: any = {
        makerAddress: relayerAddr,           // SELF-FILL: maker = relayer
        sellToken: spec.sellToken,
        buyToken:  spec.buyToken,
        sellAmount: spec.sellAmount.toString(),
        buyAmount:  spec.buyAmount.toString(),
        orderType:  spec.orderType,
        network:    'chipnet',
    };
    if (spec.orderType === 'dutch') body.duration = spec.durationSec ?? 60;
    else body.expiryTime = Math.floor(Date.now() / 1000) + (spec.expirySec ?? 1800);

    let intentRes: any;
    try {
        intentRes = await apiPost('/intent/create', body);
    } catch (e: any) {
        result.status = 'CREATE_FAILED'; result.note = e.message; fail(`create failed: ${e.message}`); return result;
    }
    if (!intentRes.success) {
        result.status = 'CREATE_FAILED'; result.note = intentRes.error;
        fail(`intent create error: ${intentRes.error}`); return result;
    }
    result.intentId = intentRes.intentId;
    pass(`intent: ${intentRes.intentId}`);

    // 2. Subscribe to fill BEFORE funding
    const fillPromise = waitForFillEvent(intentRes.intentId, FILL_TIMEOUT_MS);

    // 3. Fund
    try {
        let fundTxid: string;
        if (spec.sellToken === 'BCH') {
            fundTxid = await fundCovenantBCH(wallet, intentRes.contractAddress, spec.sellAmount, provider);
        } else {
            fundTxid = await fundCovenantToken(
                wallet, intentRes.tokenAddress, spec.sellToken, spec.sellAmount, provider
            );
        }
        pass(`covenant funded: ${fundTxid}`);
    } catch (e: any) {
        result.status = 'FUND_FAILED'; result.note = e.message;
        fail(`funding failed: ${e.message}`);
        return result;
    }

    // 4. Wait for fill
    info(`waiting for fill (timeout ${FILL_TIMEOUT_MS/1000}s)…`);
    try {
        const fillData = await fillPromise;
        result.fillTxid    = fillData.fillTxid;
        result.routeType   = fillData.routeType;
        result.predictedSats = fillData.netProfitSats;
        result.elapsedMs   = Date.now() - t0;
        pass(`FILLED: route=${fillData.routeType} predicted=+${fillData.netProfitSats} sats fill=${fillData.fillTxid?.slice(0,12)}…`);
    } catch (e: any) {
        result.status = 'TIMEOUT'; result.note = e.message;
        result.elapsedMs = Date.now() - t0;
        fail(`fill timeout: ${e.message}`);
    }
    return result;
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
    banner('Multi-direction swap test on chipnet');
    info(`Relayer API: ${RELAYER_API}`);

    const wallet   = await loadWallet();
    const provider = new ElectrumNetworkProvider('chipnet');
    info(`Wallet: ${(wallet as any).cashaddr}`);

    // Pre-load pools so we can compute realistic sizes
    const cache = CauldronPoolCache.forNetwork('chipnet');
    const pools = await cache.getPools();
    info(`Chipnet pools loaded: ${pools.length}`);

    const eggsSpot = SpreadQuant.spotPriceSatsPerToken(pools, EGGS);
    const pusdSpot = SpreadQuant.spotPriceSatsPerToken(pools, PUSD);
    const eggsPerSat = Number(eggsSpot) / 1e8;
    const pusdPerSat = Number(pusdSpot) / 1e8;
    info(`EGGS spot: ${eggsPerSat.toFixed(2)} sats/EGG  •  PUSD spot: ${pusdPerSat.toFixed(2)} sats/PUSD`);

    // Wallet balance gate
    const utxos = await provider.getUtxos((wallet as any).cashaddr);
    const bal = utxos.reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);
    info(`Wallet BCH balance: ${bal} sats (${Number(bal) / 1e8} tBCH)`);
    if (bal < 5_000_000n) {
        fail(`Wallet has < 0.05 tBCH; need more to fund 4 covenants. Aborting.`);
        return;
    }

    // ── Build test specs ───────────────────────────────────────────────────
    // Sizes chosen to clear PROFIT_MIN_SATS=1500 + PROFIT_MIN_BPS=30 with margin
    const eggsAmountSmall  = 1_000n;                  // tokens
    const eggsAmountMedium = 3_000n;
    const pusdAmount       = 100n;                    // PUSD units
    const eggsSellAmt      = 3_000n;                  // tokens we sell in the EGGS→BCH test (3000 → ~56k sat trade so fees are < 6% of trade)

    // BCH side derived from spot × cushion (1 + edge bumps maker's offer so solver clears policy)
    const eggsBchSmall  = BigInt(Math.floor((Number(eggsSpot) * Number(eggsAmountSmall)  / 1e8) * (1 + SOLVER_EDGE) * 1.1)); // +10% extra cushion on small sizes
    const eggsBchMedium = BigInt(Math.floor((Number(eggsSpot) * Number(eggsAmountMedium) / 1e8) * (1 + SOLVER_EDGE) * 1.1));
    const pusdBch       = BigInt(Math.floor((Number(pusdSpot) * Number(pusdAmount)       / 1e8) * (1 + SOLVER_EDGE) * 1.1));
    // For Token→BCH: maker accepts much less BCH than market so solver can cover Cauldron fees + tx fees + edge.
    // ~10% Cauldron + tx overhead on a 50k-sat trade, + 1% solver edge → use 0.85× spot.
    const eggsToBchPrice = BigInt(Math.floor((Number(eggsSpot) * Number(eggsSellAmt) / 1e8) * 0.85));

    const specs: SwapTestSpec[] = [
        {
            name:        '1. BCH → EGGS (Dutch 60s, ~30k sats)',
            sellToken:   'BCH', buyToken:   EGGS,
            sellAmount:  eggsBchSmall, buyAmount: eggsAmountSmall,
            orderType:   'dutch', durationSec: 60,
        },
        {
            name:        '2. BCH → EGGS (Limit, ~90k sats)',
            sellToken:   'BCH', buyToken:   EGGS,
            sellAmount:  eggsBchMedium, buyAmount: eggsAmountMedium,
            orderType:   'limit', expirySec: 600,
        },
        {
            name:        '3. BCH → PUSD (Dutch 60s)',
            sellToken:   'BCH', buyToken:   PUSD,
            sellAmount:  pusdBch, buyAmount: pusdAmount,
            orderType:   'dutch', durationSec: 60,
        },
        {
            name:        '4. EGGS → BCH (Limit, 1000 EGGS)',
            sellToken:   EGGS, buyToken:   'BCH',
            sellAmount:  eggsSellAmt, buyAmount: eggsToBchPrice,
            orderType:   'limit', expirySec: 600,
        },
    ];

    // Optional: run a single test by 1-based index (e.g., ONLY_TEST=4 to rerun the token-side test)
    const onlyTest = process.env.ONLY_TEST ? parseInt(process.env.ONLY_TEST, 10) : 0;
    const subset = onlyTest > 0 ? [specs[onlyTest - 1]] : specs;

    // Run sequentially so the bot's spent-set tracker isn't stressed across simultaneous fills
    const results: SwapTestResult[] = [];
    for (const spec of subset) {
        const r = await runSwap(spec, wallet, provider);
        results.push(r);
        // Brief breath between intents so Electrum + bot loop catch up
        await new Promise(r => setTimeout(r, 4000));
    }

    // ── Summary table ──────────────────────────────────────────────────────
    banner('SUMMARY');
    const cols = [22, 8, 14, 14, 8, 16];
    const row = (a: string, b: string, c: string, d: string, e: string, f: string) =>
        console.log(`  ${a.padEnd(cols[0])} ${b.padEnd(cols[1])} ${c.padEnd(cols[2])} ${d.padEnd(cols[3])} ${e.padEnd(cols[4])} ${f.padEnd(cols[5])}`);
    row('Test', 'Status', 'Route', 'Predicted', 'Elapsed', 'Fill txid');
    row('-'.repeat(cols[0]), '-'.repeat(cols[1]), '-'.repeat(cols[2]), '-'.repeat(cols[3]), '-'.repeat(cols[4]), '-'.repeat(cols[5]));
    for (const r of results) {
        row(
            r.name.slice(0, cols[0]),
            r.status,
            r.routeType ?? '-',
            r.predictedSats ? `+${r.predictedSats}` : '-',
            r.elapsedMs ? `${(r.elapsedMs/1000).toFixed(0)}s` : '-',
            r.fillTxid ? `${r.fillTxid.slice(0, 12)}…` : '-'
        );
    }
    console.log();

    const passed = results.filter(r => r.status === 'PASSED').length;
    const total  = results.length;
    banner(`${passed}/${total} swaps filled`);

    if (passed === total) {
        console.log('  ✅ All directions exercised successfully.');
    } else {
        console.log('  ⚠️  Some swaps did not fill. Check relayer logs for skip reasons.');
        for (const r of results.filter(r => r.status !== 'PASSED')) {
            console.log(`     - ${r.name}: ${r.status} (${r.note ?? '?'})`);
        }
    }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
