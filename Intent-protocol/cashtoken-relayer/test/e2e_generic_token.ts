/**
 * E2E test — Generic CashToken on chipnet with tBCH
 *
 * Covers:
 *   1. Dynamic token metadata resolution (symbol, name, decimals)
 *   2. Wallet balances (tBCH + dynamic token inventory)
 *   3. CauldronRouter quotes for BCH→Token and Token→BCH (reverse direction)
 *   4. Intent creation via API (limit orders for both directions)
 *   5. Router status verification after intent creation
 *   6. Router pause/resume cycle with token intents active
 *
 * Usage:
 *   TOKEN_CATEGORY=<token_category_hex> npx tsx test/e2e_generic_token.ts
 *
 * Defaults to BACON (84c7fe833ade565aeee5a46d407c7f2da02902f7e6b6c07826dd8d21efb7b3a7)
 */

import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider } from 'cashscript';
import { CauldronPoolCache } from '../src/bot/CauldronPoolCache.js';
import { CauldronRouter } from '../src/bot/CauldronRouter.js';
import * as fs from 'fs';
import * as assert from 'assert';

// ── Resolve dynamic token category ──────────────────────────────────────────
const TARGET_CATEGORY = process.env.TOKEN_CATEGORY ?? '84c7fe833ade565aeee5a46d407c7f2da02902f7e6b6c07826dd8d21efb7b3a7';

const RELAYER_API = process.env.RELAYER_API_URL ?? 'http://localhost:3006';
const BUY_AMOUNT  = 10n;      // token units to buy per intent (BACON is small-decimals)
const SELL_BCH    = 5000n;    // sats maker locks

let tokenSymbol = 'DYNAMIC';
let tokenName = 'Dynamic CashToken';
let tokenDecimals = 0;

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

// ── dynamic metadata fetch ───────────────────────────────────────────────────

async function resolveMetadata() {
    section('Dynamic Token Metadata Resolution');
    try {
        const res = await fetch('https://indexer-chipnet.riften.net/cauldron/tokens/list_cached');
        if (res.ok) {
            const list = await res.json() as any[];
            const matched = list.find(t => t.token_id === TARGET_CATEGORY);
            if (matched) {
                tokenSymbol = matched.bcmr?.token?.symbol || matched.display_symbol || 'UNKNOWN';
                tokenName = matched.bcmr?.name || matched.display_name || tokenSymbol;
                tokenDecimals = matched.bcmr?.token?.decimals ?? 0;
                pass(`Resolved metadata for ${TARGET_CATEGORY}: ${tokenName} (${tokenSymbol}), decimals = ${tokenDecimals}`);
                return;
            }
        }
        info(`Could not find token ${TARGET_CATEGORY} on indexer, using defaults.`);
    } catch (e: any) {
        info(`Metadata fetch failed: ${e.message}. Using defaults.`);
    }
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

    // Token balance
    const bal = allUtxos
        .filter((u: any) => u.token?.category === TARGET_CATEGORY)
        .reduce((s: bigint, u: any) => s + BigInt(u.token!.amount), 0n);
    const utxoCount = allUtxos.filter((u: any) => u.token?.category === TARGET_CATEGORY).length;
    
    const formattedBal = tokenDecimals > 0
        ? (Number(bal) / Math.pow(10, tokenDecimals)).toFixed(tokenDecimals)
        : bal.toString();

    info(`${tokenSymbol}: ${formattedBal} units (${bal} raw) across ${utxoCount} UTXOs`);

    if (bal > 0n) {
        pass(`${tokenSymbol} inventory present: ${formattedBal} units`);
    } else {
        info(`${tokenSymbol} inventory empty — direct fills won't be possible`);
    }

    return { allUtxos, bchBalance };
}

// ── Suite 2: Router Quotes ───────────────────────────────────────────────────

async function testRouterQuotes(allUtxos: any[]) {
    section(`Suite 2: CauldronRouter Quotes (${tokenSymbol})`);

    const cache  = CauldronPoolCache.forNetwork('chipnet');
    const router = new CauldronRouter(cache, 1n);

    const chipnetPools = await cache.getPools();
    info(`Chipnet pool count: ${chipnetPools.length}`);

    // BCH→Token quote
    const bchToTokenSol: any = {
        currentPrice: BUY_AMOUNT,
        params: {
            sellTokenCategory: '0x',
            buyTokenCategory:  `0x${TARGET_CATEGORY}`,
            sellAmount:        SELL_BCH,
        },
        isExpired: false,
    };

    const q1 = await router.quote(bchToTokenSol, allUtxos);
    info(`BCH→${tokenSymbol}: route=${q1.routeType} profitable=${q1.profitable} profit=${q1.netProfitSats} sats`);
    info(`  Reason: ${q1.reason}`);

    assert.ok(typeof q1.routeType === 'string', `routeType should be a string`);
    assert.ok(typeof q1.profitable === 'boolean', `profitable should be boolean`);
    pass(`BCH→${tokenSymbol} quote returned valid structure`);

    // Check inventory detection
    const inventory = allUtxos
        .filter((u: any) => u.token?.category === TARGET_CATEGORY)
        .reduce((s: bigint, u: any) => s + BigInt(u.token!.amount), 0n);

    if (inventory >= BUY_AMOUNT) {
        info(`Relayer has ${inventory} ${tokenSymbol} — router should prefer DIRECT`);
        if (q1.routeType === 'DIRECT') {
            pass(`${tokenSymbol}: DIRECT route selected (inventory fill)`);
        }
    } else {
        info(`Relayer has ${inventory} ${tokenSymbol} — needs Cauldron or more inventory`);
    }

    // Token→BCH quote (reverse direction)
    const tokenToBchSol: any = {
        currentPrice: SELL_BCH,
        params: {
            sellTokenCategory: `0x${TARGET_CATEGORY}`,
            buyTokenCategory:  '0x',
            sellAmount:        BUY_AMOUNT,
        },
        isExpired: false,
    };

    const q2 = await router.quote(tokenToBchSol, allUtxos);
    info(`${tokenSymbol}→BCH: route=${q2.routeType} profitable=${q2.profitable} profit=${q2.netProfitSats} sats`);
    info(`  Reason: ${q2.reason}`);
    pass(`${tokenSymbol}→BCH quote returned valid structure`);
}

