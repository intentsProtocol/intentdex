/**
 * Test 5 — Live Fill E2E Test (Chipnet)
 *
 * Creates a REAL limit order intent with small amounts, funds it from a maker
 * wallet, and watches the running relayer bot pick it up, route through
 * Cauldron, swap, and fill.  Reports every transaction with chipnet explorer
 * links and amounts.
 *
 * Prerequisites:
 *   - The relayer bot must be running (`npm start`)
 *   - Both maker and relayer wallets need tBCH on chipnet
 *
 * Usage:
 *   npx tsx test/e2e_live_fill_test5.ts
 *
 * Optional env:
 *   TOKEN_CATEGORY   — override the token to test (default: BACON)
 *   RELAYER_API_URL   — override API (default: http://localhost:3006)
 *   MAKER_WIF         — override maker wallet WIF
 */

import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider } from 'cashscript';
import * as fs from 'fs';

// ── Configuration ────────────────────────────────────────────────────────────

const RELAYER_API = process.env.RELAYER_API_URL ?? 'http://localhost:3006';

// Default token: BACON on chipnet (high liquidity, well tested)
const DEFAULT_TOKEN = '84c7fe833ade565aeee5a46d407c7f2da02902f7e6b6c07826dd8d21efb7b3a7';
const TOKEN_CATEGORY = process.env.TOKEN_CATEGORY ?? DEFAULT_TOKEN;

// ── Amounts — must cover Cauldron fees + policy floor ──
// Cauldron overhead: ~5000 supply + 3000 swap-tx fee + 2000 fill-tx fee = ~10,000 sats
// Policy floor: min 1500 sats profit, 30 bps margin
// 50,000 sats sell → ~300 BACON @ 148 sats/token → profit ≈ 5,000+ sats (well above floor)
const SELL_SATS  = 50_000n;   // maker locks 50,000 sats (~0.0005 tBCH)
const BUY_TOKENS = 300n;      // maker wants 300 token units (priced at ~148 sats/ea on BACON pool)
const EXPIRY_SECONDS = 600;   // 10 minute expiry (more time for bot scan cycles)

const EXPLORER_TX   = 'https://chipnet.chaingraph.cash/tx/';
const EXPLORER_ADDR = 'https://chipnet.chaingraph.cash/address/';

// ── Helpers ──────────────────────────────────────────────────────────────────

function ts() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
function info(msg: string)    { console.log(`  [${ts()}] ℹ️  ${msg}`); }
function pass(msg: string)    { console.log(`  [${ts()}] ✅ ${msg}`); }
function fail(msg: string)    { console.error(`  [${ts()}] ❌ ${msg}`); }
function warn(msg: string)    { console.warn(`  [${ts()}] ⚠️  ${msg}`); }
function section(msg: string) { console.log(`\n${'─'.repeat(60)}\n  ${msg}\n${'─'.repeat(60)}`); }

async function apiGet(path: string) {
    const res = await fetch(`${RELAYER_API}${path}`);
    return res.json();
}

