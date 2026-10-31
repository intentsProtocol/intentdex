/**
 * E2E direct-liquidity test — BCH→EGGS limit order on chipnet via DIRECT route.
 *
 * Verifies that when the relayer has direct token liquidity (inventory), it
 * completely bypasses Cauldron pools, using a single-hop fill transaction.
 *
 * Flow:
 *   1. Load wallet + provider for chipnet.
 *   2. Check for a viable DIRECT EGGS UTXO (carrying >= 1000 EGGS and >= 3500 sats dust).
 *   3. If none exists, pre-position direct liquidity:
 *      - If we have EGGS balance: self-send to split/consolidate into a viable UTXO with 5,000 sats dust.
 *      - If we have NO EGGS: execute a JIT pre-fill swap on Cauldron (BCH→EGGS) to get 1,000 EGGS with 5,000 sats dust.
 *   4. Create a profitable BCH→EGGS limit intent via the API (/intent/create).
 *   5. Call CauldronRouter.quote() on the solution and assert it selects DIRECT.
 *   6. Subscribe to WebSocket router:fill event.
 *   7. Fund the covenant.
 *   8. Wait for fill event and assert routeType was DIRECT, with no Cauldron transactions.
 *
 * Usage:
 *   # 1. Start the relayer in another terminal
 *   PORT=3006 RELAYER_PRIVATE_KEY_WIF=$WIF npm start
 *
 *   # 2. Run the test
 *   RELAYER_PRIVATE_KEY_WIF=$WIF npm run test:direct
 */

import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider, TransactionBuilder, SignatureTemplate } from 'cashscript';
import WebSocket from 'ws';
import * as fs from 'fs';
import * as assert from 'assert';
import * as SpreadQuant from '../src/bot/SpreadQuant.js';
import { CauldronPoolCache } from '../src/bot/CauldronPoolCache.js';
import { CauldronRouter } from '../src/bot/CauldronRouter.js';

const EGGS = '00929d9c87328052fe88af118e5d7e29ec24a1771fa8e826bd7485ced761d17f';
const RELAYER_API = process.env.RELAYER_API_URL ?? 'http://localhost:3006';
const FILL_TIMEOUT_MS = parseInt(process.env.FILL_TIMEOUT_MS ?? '240000', 10); // 4 min
const BUY_AMOUNT = 1000n; // 1000 EGGS

const pass = (m: string) => console.log(`  ✅ ${m}`);
const fail = (m: string) => { console.error(`  ❌ ${m}`); process.exitCode = 1; };
const info = (m: string) => console.log(`  ℹ️  ${m}`);
const banner = (m: string) => console.log(`\n${'═'.repeat(72)}\n  ${m}\n${'═'.repeat(72)}`);

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

function waitForFillEvent(intentId: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
        const wsUrl = RELAYER_API.replace(/^http/, 'ws') + '/ws';
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => { ws.close(); reject(new Error(`fill timeout after ${timeoutMs/1000}s`)); }, timeoutMs);
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

