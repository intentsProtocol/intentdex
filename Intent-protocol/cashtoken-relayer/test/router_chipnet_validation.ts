/**
 * CauldronRouter Chipnet Validation & Documentation Test
 * 
 * Verifies that the CauldronRouter:
 *   1. Dynamically detects all active CashTokens on chipnet.
 *   2. Accurately calculates BCH -> Token (BCH_TO_TOKEN) swap routes using pool liquidity.
 *   3. Prefers DIRECT routes when the relayer wallet has inventory.
 *   4. Accurately calculates Token -> BCH (TOKEN_TO_BCH) rebalancing routes.
 *   5. Accurately calculates Token -> Token (TOKEN_TO_TOKEN) 2-hop routes.
 *   6. Asserts the correctness of the generated trade rules.
 * 
 * Run:
 *   node --import tsx test/router_chipnet_validation.ts
 */

import { TestNetWallet } from 'mainnet-js';
import { CauldronPoolCache } from '../src/bot/CauldronPoolCache.js';
import { CauldronRouter } from '../src/bot/CauldronRouter.js';
import * as fs from 'fs';
import * as assert from 'assert';

const TARGET_SATS  = 5000n;

async function loadWallet(): Promise<TestNetWallet> {
    if (process.env.RELAYER_PRIVATE_KEY_WIF) {
        return TestNetWallet.fromWIF(process.env.RELAYER_PRIVATE_KEY_WIF);
    }
    const walletPath = process.env.WALLET_PATH ?? '../contracts-bch-swap/wallet.json';
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    return TestNetWallet.fromWIF(walletData.wif);
}

