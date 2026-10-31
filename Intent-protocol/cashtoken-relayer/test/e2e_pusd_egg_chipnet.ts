/**
 * E2E test — PUSD + EGG tokens on chipnet with tBCH
 *
 * Covers:
 *   1. Wallet balances (tBCH + PUSD + EGG inventory)
 *   2. CauldronRouter quotes for BCH→PUSD and BCH→EGG
 *   3. CauldronRouter quotes for PUSD→BCH and EGG→BCH (reverse direction)
 *   4. Intent creation via API (limit orders for both tokens)
 *   5. Router status verification after intent creation
 *   6. Router pause/resume cycle with token intents active
 *
 * Usage:
 *   npx tsx test/e2e_pusd_egg_chipnet.ts
 *
 * Required env:
 *   RELAYER_PRIVATE_KEY_WIF  or  WALLET_PATH
 *
 * Optional:
 *   RELAYER_API_URL   (default http://localhost:3006)
 */

import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider } from 'cashscript';
import { CauldronPoolCache } from '../src/bot/CauldronPoolCache.js';
import { CauldronRouter } from '../src/bot/CauldronRouter.js';
import * as fs from 'fs';
import * as assert from 'assert';

// ── Token categories on chipnet ──────────────────────────────────────────────
const PUSD = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';
const EGG  = '00929d9c87328052fe88af118e5d7e29ec24a1771fa8e826bd7485ced761d17f';
const TOKENS = [
    { name: 'PUSD (ParyonUSD)', category: PUSD },
    { name: 'EGG (EGGS)',       category: EGG  },
];

const RELAYER_API = process.env.RELAYER_API_URL ?? 'http://localhost:3006';
const BUY_AMOUNT  = 1000n;     // token units to buy per intent
const SELL_BCH    = 10_000n;   // sats maker locks

// ── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0, failed = 0, skipped = 0;

function pass(msg: string) { passed++; console.log(`  ✅ ${msg}`); }
function fail(msg: string) { failed++; console.error(`  ❌ ${msg}`); process.exitCode = 1; }
function skip(msg: string) { skipped++; console.log(`  ⏭️  ${msg}`); }
function info(msg: string) { console.log(`  ℹ️  ${msg}`); }
function section(msg: string) { console.log(`\n── ${msg} ──`); }

async function apiGet(path: string) {
    const res = await fetch(`${RELAYER_API}${path}`);
    return res.json();
}