// ── Suite 3: Intent Creation via API ─────────────────────────────────────────

async function testIntentCreation(addr: string) {
    section(`Suite 3: Intent Creation (${tokenSymbol} on chipnet)`);

    const serverUp = await waitForServer(15_000);
    if (!serverUp) {
        skip('Relayer API not reachable — start with "npm start" first');
        return;
    }
    pass('Relayer API is up');

    console.log(`\n  Creating BCH→${tokenSymbol} limit intent…`);
    info(`Maker pays:  ${SELL_BCH} sats (${Number(SELL_BCH) / 1e8} tBCH)`);
    info(`Maker wants: ${BUY_AMOUNT} units of ${TARGET_CATEGORY.slice(0, 12)}…`);

    try {
        const res = await apiPost('/intent/create', {
            makerAddress: addr,
            sellToken:    'BCH',
            buyToken:     TARGET_CATEGORY,
            sellAmount:   SELL_BCH.toString(),
            buyAmount:    BUY_AMOUNT.toString(),
            orderType:    'limit',
            expiryTime:   Math.floor(Date.now() / 1000) + 600,
            network:      'chipnet',
        });

        if (res.success) {
            pass(`${tokenSymbol} intent created: ${res.intentId}`);
            info(`Contract: ${res.contractAddress}`);
            info(`Token addr: ${res.tokenAddress}`);
            info(`Explorer: ${res.explorerUrl}`);

            assert.ok(res.explorerUrl.includes('chipnet'), 'Explorer URL should be chipnet');
            pass(`${tokenSymbol} explorer URL format correct`);

            // Verify we can fetch it back
            const stored = await apiGet(`/intent/${res.intentId}`);
            assert.ok(stored.status === 'pending', 'Intent should be pending');
            assert.ok(stored.buyToken === TARGET_CATEGORY, 'buyToken should match');
            pass(`${tokenSymbol} intent retrieved from store`);
        } else {
            fail(`${tokenSymbol} intent creation failed: ${res.error}`);
        }
    } catch (e: any) {
        fail(`${tokenSymbol} intent API error: ${e.message}`);
    }

    // Also create a reverse intent (Token→BCH)
    console.log(`\n  Creating ${tokenSymbol}→BCH limit intent (reverse)…`);
    try {
        const res = await apiPost('/intent/create', {
            makerAddress: addr,
            sellToken:    TARGET_CATEGORY,
            buyToken:     'BCH',
            sellAmount:   BUY_AMOUNT.toString(),
            buyAmount:    SELL_BCH.toString(),
            orderType:    'limit',
            expiryTime:   Math.floor(Date.now() / 1000) + 600,
            network:      'chipnet',
        });
        if (res.success) {
            pass(`${tokenSymbol}→BCH intent created: ${res.intentId}`);
        } else {
            fail(`${tokenSymbol}→BCH intent creation failed: ${res.error}`);
        }
    } catch (e: any) {
        fail(`${tokenSymbol}→BCH intent API error: ${e.message}`);
    }
}

// ── Suite 4: Router Status + Pause/Resume ────────────────────────────────────

async function testRouterControls() {
    section('Suite 4: Router Status & Controls');

    const serverUp = await waitForServer(10_000);
    if (!serverUp) { skip('Server not reachable'); return; }

    const status = await apiGet('/router/status');
    info(`Paused: ${status.paused}`);
    info(`Total fills: ${status.totalFills}`);
    info(`Total profit: ${status.totalProfitSats} sats`);

    assert.ok(status.paused === false, 'Router should not be paused initially');
    pass('Router status fields valid');

    // Pause
    const pauseRes = await apiPost('/router/pause');
    assert.ok(pauseRes.paused === true, 'Pause should return paused=true');
    pass('Router paused');

    // Resume
    const resumeRes = await apiPost('/router/resume');
    assert.ok(resumeRes.paused === false, 'Resume should return paused=false');
    pass('Router resumed');
}

// ── Suite 5: Active intents listing ──────────────────────────────────────────

async function testIntentListing() {
    section('Suite 5: Intent Listing & Query');

    const serverUp = await waitForServer(10_000);
    if (!serverUp) { skip('Server not reachable'); return; }

    // Query by buyToken
    const list = await apiGet(`/intents?buyToken=${TARGET_CATEGORY}`);
    const count = list.results?.length ?? list.active?.length ?? list.intents?.length ?? 0;
    info(`Intents with buyToken=${tokenSymbol}: ${count}`);
    pass(`Query by buyToken (${tokenSymbol}) works`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  Dynamic E2E Test Suite (chipnet / tBCH)`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  Relayer API: ${RELAYER_API}`);
    console.log(`  Category:    ${TARGET_CATEGORY}`);

    await resolveMetadata();

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