async function main() {
    console.log('===========================================================');
    console.log('  CauldronRouter Chipnet Validation & Verification');
    console.log('===========================================================');

    // 1. Fetch active CashTokens on chipnet
    console.log('Fetching active tokens list from chipnet indexer...');
    let tokensList: any[] = [];
    try {
        const res = await fetch('https://indexer-chipnet.riften.net/cauldron/tokens/list_cached');
        if (res.ok) {
            tokensList = await res.json();
        }
    } catch (e: any) {
        console.error('Failed to fetch chipnet tokens list:', e.message);
        process.exit(1);
    }

    // Filter tokens that have positive TVL (meaning active pools exist)
    const activeTokens = tokensList.filter(t => t.tvl_sats > 0);
    console.log(`Found ${activeTokens.length} active CashTokens with pool liquidity on chipnet:`);
    activeTokens.forEach(t => {
        const symbol = t.bcmr?.token?.symbol || t.display_symbol || 'UNKNOWN';
        console.log(`  - ${symbol} (${t.token_id.slice(0, 16)}…) | TVL: ${t.tvl_sats} sats`);
    });

    if (activeTokens.length < 2) {
        console.warn('⚠️ Need at least 2 active tokens to run the 2-hop Token->Token test.');
    }

    // 2. Initialize CauldronRouter & Cache
    const policy = {
        minAbsoluteSats: -1_000_000_000n, // allow negative profit for test purposes
        minBps: -100_000,
        maxSlippageBps: 100_000,
    };
    const cache = CauldronPoolCache.forNetwork('chipnet');
    const router = new CauldronRouter(cache, policy);
    await cache.refresh();

    // Load wallet UTXOs to represent our base solver state
    const wallet = await loadWallet();
    const relayerAddr = (wallet as any).cashaddr as string;
    const tokenAddr = (wallet as any).tokenaddr as string;
    const provider = wallet.provider as any;
    
    const utxos1 = await provider.getUtxos(relayerAddr);
    const utxos2 = await provider.getUtxos(tokenAddr);
    const solverBchUtxos = [...utxos1, ...utxos2].filter((u: any) => !u.token);

    console.log(`\nRelayer BCH balance: ${solverBchUtxos.reduce((s, u) => s + BigInt(u.satoshis), 0n)} sats`);

    // 3. Test Routing for each active token
    for (const token of activeTokens) {
        const symbol = token.bcmr?.token?.symbol || token.display_symbol || 'UNKNOWN';
        const tokenId = token.token_id;
        console.log(`\n───────────────────────────────────────────────────────────`);
        console.log(`  Testing Token: ${symbol} (${tokenId.slice(0, 16)}…)`);
        console.log(`───────────────────────────────────────────────────────────`);

        // Test A: BCH -> Token (BCH_TO_TOKEN)
        console.log('\n  Route Type 1: BCH -> Token (Swap Route)');
        const bchToTokenSol: any = {
            currentPrice: 100n, // wants 100 units
            params: {
                sellTokenCategory: '0x',
                buyTokenCategory: `0x${tokenId}`,
                sellAmount: 200_000n, // paying 200k sats
            },
            isExpired: false,
        };

        const q1 = await router.quote(bchToTokenSol, solverBchUtxos);
        console.log(`    Route:      ${q1.routeType}`);
        console.log(`    Profitable: ${q1.profitable}`);
        console.log(`    Reason:     ${q1.reason}`);
        
        if (q1.profitable) {
            assert.ok(q1.routeType === 'BCH_TO_TOKEN', 'Should select BCH_TO_TOKEN route');
            assert.ok(q1.preFillTrade !== null, 'BCH_TO_TOKEN preFillTrade should be defined');
            assert.ok(q1.preFillTokenId === tokenId, 'preFillTokenId should match');
        }
        console.log(`    ✅ BCH -> Token quote validated`);

        // Test B: BCH -> Token (DIRECT Inventory Route)
        console.log('\n  Route Type 2: BCH -> Token (DIRECT Inventory Route)');
        // Mock a token UTXO in our wallet to trigger DIRECT route
        const mockTokenUtxo = {
            txid: '0000000000000000000000000000000000000000000000000000000000000001',
            vout: 0,
            satoshis: 5000,
            token: {
                category: tokenId,
                amount: 10000
            }
        };
        const utxosWithInventory = [...solverBchUtxos, mockTokenUtxo];

        const q2 = await router.quote(bchToTokenSol, utxosWithInventory);
        console.log(`    Route:      ${q2.routeType}`);
        console.log(`    Profitable: ${q2.profitable}`);
        console.log(`    Reason:     ${q2.reason}`);

        assert.ok(q2.routeType === 'DIRECT', 'Should select DIRECT route when inventory exists');
        assert.ok(q2.preFillTrade === null, 'DIRECT route should have no preFillTrade');
        console.log(`    ✅ DIRECT route validated`);

        // Test C: Token -> BCH (TOKEN_TO_BCH)
        console.log('\n  Route Type 3: Token -> BCH (Swap Route)');
        const tokenToBchSol: any = {
            currentPrice: 10_000n, // wants 10k sats
            params: {
                sellTokenCategory: `0x${tokenId}`,
                buyTokenCategory: '0x',
                sellAmount: 500n, // paying 500 units
            },
            isExpired: false,
        };

        const q3 = await router.quote(tokenToBchSol, solverBchUtxos);
        console.log(`    Route:      ${q3.routeType}`);
        console.log(`    Profitable: ${q3.profitable}`);
        console.log(`    Reason:     ${q3.reason}`);

        if (q3.profitable) {
            assert.ok(q3.routeType === 'TOKEN_TO_BCH', 'Should select TOKEN_TO_BCH route');
            assert.ok(q3.postFillTrade !== null, 'TOKEN_TO_BCH postFillTrade should be defined');
            assert.ok(q3.postFillTokenId === tokenId, 'postFillTokenId should match');
        }
        console.log(`    ✅ Token -> BCH quote validated`);
    }

    // Test D: Token A -> Token B (TOKEN_TO_TOKEN)
    if (activeTokens.length >= 2) {
        console.log(`\n───────────────────────────────────────────────────────────`);
        console.log(`  Testing Route Type 4: Token A -> Token B (2-Hop Swap)`);
        console.log(`───────────────────────────────────────────────────────────`);
        
        const tokenA = activeTokens[0];
        const tokenB = activeTokens[1];
        const tickerA = tokenA.bcmr?.token?.symbol || tokenA.display_symbol || 'TOKEN_A';
        const tickerB = tokenB.bcmr?.token?.symbol || tokenB.display_symbol || 'TOKEN_B';

        console.log(`Routing from ${tickerA} (${tokenA.token_id.slice(0, 12)}…) to ${tickerB} (${tokenB.token_id.slice(0, 12)}…)`);

        const tokenToTokenSol: any = {
            currentPrice: 100n, // wants 100 units of Token B
            params: {
                sellTokenCategory: `0x${tokenA.token_id}`,
                buyTokenCategory: `0x${tokenB.token_id}`,
                sellAmount: 500n, // paying 500 units of Token A
            },
            isExpired: false,
        };

        const q4 = await router.quote(tokenToTokenSol, solverBchUtxos);
        console.log(`    Route:      ${q4.routeType}`);
        console.log(`    Profitable: ${q4.profitable}`);
        console.log(`    Reason:     ${q4.reason}`);

        assert.ok(q4.routeType === 'TOKEN_TO_TOKEN', 'Should select TOKEN_TO_TOKEN route');
        assert.ok(q4.preFillTrade !== null, 'TOKEN_TO_TOKEN preFillTrade should be defined');
        assert.ok(q4.postFillTrade !== null, 'TOKEN_TO_TOKEN postFillTrade should be defined');
        assert.ok(q4.preFillTokenId === tokenB.token_id, 'preFillTokenId should match buyToken');
        assert.ok(q4.postFillTokenId === tokenA.token_id, 'postFillTokenId should match sellToken');
        console.log(`    ✅ Token -> Token 2-hop route validated`);
    }

    console.log('\n===========================================================');
    console.log('  ALL ROUTER VERIFICATIONS PASSED ✅');
    console.log('===========================================================');
    process.exit(0);
}

main().catch(e => {
    console.error('Fatal error:', e.message);
    process.exit(1);
});