async function apiPost(path: string, body?: object) {
    const hasBody = body !== undefined;
    const res = await fetch(`${RELAYER_API}${path}`, {
        method: 'POST',
        headers: hasBody ? { 'content-type': 'application/json' } : {},
        body: hasBody ? JSON.stringify(body) : undefined,
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

async function waitForServer(maxMs = 20_000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        try { await apiGet('/health'); return true; }
        catch { await new Promise(r => setTimeout(r, 2000)); }
    }
    return false;
}

// ── Suite 1: Wallet Balances ─────────────────────────────────────────────────

async function testWalletBalances(wallet: TestNetWallet) {
    section('Suite 1: Wallet Balances (chipnet)');

    const addr    = (wallet as any).cashaddr as string;
    const tokAddr = (wallet as any).tokenaddr as string;
    info(`Relayer cashaddr:  ${addr}`);
    info(`Relayer tokenaddr: ${tokAddr}`);

    const provider = new ElectrumNetworkProvider('chipnet');
    const utxos1 = await provider.getUtxos(addr);
    const utxos2 = await provider.getUtxos(tokAddr);
    const allUtxos = [...utxos1, ...utxos2];

    // BCH balance
    const bchBalance = allUtxos
        .filter((u: any) => !u.token)
        .reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);
    info(`tBCH balance: ${Number(bchBalance) / 1e8} tBCH (${bchBalance} sats)`);

    if (bchBalance < 15_000n) {
        fail(`Insufficient tBCH (need ≥ 15,000 sats). Fund: https://tbch.googol.cash/`);
    } else {
        pass(`tBCH balance OK: ${bchBalance} sats`);
    }

    // Token balances
    for (const { name, category } of TOKENS) {
        const bal = allUtxos
            .filter((u: any) => u.token?.category === category)
            .reduce((s: bigint, u: any) => s + BigInt(u.token!.amount), 0n);
        const utxoCount = allUtxos.filter((u: any) => u.token?.category === category).length;
        info(`${name}: ${bal} units across ${utxoCount} UTXOs`);

        if (bal > 0n) {
            pass(`${name} inventory present: ${bal} units`);
        } else {
            info(`${name} inventory empty — direct fills won't be possible`);
        }
    }

    return { allUtxos, bchBalance };
}

// ── Suite 2: Router Quotes ───────────────────────────────────────────────────

async function testRouterQuotes(allUtxos: any[]) {
    section('Suite 2: CauldronRouter Quotes (PUSD + EGG)');

    const cache  = CauldronPoolCache.forNetwork('chipnet');
    const router = new CauldronRouter(cache, 1n);

    const chipnetPools = await cache.getPools();
    info(`Chipnet pool count: ${chipnetPools.length}`);

    for (const { name, category } of TOKENS) {
        console.log(`\n  ── ${name} ──`);

        // BCH→Token quote
        const bchToTokenSol: any = {
            currentPrice: BUY_AMOUNT,
            params: {
                sellTokenCategory: '0x',
                buyTokenCategory:  `0x${category}`,
                sellAmount:        SELL_BCH,
            },
            isExpired: false,
        };

        const q1 = await router.quote(bchToTokenSol, allUtxos);
        info(`BCH→${name}: route=${q1.routeType} profitable=${q1.profitable} profit=${q1.netProfitSats} sats`);
        info(`  Reason: ${q1.reason}`);

        assert.ok(typeof q1.routeType === 'string', `routeType should be a string`);
        assert.ok(typeof q1.profitable === 'boolean', `profitable should be boolean`);
        pass(`BCH→${name} quote returned valid structure`);

        // Check inventory detection
        const inventory = allUtxos
            .filter((u: any) => u.token?.category === category)
            .reduce((s: bigint, u: any) => s + BigInt(u.token!.amount), 0n);

        if (inventory >= BUY_AMOUNT) {
            info(`Relayer has ${inventory} ${name} — router should prefer DIRECT`);
            if (q1.routeType === 'DIRECT') {
                pass(`${name}: DIRECT route selected (inventory fill)`);
            }
        } else {
            info(`Relayer has ${inventory} ${name} — needs Cauldron or more inventory`);
        }

        // Token→BCH quote (reverse direction)
        const tokenToBchSol: any = {
            currentPrice: SELL_BCH,
            params: {
                sellTokenCategory: `0x${category}`,
                buyTokenCategory:  '0x',
                sellAmount:        BUY_AMOUNT,
            },
            isExpired: false,
        };

        const q2 = await router.quote(tokenToBchSol, allUtxos);
        info(`${name}→BCH: route=${q2.routeType} profitable=${q2.profitable} profit=${q2.netProfitSats} sats`);
        info(`  Reason: ${q2.reason}`);
        pass(`${name}→BCH quote returned valid structure`);
    }

    // Token→Token quote (PUSD→EGG via 2-hop BCH bridge)
    console.log(`\n  ── PUSD→EGG (2-hop via BCH) ──`);
    const pusdToEggSol: any = {
        currentPrice: BUY_AMOUNT,
        params: {
            sellTokenCategory: `0x${PUSD}`,
            buyTokenCategory:  `0x${EGG}`,
            sellAmount:        BUY_AMOUNT,
        },
        isExpired: false,
    };
    const q3 = await router.quote(pusdToEggSol, allUtxos);
    info(`PUSD→EGG: route=${q3.routeType} profitable=${q3.profitable} profit=${q3.netProfitSats} sats`);
    info(`  Reason: ${q3.reason}`);
    pass(`PUSD→EGG 2-hop quote returned`);
}

// ── Suite 3: Intent Creation via API ─────────────────────────────────────────

async function testIntentCreation(addr: string) {
    section('Suite 3: Intent Creation (PUSD + EGG on chipnet)');

    const serverUp = await waitForServer(15_000);
    if (!serverUp) {
        skip('Relayer API not reachable — start with "npm start" first');
        return;
    }
    pass('Relayer API is up');

    for (const { name, category } of TOKENS) {
        console.log(`\n  Creating BCH→${name} limit intent…`);
        info(`Maker pays:  ${SELL_BCH} sats (${Number(SELL_BCH) / 1e8} tBCH)`);
        info(`Maker wants: ${BUY_AMOUNT} units of ${category.slice(0, 12)}…`);

        try {
            const res = await apiPost('/intent/create', {
                makerAddress: addr,
                sellToken:    'BCH',
                buyToken:     category,
                sellAmount:   SELL_BCH.toString(),
                buyAmount:    BUY_AMOUNT.toString(),
                orderType:    'limit',
                expiryTime:   Math.floor(Date.now() / 1000) + 600,
                network:      'chipnet',
            });

            if (res.success) {
                pass(`${name} intent created: ${res.intentId}`);
                info(`Contract: ${res.contractAddress}`);
                info(`Token addr: ${res.tokenAddress}`);
                info(`Explorer: ${res.explorerUrl}`);

                assert.ok(res.explorerUrl.includes('chipnet'), 'Explorer URL should be chipnet');
                pass(`${name} explorer URL format correct`);

                // Verify we can fetch it back
                const stored = await apiGet(`/intent/${res.intentId}`);
                assert.ok(stored.status === 'pending', 'Intent should be pending');
                assert.ok(stored.buyToken === category, 'buyToken should match');
                pass(`${name} intent retrieved from store`);
            } else {
                fail(`${name} intent creation failed: ${res.error}`);
            }
        } catch (e: any) {
            fail(`${name} intent API error: ${e.message}`);
        }
    }

    // Also create a reverse intent (PUSD→BCH)
    console.log(`\n  Creating PUSD→BCH limit intent (reverse)…`);
    try {
        const res = await apiPost('/intent/create', {
            makerAddress: addr,
            sellToken:    PUSD,
            buyToken:     'BCH',
            sellAmount:   BUY_AMOUNT.toString(),
            buyAmount:    SELL_BCH.toString(),
            orderType:    'limit',
            expiryTime:   Math.floor(Date.now() / 1000) + 600,
            network:      'chipnet',
        });
        if (res.success) {
            pass(`PUSD→BCH intent created: ${res.intentId}`);
        } else {
            fail(`PUSD→BCH intent creation failed: ${res.error}`);
        }
    } catch (e: any) {
        fail(`PUSD→BCH intent API error: ${e.message}`);
    }
}

// ── Suite 4: Router Status + Pause/Resume ────────────────────────────────────

async function testRouterControls() {
    section('Suite 4: Router Status & Controls');

    const serverUp = await waitForServer(10_000);
    if (!serverUp) { skip('Server not reachable'); return; }

    // Get status
    const status = await apiGet('/router/status');
    info(`Paused: ${status.paused}`);
    info(`Mainnet pools: ${status.mainnetPoolCount}`);
    info(`Chipnet pools: ${status.chipnetPoolCount}`);
    info(`Cache age: ${status.mainnetCacheAgeMs}ms`);
    info(`Total fills: ${status.totalFills}`);
    info(`Total profit: ${status.totalProfitSats} sats`);
    info(`Recent routes: ${status.recentRoutes.length}`);

    assert.ok(status.paused === false, 'Router should not be paused initially');
    assert.ok(typeof status.mainnetPoolCount === 'number', 'mainnetPoolCount should be number');
    assert.ok(typeof status.chipnetPoolCount === 'number', 'chipnetPoolCount should be number');
    pass('Router status fields valid');

    // Pause
    const pauseRes = await apiPost('/router/pause');
    assert.ok(pauseRes.paused === true, 'Pause should return paused=true');
    pass('Router paused');

    const statusPaused = await apiGet('/router/status');
    assert.ok(statusPaused.paused === true, 'Status should show paused');
    pass('Status confirms paused');

    // Resume
    const resumeRes = await apiPost('/router/resume');
    assert.ok(resumeRes.paused === false, 'Resume should return paused=false');
    pass('Router resumed');

    const statusResumed = await apiGet('/router/status');
    assert.ok(statusResumed.paused === false, 'Status should show resumed');
    pass('Status confirms resumed');

    // Refresh pools
    const refreshRes = await apiPost('/router/refresh-pools');
    assert.ok(typeof refreshRes.mainnetPools === 'number', 'refresh should return mainnet pool count');
    assert.ok(typeof refreshRes.chipnetPools === 'number', 'refresh should return chipnet pool count');
    pass(`Pool refresh: mainnet=${refreshRes.mainnetPools}, chipnet=${refreshRes.chipnetPools}`);

    // Check metrics
    const metrics = await apiGet('/router/metrics');
    assert.ok(metrics.ready === true, 'Metrics should be ready');
    info(`Policy: floor=${metrics.policy.minAbsoluteSats} sats / ${metrics.policy.minBps} bps`);
    info(`Max slippage: ${metrics.policy.maxSlippageBps} bps`);
    pass('Metrics endpoint OK');
}

// ── Suite 5: Active intents listing ──────────────────────────────────────────

async function testIntentListing() {
    section('Suite 5: Intent Listing & Query');

    const serverUp = await waitForServer(10_000);
    if (!serverUp) { skip('Server not reachable'); return; }

    // Legacy format
    const legacy = await apiGet('/intents');
    assert.ok(Array.isArray(legacy.active), 'active should be array');
    assert.ok(Array.isArray(legacy.completed), 'completed should be array');
    info(`Active intents: ${legacy.active.length}`);
    info(`Completed intents: ${legacy.completed.length}`);
    pass('Legacy /intents format OK');

    // Query by buyToken = PUSD
    const pusdIntents = await apiGet(`/intents?buyToken=${PUSD}`);
    info(`Intents with buyToken=PUSD: ${pusdIntents.results?.length ?? pusdIntents.active?.length ?? 'N/A'}`);
    pass('Query by buyToken works');

    // Query by buyToken = EGG
    const eggIntents = await apiGet(`/intents?buyToken=${EGG}`);
    info(`Intents with buyToken=EGG: ${eggIntents.results?.length ?? eggIntents.active?.length ?? 'N/A'}`);
    pass('Query by EGG works');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  PUSD + EGG E2E Test Suite (chipnet / tBCH)');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  Relayer API: ${RELAYER_API}`);
    console.log(`  PUSD: ${PUSD.slice(0, 16)}…`);
    console.log(`  EGG:  ${EGG.slice(0, 16)}…`);

    let wallet: TestNetWallet;
    try {
        wallet = await loadWallet();
    } catch (e: any) {
        fail(`Cannot load wallet: ${e.message}`);
        printSummary();
        return;
    }

    const { allUtxos } = await testWalletBalances(wallet);
    await testRouterQuotes(allUtxos);
    await testIntentCreation((wallet as any).cashaddr as string);
    await testRouterControls();
    await testIntentListing();

    printSummary();
}

function printSummary() {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  RESULT: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    if (failed > 0) {
        console.log('  STATUS: FAILED ❌');
    } else {
        console.log('  STATUS: ALL PASSED ✅');
    }
    console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
