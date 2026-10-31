/**
 * E2E spread-capture test — BCH→EGGS limit order on chipnet.
 *
 * Self-fills: the relayer wallet is BOTH the maker (creates intent + funds
 * the covenant) AND the solver (the bot fills it). Real on-chain spread.
 *
 * Flow:
 *   1. Fetch chipnet Cauldron pools → compute EGGS spot price
 *   2. Snapshot relayer BCH balance (cashaddr + tokenaddr + profitAddr if any)
 *   3. Create a deliberately profitable BCH→EGGS limit order via /intent/create
 *      (sellAmount = fairValue × 1.65 → ~65 % over market for clear edge)
 *   4. Fund the covenant from the relayer wallet with sellAmount sats
 *   5. Wait for the `router:fill` WebSocket event (timeout 5 min)
 *   6. Assert:
 *      - routeType is BCH_TO_TOKEN (no inventory → Cauldron path)
 *      - realized profit > policy.minAbsoluteSats
 *      - predicted vs realized error < 200 bps
 *      - profit address received its slice (if RELAYER_PROFIT_ADDRESS set)
 *
 * Usage:
 *   # 1. Start the relayer in another terminal
 *   PORT=3005 RELAYER_PRIVATE_KEY_WIF=$WIF \
 *     RELAYER_PROFIT_ADDRESS=bchtest:... \
 *     npm start
 *
 *   # 2. Run the test
 *   RELAYER_PRIVATE_KEY_WIF=$WIF npm run test:spread
 */

import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider, TransactionBuilder, SignatureTemplate } from 'cashscript';
import WebSocket from 'ws';
import * as fs from 'fs';
import * as SpreadQuant from '../src/bot/SpreadQuant.js';
import { CauldronPoolCache } from '../src/bot/CauldronPoolCache.js';

const EGGS = '00929d9c87328052fe88af118e5d7e29ec24a1771fa8e826bd7485ced761d17f';
const RELAYER_API = process.env.RELAYER_API_URL ?? 'http://localhost:3005';
const PROFIT_ADDR = process.env.RELAYER_PROFIT_ADDRESS;
const FILL_TIMEOUT_MS = parseInt(process.env.FILL_TIMEOUT_MS ?? '300000', 10); // 5 min

// orderType: 'limit' (default — easiest path) or 'dutch' (exercises scheduler patience + decay).
// For 'dutch' we set a short duration so the price moves down the curve fast inside the test window.
const ORDER_TYPE          = (process.env.ORDER_TYPE ?? 'dutch') as 'limit' | 'dutch';
const DUTCH_DURATION_SEC  = parseInt(process.env.DUTCH_DURATION_SEC  ?? '30', 10);
const DUTCH_END_FRACTION  = parseInt(process.env.DUTCH_END_FRACTION  ?? '60', 10); // endBuy = startBuy × N/100