async function apiPost(path: string, body?: object) {
    const res = await fetch(`${RELAYER_API}${path}`, {
        method: 'POST',
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Load wallets ─────────────────────────────────────────────────────────────

async function loadMakerWallet(): Promise<TestNetWallet> {
    if (process.env.MAKER_WIF) {
        return TestNetWallet.fromWIF(process.env.MAKER_WIF);
    }
    // Default: use the maker wallet from contracts-bch-swap
    const walletPath = '../contracts-bch-swap/wallet.json';
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    return TestNetWallet.fromWIF(walletData.wif);
}

// ── Token metadata lookup ────────────────────────────────────────────────────

async function fetchTokenSymbol(category: string): Promise<string> {
    try {
        const res = await fetch('https://indexer-chipnet.riften.net/cauldron/tokens/list_cached');
        if (res.ok) {
            const list: any[] = await res.json();
            const t = list.find(t => t.token_id === category);
            if (t) return t.bcmr?.token?.symbol || t.display_symbol || 'TOKEN';
        }
    } catch {}
    return 'TOKEN';
}

// ── Report object ────────────────────────────────────────────────────────────

interface FillReport {
    tokenSymbol: string;
    tokenCategory: string;
    // Intent creation
    intentId: string;
    contractAddress: string;
    contractExplorerUrl: string;
    sellAmount: string;
    buyAmount: string;
    // Funding
    fundTxid: string;
    fundExplorerUrl: string;
    fundAmountSats: bigint;
    // Fill detection
    routeType: string;
    predictedProfitSats: string;
    // Transactions
    preFillTxid?: string;
    preFillExplorerUrl?: string;
    fillTxid?: string;
    fillExplorerUrl?: string;
    postFillTxid?: string;
    postFillExplorerUrl?: string;
    // Timing
    createdAt: number;
    filledAt?: number;
    durationMs?: number;
}

// ── Main Test ────────────────────────────────────────────────────────────────

async function main() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║     Test 5 — Live Fill E2E (Chipnet, Small Amounts)     ║');
    console.log('╚══════════════════════════════════════════════════════════╝');

    const tokenSymbol = await fetchTokenSymbol(TOKEN_CATEGORY);
    info(`Token: ${tokenSymbol} (${TOKEN_CATEGORY.slice(0, 16)}…)`);
    info(`Sell: ${SELL_SATS} sats → Buy: ${BUY_TOKENS} ${tokenSymbol}`);
    info(`Relayer API: ${RELAYER_API}`);

    const report: Partial<FillReport> = {
        tokenSymbol,
        tokenCategory: TOKEN_CATEGORY,
        sellAmount: SELL_SATS.toString(),
        buyAmount: BUY_TOKENS.toString(),
    };

    // ── Step 0: Verify relayer is running ────────────────────────────────────

    section('Step 0: Verify Relayer Bot');
    try {
        const health = await apiGet('/health');
        if (health.status !== 'ok') throw new Error(`Health: ${JSON.stringify(health)}`);
        pass(`Relayer is running — network=${health.network}, pools=${health.cauldronPools}, active=${health.activeIntents}`);
    } catch (e: any) {
        fail(`Relayer not reachable at ${RELAYER_API} — start with 'npm start' first`);
        fail(e.message);
        process.exit(1);
    }

    // Verify router is not paused
    const status = await apiGet('/router/status');
    if (status.paused) {
        warn('Router is paused — resuming...');
        await apiPost('/router/resume');
        pass('Router resumed');
    } else {
        pass('Router is active');
    }
    info(`Total fills so far: ${status.totalFills}`);
    info(`Total profit so far: ${status.totalProfitSats} sats`);

    // ── Pre-flight: simulate router quote to check if amounts are above policy floor ──
    section('Pre-flight: Router Quote Check');
    try {
        const { CauldronPoolCache } = await import('../src/bot/CauldronPoolCache.js');
        const { CauldronRouter } = await import('../src/bot/CauldronRouter.js');
        const { loadPolicy } = await import('../src/bot/ProfitPolicy.js');

        const policy = loadPolicy();
        const cache = CauldronPoolCache.forNetwork('chipnet');
        const router = new CauldronRouter(cache, policy);
        await cache.refresh();

        const mockSolution: any = {
            currentPrice: BUY_TOKENS,
            params: {
                sellTokenCategory: '0x',
                buyTokenCategory: `0x${TOKEN_CATEGORY}`,
                sellAmount: SELL_SATS,
            },
            isExpired: false,
        };

        const q = await router.quote(mockSolution, []);
        if (q.profitable) {
            pass(`Pre-flight quote: ${q.routeType} | profit=${q.netProfitSats} sats | ${q.reason}`);
        } else {
            fail(`Pre-flight quote REJECTED: ${q.reason}`);
            fail(`Amounts too small — bot will skip this intent. Increase SELL_SATS or reduce BUY_TOKENS.`);
            process.exit(1);
        }
        info(`Policy: min=${policy.minAbsoluteSats} sats / ${policy.minBps} bps, maxSlip=${policy.maxSlippageBps} bps`);
    } catch (e: any) {
        warn(`Pre-flight quote check skipped: ${e.message}`);
    }

    // ── Step 1: Load maker wallet & check balance ────────────────────────────

    section('Step 1: Maker Wallet');
    const maker = await loadMakerWallet();
    const makerAddr = (maker as any).cashaddr as string;
    const makerTokenAddr = (maker as any).tokenaddr as string;
    info(`Maker cashaddr:  ${makerAddr}`);
    info(`Maker tokenaddr: ${makerTokenAddr}`);

    const provider = new ElectrumNetworkProvider('chipnet');
    const makerUtxos1 = await provider.getUtxos(makerAddr);
    const makerUtxos2 = await provider.getUtxos(makerTokenAddr);
    const makerAllUtxos = [...makerUtxos1, ...makerUtxos2];
    const makerBch = makerAllUtxos
        .filter((u: any) => !u.token)
        .reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);

    info(`Maker BCH balance: ${Number(makerBch) / 1e8} tBCH (${makerBch} sats)`);

    const requiredSats = SELL_SATS + 10_000n; // sell amount + fee buffer for funding tx
    if (makerBch < requiredSats) {
        fail(`Maker needs at least ${requiredSats} sats. Current: ${makerBch} sats.`);
        fail(`Fund at: https://tbch.googol.cash/ → ${makerAddr}`);
        process.exit(1);
    }
    pass(`Maker has sufficient tBCH: ${makerBch} sats`);

    // ── Step 2: Create intent via API ────────────────────────────────────────

    section('Step 2: Create Intent via API');
    const expiryTime = Math.floor(Date.now() / 1000) + EXPIRY_SECONDS;
    info(`Creating BCH → ${tokenSymbol} limit intent...`);
    info(`  Maker locks:  ${SELL_SATS} sats`);
    info(`  Maker wants:  ${BUY_TOKENS} ${tokenSymbol}`);
    info(`  Expiry:       ${EXPIRY_SECONDS}s (${new Date(expiryTime * 1000).toISOString()})`);

    const createRes = await apiPost('/intent/create', {
        makerAddress: makerAddr,
        sellToken: 'BCH',
        buyToken: TOKEN_CATEGORY,
        sellAmount: SELL_SATS.toString(),
        buyAmount: BUY_TOKENS.toString(),
        orderType: 'limit',
        expiryTime,
        network: 'chipnet',
    });

    if (!createRes.success) {
        fail(`Intent creation failed: ${createRes.error}`);
        process.exit(1);
    }

    const intentId = createRes.intentId;
    const contractAddr = createRes.contractAddress;
    const tokenAddr = createRes.tokenAddress;

    report.intentId = intentId;
    report.contractAddress = contractAddr;
    report.contractExplorerUrl = `${EXPLORER_ADDR}${contractAddr}`;
    report.createdAt = Date.now();

    pass(`Intent created: ${intentId}`);
    info(`Contract address: ${contractAddr}`);
    info(`Token address:    ${tokenAddr}`);
    info(`Explorer:         ${report.contractExplorerUrl}`);

    // ── Step 3: Fund the contract ────────────────────────────────────────────

    section('Step 3: Fund Contract (send BCH to contract)');
    info(`Sending ${SELL_SATS} sats to contract address...`);

    try {
        const sendResult = await maker.send([{
            cashaddr: contractAddr,
            value: Number(SELL_SATS),
            unit: 'sat',
        }]);

        const fundTxid = (sendResult as any).txId || (sendResult as any).txid;
        if (!fundTxid) {
            // Sometimes mainnet-js returns in a different shape
            info(`Send result: ${JSON.stringify(sendResult)}`);
            fail('Could not extract funding txid from send result');
            process.exit(1);
        }

        report.fundTxid = fundTxid;
        report.fundExplorerUrl = `${EXPLORER_TX}${fundTxid}`;
        report.fundAmountSats = SELL_SATS;

        pass(`Contract funded!`);
        info(`Fund TX:  ${fundTxid}`);
        info(`Explorer: ${report.fundExplorerUrl}`);
        info(`Amount:   ${SELL_SATS} sats`);
    } catch (e: any) {
        fail(`Failed to fund contract: ${e.message}`);
        process.exit(1);
    }

    // ── Step 4: Wait for fill ────────────────────────────────────────────────

    section('Step 4: Waiting for Solver to Fill');
    info('The relayer bot should detect the funded contract and route through Cauldron...');
    info('Polling intent status every 3 seconds (timeout: 180s)...');

    const startWait = Date.now();
    const TIMEOUT = 180_000;
    let filled = false;
    let fillData: any = null;

    while (Date.now() - startWait < TIMEOUT) {
        try {
            const intentStatus = await apiGet(`/intent/${intentId}`);

            if (intentStatus.status === 'filled') {
                filled = true;
                fillData = intentStatus;
                report.filledAt = Date.now();
                report.durationMs = report.filledAt - report.createdAt!;
                break;
            }

            if (intentStatus.status === 'refunded') {
                warn(`Intent was refunded (expired or cancelled)`);
                break;
            }

            // Also check recent routes for any matching fill
            const routeStatus = await apiGet('/router/status');
            const matching = routeStatus.recentRoutes?.find(
                (r: any) => r.intentId === intentId && r.fillTxid
            );
            if (matching) {
                filled = true;
                fillData = { ...matching, status: 'filled' };
                report.filledAt = Date.now();
                report.durationMs = report.filledAt - report.createdAt!;
                break;
            }
        } catch {}

        const elapsed = ((Date.now() - startWait) / 1000).toFixed(0);
        process.stdout.write(`\r  [${ts()}] ⏳ Waiting... (${elapsed}s elapsed)`);
        await sleep(3000);
    }

    console.log(''); // newline after progress

    if (!filled) {
        fail(`Timeout: intent was not filled within ${TIMEOUT / 1000}s`);
        warn('Check the relayer bot logs for details');

        // Check if the contract has UTXOs (was it funded?)
        const contractUtxos = await provider.getUtxos(contractAddr);
        if (contractUtxos.length === 0) {
            warn('Contract has 0 UTXOs — funding TX may not have confirmed yet');
        } else {
            info(`Contract has ${contractUtxos.length} UTXOs — bot should pick it up`);
        }

        printReport(report);
        process.exit(1);
    }

    pass(`Intent FILLED in ${(report.durationMs! / 1000).toFixed(1)}s! 🎉`);

    // ── Step 5: Collect fill details ─────────────────────────────────────────

    section('Step 5: Fill Transaction Details');

    // Get from router status for full tx links
    const finalStatus = await apiGet('/router/status');
    const routeRecord = finalStatus.recentRoutes?.find(
        (r: any) => r.intentId === intentId
    );

    if (routeRecord) {
        report.routeType = routeRecord.routeType;
        report.predictedProfitSats = routeRecord.netProfitSats;

        if (routeRecord.preFillTxid) {
            report.preFillTxid = routeRecord.preFillTxid;
            report.preFillExplorerUrl = routeRecord.preFillExplorerUrl || `${EXPLORER_TX}${routeRecord.preFillTxid}`;
        }
        if (routeRecord.fillTxid) {
            report.fillTxid = routeRecord.fillTxid;
            report.fillExplorerUrl = routeRecord.fillExplorerUrl || `${EXPLORER_TX}${routeRecord.fillTxid}`;
        }
        if (routeRecord.postFillTxid) {
            report.postFillTxid = routeRecord.postFillTxid;
            report.postFillExplorerUrl = routeRecord.postFillExplorerUrl || `${EXPLORER_TX}${routeRecord.postFillTxid}`;
        }
    }

    // Fallback: get fill txid from intent store
    if (!report.fillTxid && fillData?.fillTxid) {
        report.fillTxid = fillData.fillTxid;
        report.fillExplorerUrl = `${EXPLORER_TX}${fillData.fillTxid}`;
    }

    // ── Print results ────────────────────────────────────────────────────────

    printReport(report);

    // ── Step 6: Verify maker received tokens ─────────────────────────────────

    section('Step 6: Verify Maker Received Tokens');
    await sleep(3000); // brief pause for mempool propagation

    const makerPostUtxos1 = await provider.getUtxos(makerAddr);
    const makerPostUtxos2 = await provider.getUtxos(makerTokenAddr);
    const makerPostAll = [...makerPostUtxos1, ...makerPostUtxos2];
    const makerTokenBal = makerPostAll
        .filter((u: any) => u.token?.category === TOKEN_CATEGORY)
        .reduce((s: bigint, u: any) => s + BigInt(u.token!.amount), 0n);

    if (makerTokenBal >= BUY_TOKENS) {
        pass(`Maker received ${makerTokenBal} ${tokenSymbol} tokens ✓`);
    } else {
        warn(`Maker token balance: ${makerTokenBal} (expected ≥ ${BUY_TOKENS})`);
        info('Token may still be propagating through mempool');
    }

    const makerPostBch = makerPostAll
        .filter((u: any) => !u.token)
        .reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);
    info(`Maker BCH after fill: ${Number(makerPostBch) / 1e8} tBCH (${makerPostBch} sats)`);

    // Write report to file
    const reportPath = `test/reports/test5_report_${Date.now()}.json`;
    try {
        fs.mkdirSync('test/reports', { recursive: true });
        fs.writeFileSync(reportPath, JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
        info(`Report saved: ${reportPath}`);
    } catch {}

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║              Test 5 COMPLETE ✅                         ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
}

function printReport(report: Partial<FillReport>) {
    section('📋 Fill Report');

    console.log(`
  Token:            ${report.tokenSymbol} (${report.tokenCategory?.slice(0, 16)}…)
  Intent ID:        ${report.intentId ?? 'N/A'}
  Route Type:       ${report.routeType ?? 'pending'}
  Predicted Profit: ${report.predictedProfitSats ?? 'N/A'} sats
  Duration:         ${report.durationMs ? (report.durationMs / 1000).toFixed(1) + 's' : 'pending'}

  ┌─ Amounts ──────────────────────────────────────────────┐
  │  Maker Sells:  ${String(report.sellAmount).padEnd(12)} sats (BCH)            │
  │  Maker Buys:   ${String(report.buyAmount).padEnd(12)} ${(report.tokenSymbol ?? 'TOKEN').padEnd(20)} │
  └────────────────────────────────────────────────────────┘

  ┌─ Transactions ─────────────────────────────────────────┐`);

    // Contract
    if (report.contractExplorerUrl) {
        console.log(`  │  📄 Contract:                                          │`);
        console.log(`  │     ${report.contractExplorerUrl}`);
    }

    // Funding TX
    if (report.fundTxid) {
        console.log(`  │                                                        │`);
        console.log(`  │  💰 Fund TX:   ${report.fundTxid?.slice(0, 20)}…       │`);
        console.log(`  │     ${report.fundExplorerUrl}`);
        console.log(`  │     Amount: ${report.fundAmountSats} sats`);
    }

    // Pre-fill (Cauldron swap)
    if (report.preFillTxid) {
        console.log(`  │                                                        │`);
        console.log(`  │  🔄 Pre-Fill (Cauldron Swap):                          │`);
        console.log(`  │     ${report.preFillTxid?.slice(0, 20)}…`);
        console.log(`  │     ${report.preFillExplorerUrl}`);
    }

    // Fill TX
    if (report.fillTxid) {
        console.log(`  │                                                        │`);
        console.log(`  │  ✅ Fill TX:                                           │`);
        console.log(`  │     ${report.fillTxid?.slice(0, 20)}…`);
        console.log(`  │     ${report.fillExplorerUrl}`);
    }

    // Post-fill rebalance
    if (report.postFillTxid) {
        console.log(`  │                                                        │`);
        console.log(`  │  ♻️  Rebalance (Token→BCH):                            │`);
        console.log(`  │     ${report.postFillTxid?.slice(0, 20)}…`);
        console.log(`  │     ${report.postFillExplorerUrl}`);
    }

    console.log(`  └────────────────────────────────────────────────────┘`);
}

main().catch(e => {
    console.error('\nFatal error:', e);
    process.exit(1);
});