/** pre-position direct token liquidity by consolidating/splitting existing eggs into a single 5000-sat output */
async function prePositionEggs(wallet: TestNetWallet, buyAmount: bigint, provider: ElectrumNetworkProvider): Promise<string> {
    const fromAddr = (wallet as any).cashaddr as string;
    const fromTok  = (wallet as any).tokenaddr as string;
    
    const utxos = [...await provider.getUtxos(fromAddr), ...await provider.getUtxos(fromTok)];
    const seen = new Set<string>();
    const uniq = utxos.filter((u: any) => {
        const k = `${u.txid}:${u.vout}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });

    const eggsUtxos = uniq.filter((u: any) => u.token?.category === EGGS);
    const bchUtxos  = uniq.filter((u: any) => !u.token);
    
    const totalAvail = eggsUtxos.reduce((s, u: any) => s + BigInt(u.token!.amount), 0n);
    if (totalAvail < buyAmount) {
        throw new Error(`Insufficient EGGS in wallet to pre-position DIRECT liquidity: have ${totalAvail}, need ${buyAmount}`);
    }

    const wif = (wallet as any).privateKeyWif as string;
    const sig = new SignatureTemplate(wif);
    const tb = new TransactionBuilder({ provider });

    let tokenInputSum = 0n;
    for (const u of eggsUtxos) {
        tb.addInput({
            txid: u.txid, vout: u.vout, satoshis: BigInt(u.satoshis),
            token: { amount: BigInt(u.token!.amount), category: EGGS }
        }, sig.unlockP2PKH());
        tokenInputSum += BigInt(u.token!.amount);
    }

    // Viable DIRECT fill UTXO requires 5000 sats BCH dust to clear MIN_DIRECT_TOKEN_BCH_DUST (3500)
    tb.addOutput({
        to: fromTok,
        amount: 5000n,
        token: { amount: buyAmount, category: EGGS }
    });

    const tokenChange = tokenInputSum - buyAmount;
    const txFee = 3000n;
    const needBch = 5000n + txFee + (tokenChange > 0n ? 1000n : 0n);
    
    let bchIn = eggsUtxos.reduce((s, u: any) => s + BigInt(u.satoshis), 0n);
    if (bchIn < needBch) {
        const sortedBch = [...bchUtxos].sort((a, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)));
        for (const u of sortedBch) {
            tb.addInput({ txid: u.txid, vout: u.vout, satoshis: BigInt(u.satoshis) }, sig.unlockP2PKH());
            bchIn += BigInt(u.satoshis);
            if (bchIn >= needBch) break;
        }
    }

    if (bchIn < needBch) {
        throw new Error(`Insufficient BCH to cover pre-positioning fees and dust. Need ${needBch}, have ${bchIn}`);
    }

    if (tokenChange > 0n) {
        tb.addOutput({
            to: fromTok,
            amount: 1000n,
            token: { amount: tokenChange, category: EGGS }
        });
    }

    const satChange = bchIn - 5000n - txFee - (tokenChange > 0n ? 1000n : 0n);
    if (satChange > 546n) {
        tb.addOutput({ to: fromAddr, amount: satChange });
    }

    const res = await tb.send();
    return res.txid;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    banner('E2E Direct Liquidity Test (chipnet, self-fill, BCH→EGGS)');
    info(`Relayer API: ${RELAYER_API}`);

    const wallet = await loadWallet();
    const provider = new ElectrumNetworkProvider('chipnet');
    const relayerAddr = (wallet as any).cashaddr as string;
    const relayerTokAddr = (wallet as any).tokenaddr as string;
    info(`Wallet cashaddr:    ${relayerAddr}`);
    info(`Wallet tokenaddr:   ${relayerTokAddr}`);

    // Verify relayer API is up
    try {
        const health = await apiGet('/health');
        pass(`Relayer API healthy (network=${health.network}, watching=${health.watching})`);
    } catch (e: any) {
        fail(`Relayer API at ${RELAYER_API} not reachable: ${e.message}`);
        info('Start with: PORT=3006 RELAYER_PRIVATE_KEY_WIF=$WIF npm start');
        return;
    }

    // ── 1. Liquidity Pre-positioning Stage ───────────────────────────────────
    info('Checking current token inventory for viable DIRECT UTXO...');
    const cache = CauldronPoolCache.forNetwork('chipnet');
    const pools = await cache.getPools();
    const spotFP = SpreadQuant.spotPriceSatsPerToken(pools, EGGS);
    const spotPerToken = spotFP / SpreadQuant.PRICE_SCALE;
    info(`EGGS spot: ${spotPerToken.toFixed(2)} sats/EGG`);

    const utxos1 = await provider.getUtxos(relayerAddr);
    const utxos2 = await provider.getUtxos(relayerTokAddr);
    const seen = new Set<string>();
    const uniqUtxos = [...utxos1, ...utxos2].filter((u: any) => {
        const k = `${u.txid}:${u.vout}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });

    const MIN_DIRECT_TOKEN_BCH_DUST = 3500n;
    let viableUtxo = uniqUtxos.find((u: any) =>
        u.token?.category === EGGS
        && BigInt(u.token.amount) >= BUY_AMOUNT
        && BigInt(u.satoshis) >= MIN_DIRECT_TOKEN_BCH_DUST
    );

    if (viableUtxo) {
        pass(`Found viable DIRECT UTXO: ${viableUtxo.txid}:${viableUtxo.vout} (${viableUtxo.token!.amount} EGGS, ${viableUtxo.satoshis} sats BCH dust)`);
    } else {
        info('No single EGGS UTXO has >= 1000 EGGS and >= 3500 sats dust. Resolving liquidity...');
        const totalEggs = uniqUtxos
            .filter((u: any) => u.token?.category === EGGS)
            .reduce((s, u: any) => s + BigInt(u.token!.amount), 0n);

        if (totalEggs >= BUY_AMOUNT) {
            info(`Total EGGS balance is ${totalEggs}. Consolidating/splitting into a viable dust-heavy UTXO...`);
            const splitTxid = await prePositionEggs(wallet, BUY_AMOUNT, provider);
            pass(`Liquidity consolidated/pre-positioned in tx: ${splitTxid}`);
            info('Waiting for consolidating transaction to propagate...');
            const success = await cache.refresh().then(() => new CauldronRouter(cache).waitForUtxo(splitTxid, relayerTokAddr, provider, 30_000));
            if (!success) {
                fail('Consolidating tx did not propagate in time.');
                return;
            }
        } else {
            info(`Total EGGS balance is ${totalEggs} (less than ${BUY_AMOUNT}). Bypassing direct pre-positioning by executing Cauldron pre-fill swap...`);
            // Execute a Cauldron pre-fill swap using CauldronRouter locally to buy EGGS with 5,000 sats BCH dust
            const localRouter = new CauldronRouter(cache);
            const fakeSolution: any = {
                currentPrice: BUY_AMOUNT,
                params: {
                    sellTokenCategory: '0x',
                    buyTokenCategory: `0x${EGGS}`,
                    sellAmount: 30_000n,
                },
                isExpired: false,
            };
            const quote = await localRouter.quote(fakeSolution, uniqUtxos);
            if (!quote.profitable || !quote.preFillTrade) {
                fail(`Local Cauldron pre-fill quote failed or unprofitable: ${quote.reason}`);
                return;
            }
            const walletInfo = {
                privateKey: (wallet as any).privateKey as Uint8Array,
                publicKeyHash: (wallet as any).publicKeyHash as Uint8Array,
                cashaddr: relayerAddr,
                tokenaddr: relayerTokAddr,
            };
            info('Constructing and broadcasting Cauldron swap transaction...');
            const preResult = await localRouter.executePrefill(quote, uniqUtxos, walletInfo, provider);
            const preTxid = preResult.txid;
            pass(`Cauldron pre-fill swap completed: ${preTxid}`);
            info('Waiting for pre-fill swap to propagate...');
            const success = await localRouter.waitForUtxo(preTxid, relayerTokAddr, provider, 45_000);
            if (!success) {
                fail('Pre-fill swap did not propagate.');
                return;
            }
        }

        // Re-query to verify the viable UTXO exists now
        const freshUtxos1 = await provider.getUtxos(relayerAddr);
        const freshUtxos2 = await provider.getUtxos(relayerTokAddr);
        const freshSeen = new Set<string>();
        const freshUniq = [...freshUtxos1, ...freshUtxos2].filter((u: any) => {
            const k = `${u.txid}:${u.vout}`;
            if (freshSeen.has(k)) return false;
            freshSeen.add(k);
            return true;
        });

        viableUtxo = freshUniq.find((u: any) =>
            u.token?.category === EGGS
            && BigInt(u.token.amount) >= BUY_AMOUNT
            && BigInt(u.satoshis) >= MIN_DIRECT_TOKEN_BCH_DUST
        );
        if (!viableUtxo) {
            fail('Pre-positioning failed: viable UTXO still not found.');
            return;
        }
        pass(`Liquidity successfully pre-positioned: ${viableUtxo.txid}:${viableUtxo.vout} (${viableUtxo.token!.amount} EGGS, ${viableUtxo.satoshis} sats dust)`);
    }

    // ── 2. Create the BCH→EGGS Limit Intent ──────────────────────────────────
    const sellAmount = 30_000n; // profitable spread for 1000 EGGS (~18.8k sats spot)
    info(`Creating BCH→EGGS limit order intent: sellAmount=${sellAmount} sats, buyAmount=${BUY_AMOUNT} EGGS`);

    const intentRes = await apiPost('/intent/create', {
        makerAddress: relayerAddr,
        sellToken: 'BCH',
        buyToken: EGGS,
        sellAmount: sellAmount.toString(),
        buyAmount: BUY_AMOUNT.toString(),
        orderType: 'limit',
        expiryTime: Math.floor(Date.now() / 1000) + 1200,
        network: 'chipnet',
    });

    if (!intentRes.success) {
        fail(`Intent creation failed: ${intentRes.error}`);
        return;
    }
    pass(`Intent created: ${intentRes.intentId}`);
    info(`Contract address: ${intentRes.contractAddress}`);

    // ── 3. Assert Route Selected is DIRECT ───────────────────────────────────
    info('Calling CauldronRouter quote locally to verify route selection...');
    const localRouter = new CauldronRouter(cache, 1n);
    const freshUtxos1 = await provider.getUtxos(relayerAddr);
    const freshUtxos2 = await provider.getUtxos(relayerTokAddr);
    const freshSeen = new Set<string>();
    const freshUniq = [...freshUtxos1, ...freshUtxos2].filter((u: any) => {
        const k = `${u.txid}:${u.vout}`;
        if (freshSeen.has(k)) return false;
        freshSeen.add(k);
        return true;
    });

    const fakeSolution: any = {
        currentPrice: BUY_AMOUNT,
        params: {
            sellTokenCategory: '0x',
            buyTokenCategory: `0x${EGGS}`,
            sellAmount: sellAmount,
        },
        isExpired: false,
    };
    const quote = await localRouter.quote(fakeSolution, freshUniq);
    info(`Router quote result: routeType=${quote.routeType} profitable=${quote.profitable} reason=${quote.reason}`);
    
    assert.strictEqual(quote.routeType, 'DIRECT', 'Router must select DIRECT route when viable token UTXO exists');
    assert.strictEqual(quote.preFillTrade, null, 'DIRECT route must have no preFillTrade');
    assert.strictEqual(quote.profitable, true, 'DIRECT route should be profitable');
    pass('DIRECT routing strategy validated in CauldronRouter.quote()');

    // ── 4. Fund & Monitor E2E DIRECT swap ────────────────────────────────────
    // Force relayer to refresh pool cache so it has the same view
    await apiPost('/router/refresh-pools');

    // WS subscription
    const fillPromise = waitForFillEvent(intentRes.intentId, FILL_TIMEOUT_MS);

    // Fund covenant on-chain
    info('Funding on-chain covenant...');
    const fundTxid = await fundCovenant(wallet, intentRes.contractAddress, sellAmount, provider);
    pass(`Covenant funded: ${fundTxid}`);

    // Wait for fill
    info(`⏳ Waiting for bot to fill using DIRECT route (timeout ${FILL_TIMEOUT_MS/1000}s)...`);
    let fillData: any;
    try {
        fillData = await fillPromise;
    } catch (e: any) {
        fail(`Fill not received: ${e.message}`);
        return;
    }

    // ── 5. E2E Assertions ────────────────────────────────────────────────────
    banner('E2E Assertions');
    info(`Fill txid:       ${fillData.fillTxid}`);
    info(`Route type:      ${fillData.routeType}`);
    info(`Profit (sats):   ${fillData.netProfitSats}`);
    info(`Pre-fill txid:   ${fillData.preFillTxid ?? 'NONE (Expected for DIRECT)'}`);
    info(`Post-fill txid:  ${fillData.postFillTxid ?? 'NONE (Expected for DIRECT)'}`);

    assert.strictEqual(fillData.routeType, 'DIRECT', 'Relayer bot must fill using DIRECT route');
    assert.strictEqual(fillData.preFillTxid, undefined, 'No pre-fill swap should be executed');
    assert.strictEqual(fillData.postFillTxid, undefined, 'No post-fill rebalance should be executed');
    pass('DIRECT E2E fill succeeded on-chain with zero Cauldron trades!');

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  E2E DIRECT SWAP VERIFICATION PASSED ✅');
    console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