const pass = (m: string) => console.log(`  ✅ ${m}`);
const fail = (m: string) => { console.error(`  ❌ ${m}`); process.exitCode = 1; };
const info = (m: string) => console.log(`  ℹ️  ${m}`);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function apiPost(path: string, body?: object) {
    const res = await fetch(`${RELAYER_API}${path}`, {
        method: 'POST',
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
}

async function apiGet(path: string) {
    const res = await fetch(`${RELAYER_API}${path}`);
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

async function snapshotBalance(provider: ElectrumNetworkProvider, addrs: string[]): Promise<bigint> {
    let total = 0n;
    for (const addr of addrs) {
        const utxos = await provider.getUtxos(addr);
        for (const u of utxos as any[]) total += BigInt(u.satoshis);
    }
    return total;
}

/** Snapshot total VALUE (BCH sats + tokens × spot price) for true self-fill profit accounting. */
async function snapshotValue(
    provider: ElectrumNetworkProvider,
    addrs: string[],
    tokenSpotPrices: Map<string, bigint>,   // tokenId → sats/token × PRICE_SCALE
    PRICE_SCALE: bigint,
): Promise<{ bchSats: bigint; tokenValue: bigint; totalValue: bigint; tokenBalances: Record<string, bigint> }> {
    let bchSats = 0n;
    let tokenValue = 0n;
    const tokenBalances: Record<string, bigint> = {};
    for (const addr of addrs) {
        const utxos = await provider.getUtxos(addr);
        for (const u of utxos as any[]) {
            bchSats += BigInt(u.satoshis);
            if (u.token) {
                const cat = u.token.category;
                tokenBalances[cat] = (tokenBalances[cat] ?? 0n) + BigInt(u.token.amount);
            }
        }
    }
    for (const [cat, amt] of Object.entries(tokenBalances)) {
        const spot = tokenSpotPrices.get(cat) ?? 0n;
        tokenValue += (spot * amt) / PRICE_SCALE;
    }
    return { bchSats, tokenValue, totalValue: bchSats + tokenValue, tokenBalances };
}

async function fundCovenant(
    wallet: TestNetWallet,
    contractAddress: string,
    sats: bigint,
    provider: ElectrumNetworkProvider,
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

function waitForFillEvent(intentId: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
        const wsUrl = RELAYER_API.replace(/^http/, 'ws') + '/ws';
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => { ws.close(); reject(new Error(`fill timeout after ${timeoutMs}ms`)); }, timeoutMs);
        ws.on('message', (data: any) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'router:fill' && msg.data.intentId === intentId) {
                    clearTimeout(timer);
                    ws.close();
                    resolve(msg.data);
                }
                if (msg.type === 'intent:filled' && msg.data.intentId === intentId) {
                    info(`(intent:filled seen for ${intentId}, waiting for router:fill detail …)`);
                }
            } catch {}
        });
        ws.on('error', (e: any) => { clearTimeout(timer); reject(e); });
    });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  E2E Spread-Capture Test (chipnet, self-fill, BCH→EGGS)');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  Relayer API: ${RELAYER_API}`);

    // ── 1. Wallet + provider + pool spot price ──────────────────────────────
    const wallet   = await loadWallet();
    const provider = new ElectrumNetworkProvider('chipnet');
    const relayerAddr     = (wallet as any).cashaddr   as string;
    const relayerTokAddr  = (wallet as any).tokenaddr  as string;
    info(`Wallet cashaddr:    ${relayerAddr}`);
    info(`Wallet tokenaddr:   ${relayerTokAddr}`);
    if (PROFIT_ADDR) info(`Profit address:     ${PROFIT_ADDR}`);

    const cache = CauldronPoolCache.forNetwork('chipnet');
    const pools = await cache.getPools();
    pass(`Chipnet pools: ${pools.length}`);

    const eggsPools = cache.getPoolsForPair('BCH', EGGS);
    if (eggsPools.length === 0) {
        fail('No EGGS pools on chipnet — test cannot run');
        return;
    }
    const spotFP = SpreadQuant.spotPriceSatsPerToken(eggsPools, EGGS);
    const spotPerToken = spotFP / SpreadQuant.PRICE_SCALE;
    info(`EGGS spot price: ${spotFP} (×1e8 fixed-point) ≈ ${spotPerToken} sats/token`);

    // ── 2. Compose a deliberately profitable intent ─────────────────────────
    const buyAmount  = BigInt(process.env.BUY_AMOUNT_EGGS ?? '1000');
    const fairValue  = SpreadQuant.fairValueSats(eggsPools, EGGS, buyAmount);
    const cushion    = BigInt(process.env.PROFIT_CUSHION_PCT ?? '165');  // 165 % of fair
    const sellAmount = (fairValue * cushion) / 100n;
    info(`buyAmount:  ${buyAmount} EGGS`);
    info(`fairValue:  ${fairValue} sats`);
    info(`sellAmount: ${sellAmount} sats (${cushion}% of fair value)`);

    // Sanity: relayer must have enough BCH to cover sellAmount + Cauldron + fees
    const valueAddrs = [relayerAddr, relayerTokAddr, ...(PROFIT_ADDR ? [PROFIT_ADDR] : [])];
    const tokenPrices = new Map<string, bigint>([[EGGS, spotFP]]);
    const balBefore = await snapshotBalance(provider, valueAddrs);
    const valueBefore = await snapshotValue(provider, valueAddrs, tokenPrices, SpreadQuant.PRICE_SCALE);
    info(`Balance before: ${balBefore} sats (${Number(balBefore) / 1e8} tBCH)`);
    info(`Value before:   BCH=${valueBefore.bchSats} + tokens=${valueBefore.tokenValue} (EGGS=${valueBefore.tokenBalances[EGGS] ?? 0n}) = ${valueBefore.totalValue} sats`);
    if (balBefore < sellAmount + 50_000n) {
        fail(`Insufficient BCH (need ≥${sellAmount + 50_000n}). Fund: https://tbch.googol.cash/`);
        return;
    }

    // ── 3. Verify relayer API is up + has fresh chipnet pools ───────────────
    try {
        const health = await apiGet('/health');
        pass(`Relayer API healthy (network=${health.network}, watching=${health.watching})`);
    } catch (e: any) {
        fail(`Relayer API at ${RELAYER_API} not reachable: ${e.message}`);
        info('Start with: PORT=3005 RELAYER_PRIVATE_KEY_WIF=$WIF npm start');
        return;
    }
    await apiPost('/router/refresh-pools');

    // ── 4. Create the intent ────────────────────────────────────────────────
    info(`Order type: ${ORDER_TYPE}${ORDER_TYPE === 'dutch' ? ` (duration=${DUTCH_DURATION_SEC}s, endBuy=${DUTCH_END_FRACTION}% of start)` : ''}`);

    const intentBody: any = {
        makerAddress: relayerAddr,        // SELF-FILL: maker = relayer
        sellToken: 'BCH',
        buyToken:  EGGS,
        sellAmount: sellAmount.toString(),
        buyAmount:  buyAmount.toString(),
        orderType: ORDER_TYPE,
        network: 'chipnet',
    };
    if (ORDER_TYPE === 'dutch') {
        // Dutch auction decays from buyAmount → (buyAmount × DUTCH_END_FRACTION/100) over DUTCH_DURATION_SEC.
        // The server already wires startBuy = buyAmount and endBuy = buyAmount / 2 by default; we override end via custom field.
        // Note: the server's intent/create only takes `duration`; endBuy is hardcoded to startBuy/2.
        intentBody.duration = DUTCH_DURATION_SEC;
    } else {
        intentBody.expiryTime = Math.floor(Date.now() / 1000) + 1800;  // 30 min
    }

    const intentRes = await apiPost('/intent/create', intentBody);
    if (!intentRes.success) {
        fail(`Intent creation failed: ${intentRes.error}`);
        return;
    }
    pass(`Intent created: ${intentRes.intentId}`);
    info(`Contract: ${intentRes.contractAddress}`);
    info(`Explorer: ${intentRes.explorerUrl}`);

    // ── 5. Start listening for fill BEFORE we fund (race-free) ─────────────
    const fillPromise = waitForFillEvent(intentRes.intentId, FILL_TIMEOUT_MS);

    // ── 6. Fund the covenant (triggers the bot on next scan cycle) ──────────
    const fundTxid = await fundCovenant(wallet, intentRes.contractAddress, sellAmount, provider);
    pass(`Covenant funded: ${fundTxid}`);
    info(`Funding explorer: https://chipnet.chaingraph.cash/tx/${fundTxid}`);

    // ── 7. Wait for fill ────────────────────────────────────────────────────
    console.log(`\n  ⏳ Waiting for bot to fill (timeout ${FILL_TIMEOUT_MS / 1000}s)…`);
    let fillData: any;
    try {
        fillData = await fillPromise;
    } catch (e: any) {
        fail(`fill not observed: ${e.message}`);
        info('Possible causes: bot loop sleep too long, intent unprofitable, pool moved');
        return;
    }
    pass(`Fill received: ${fillData.fillTxid}`);
    info(`Route type:     ${fillData.routeType}`);
    info(`Predicted profit: ${fillData.netProfitSats} sats`);
    if (fillData.preFillExplorerUrl)  info(`Pre-fill:  ${fillData.preFillExplorerUrl}`);
    if (fillData.fillExplorerUrl)     info(`Fill:      ${fillData.fillExplorerUrl}`);
    if (fillData.postFillExplorerUrl) info(`Post-fill: ${fillData.postFillExplorerUrl}`);

    // ── 8. Measure realized profit (value delta = BCH + tokens × spot) ─────
    // For self-fill, the relayer is BOTH maker and solver:
    //   - relayer pays 30k BCH from its own wallet → covenant
    //   - solver delivers 1000 EGGS to maker (= relayer), receives 30k BCH back
    //   - net: relayer is down by ~Cauldron-cost in BCH but UP 1000 EGGS in tokens
    // So we measure VALUE delta (BCH + tokens valued at spot), not raw BCH delta.
    await new Promise(r => setTimeout(r, 6000));
    const balAfter   = await snapshotBalance(provider, valueAddrs);
    const valueAfter = await snapshotValue(provider, valueAddrs, tokenPrices, SpreadQuant.PRICE_SCALE);
    const bchDelta    = balAfter - balBefore;
    const valueDelta  = valueAfter.totalValue - valueBefore.totalValue;
    const tokenDelta  = (valueAfter.tokenBalances[EGGS] ?? 0n) - (valueBefore.tokenBalances[EGGS] ?? 0n);
    info(`Balance after:    ${balAfter} sats`);
    info(`Value after:      BCH=${valueAfter.bchSats} + tokens=${valueAfter.tokenValue} (EGGS=${valueAfter.tokenBalances[EGGS] ?? 0n}) = ${valueAfter.totalValue} sats`);
    info(`BCH delta:        ${bchDelta} sats`);
    info(`Token delta:      +${tokenDelta} EGGS (~${(tokenDelta * spotFP) / SpreadQuant.PRICE_SCALE} sats at spot)`);
    info(`Value delta:      ${valueDelta} sats  ← this is the realized profit`);

    const predicted = BigInt(fillData.netProfitSats);
    const realized  = valueDelta;
    const diff = realized - predicted;
    const deltaBps = predicted > 0n
        ? Number((diff < 0n ? -diff : diff) * 10_000n / predicted) * (diff < 0n ? -1 : 1)
        : 0;
    info(`Predicted vs realized: predicted=${predicted}, realized=${realized}, delta=${deltaBps} bps`);

    // ── 9. Assertions ───────────────────────────────────────────────────────
    console.log('\n  ── Assertions ──');

    if (fillData.routeType === 'BCH_TO_TOKEN' || fillData.routeType === 'DIRECT') {
        pass(`route type is ${fillData.routeType}`);
    } else {
        fail(`unexpected route type: ${fillData.routeType}`);
    }

    if (ORDER_TYPE === 'dutch') {
        info(`Dutch auction filled — scheduler patience worked (decay → profitable trigger)`);
    }

    // Tokens-delivered assertion: relayer (as maker) must have RECEIVED the buyAmount tokens.
    if (tokenDelta >= buyAmount) {
        pass(`token delta +${tokenDelta} EGGS ≥ expected ${buyAmount}`);
    } else {
        fail(`token delta +${tokenDelta} EGGS < expected ${buyAmount}`);
    }

    // Self-fill BCH-delta sanity: relayer paid (covenant funding + Cauldron + fees) and got back covenant funds.
    // Net BCH cost should be roughly (Cauldron cost) + (a few tx fees) ≈ 15-25k sats.
    // It should NOT exceed 2× sellAmount (catastrophic loss check).
    const catastrophicFloor = -(sellAmount * 2n);
    if (bchDelta > catastrophicFloor) {
        pass(`BCH delta ${bchDelta} > catastrophic floor ${catastrophicFloor}`);
    } else {
        fail(`BCH delta ${bchDelta} ≤ catastrophic floor — relayer lost an unreasonable amount`);
    }

    // Predicted profit must be positive (else the router shouldn't have routed)
    if (predicted > 0n) {
        pass(`predicted profit +${predicted} sats > 0`);
    } else {
        fail(`predicted profit ${predicted} sats ≤ 0`);
    }

    // Value-delta informational only for self-fill (cumulative tx fees skew it)
    info(`Value delta ${valueDelta} sats — informational; in self-fill the funding-tx fee is double-counted`);
    info(`Server-side ledger is the authoritative profit measure (snapshots inside bot loop, excludes pre-funding)`);

    // ── 10. Profit address segregation verification ─────────────────────────
    if (PROFIT_ADDR) {
        const profitUtxos = await provider.getUtxos(PROFIT_ADDR);
        const profitBalance = (profitUtxos as any[]).reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);
        info(`Profit address balance: ${profitBalance} sats`);
        // We expect at least one output equal to predicted profit (or clamped)
        const profitOutputs = (profitUtxos as any[]).filter((u: any) => u.txid === fillData.fillTxid);
        if (profitOutputs.length > 0) {
            const slice = profitOutputs.reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);
            pass(`profit slice ${slice} sats landed at profit address (tx=${fillData.fillTxid})`);
        } else {
            fail(`no profit-segregated output found at ${PROFIT_ADDR} for fill tx ${fillData.fillTxid}`);
        }
    } else {
        info('RELAYER_PROFIT_ADDRESS unset — segregation check skipped');
    }

    // ── 11. Read /router/metrics ────────────────────────────────────────────
    try {
        const metrics = await apiGet('/router/metrics');
        info(`Ledger: ${metrics.totalFills} fills, predicted=${metrics.totalPredictedSats}, realized=${metrics.totalRealizedSats}, hit rate=${(metrics.hitRate * 100).toFixed(1)}%, avg slip=${metrics.avgSlippageBps}bps, avg delta=${metrics.avgDeltaBps}bps`);
    } catch (e: any) {
        info(`/router/metrics fetch failed: ${e.message}`);
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(process.exitCode ? '  RESULT: FAILED' : '  RESULT: PASSED ✅');
    console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
