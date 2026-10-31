/**
 * E2E direct-fulfillment ONLY test.
 *
 * Verifies that when the relayer has abundant direct token liquidity, it
 * completes a limit order using a DIRECT route. Unlike e2e_direct_liquidity,
 * this test skips Cauldron pool lookups or pre-fills, and strictly asserts
 * that existing inventory is used to fill an intent.
 */

import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider, TransactionBuilder, SignatureTemplate } from 'cashscript';
import WebSocket from 'ws';
import * as fs from 'fs';
import * as assert from 'assert';
import 'dotenv/config';

// One of the heavily-stocked tokens in the solver wallet
const TARGET_TOKEN = '8852fd9f552c0387d81534c3b874efbd59124cfab50bc2b4b170e47f07b684bc';
const RELAYER_API = process.env.RELAYER_API_URL ?? 'http://localhost:3006';
const FILL_TIMEOUT_MS = 240000; 
const BUY_AMOUNT = 1000n; // 1000 units
const SELL_AMOUNT = 10000n; // arbitrary BCH amount

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
    let walletData;
    if (fs.existsSync(walletPath)) {
        walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    } else {
        walletData = JSON.parse(fs.readFileSync('./wallet.json', 'utf8'));
    }
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

/** pre-position direct token liquidity by consolidating/splitting existing tokens into a single 5000-sat output */
async function prePositionTokens(wallet: TestNetWallet, buyAmount: bigint, provider: ElectrumNetworkProvider): Promise<string> {
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

    const tokenUtxos = uniq.filter((u: any) => u.token?.category === TARGET_TOKEN);
    const bchUtxos  = uniq.filter((u: any) => !u.token);
    
    const totalAvail = tokenUtxos.reduce((s, u: any) => s + BigInt(u.token!.amount), 0n);
    if (totalAvail < buyAmount) {
        throw new Error(`Insufficient tokens in wallet to pre-position DIRECT liquidity: have ${totalAvail}, need ${buyAmount}`);
    }

    const wif = (wallet as any).privateKeyWif as string;
    const sig = new SignatureTemplate(wif);
    const tb = new TransactionBuilder({ provider });

    let tokenInputSum = 0n;
    for (const u of tokenUtxos) {
        tb.addInput({
            txid: u.txid, vout: u.vout, satoshis: BigInt(u.satoshis),
            token: { amount: BigInt(u.token!.amount), category: TARGET_TOKEN }
        }, sig.unlockP2PKH());
        tokenInputSum += BigInt(u.token!.amount);
    }

    // Viable DIRECT fill UTXO requires 5000 sats BCH dust
    tb.addOutput({
        to: fromTok,
        amount: 5000n,
        token: { amount: buyAmount, category: TARGET_TOKEN }
    });

    const tokenChange = tokenInputSum - buyAmount;
    const txFee = 3000n;
    const needBch = 5000n + txFee + (tokenChange > 0n ? 1000n : 0n);
    
    let bchIn = tokenUtxos.reduce((s, u: any) => s + BigInt(u.satoshis), 0n);
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
            token: { amount: tokenChange, category: TARGET_TOKEN }
        });
    }

    const satChange = bchIn - 5000n - txFee - (tokenChange > 0n ? 1000n : 0n);
    if (satChange > 546n) {
        tb.addOutput({ to: fromAddr, amount: satChange });
    }

    const res = await tb.send();
    return res.txid;
}

// Helper to wait for utxo to propagate
async function waitForUtxoPropagation(txid: string, address: string, provider: ElectrumNetworkProvider, timeoutMs = 30000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const utxos = await provider.getUtxos(address);
        if (utxos.some((u: any) => u.txid === txid)) return true;
        await new Promise(r => setTimeout(r, 2000));
    }
    return false;
}

async function main() {
    banner('E2E Direct Fulfillment ONLY Test (chipnet)');
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
        pass(`Relayer API healthy`);
    } catch (e: any) {
        fail(`Relayer API at ${RELAYER_API} not reachable: ${e.message}`);
        return;
    }

    // ── 1. Check existing token inventory ───────────────────────────────────
    info('Checking current token inventory for DIRECT fulfillment capability...');
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
        u.token?.category === TARGET_TOKEN
        && BigInt(u.token.amount) >= BUY_AMOUNT
        && BigInt(u.satoshis) >= MIN_DIRECT_TOKEN_BCH_DUST
    );

    if (!viableUtxo) {
        info('No viable UTXO with >= 3500 sats dust found. Pre-positioning existing inventory...');
        const splitTxid = await prePositionTokens(wallet, BUY_AMOUNT, provider);
        pass(`Liquidity consolidated/pre-positioned with dust in tx: ${splitTxid}`);
        info('Waiting for consolidating transaction to propagate...');
        const success = await waitForUtxoPropagation(splitTxid, relayerTokAddr, provider);
        if (!success) {
            fail('Consolidating tx did not propagate in time.');
            return;
        }

        // Re-fetch
        const fresh1 = await provider.getUtxos(relayerAddr);
        const fresh2 = await provider.getUtxos(relayerTokAddr);
        viableUtxo = [...fresh1, ...fresh2].find((u: any) =>
            u.txid === splitTxid && u.token?.category === TARGET_TOKEN && BigInt(u.token.amount) >= BUY_AMOUNT
        );
        if (!viableUtxo) {
            fail('Pre-positioning failed to produce viable UTXO.');
            return;
        }
    }
    pass(`Found viable DIRECT UTXO: ${viableUtxo.txid}:${viableUtxo.vout} (${viableUtxo.token!.amount} tokens, ${viableUtxo.satoshis} sats BCH dust)`);

    // ── 2. Create Intent ─────────────────────────────────────────────────────
    info(`Creating BCH→Token limit order intent: sellAmount=${SELL_AMOUNT} sats, buyAmount=${BUY_AMOUNT} tokens`);

    const intentRes = await apiPost('/intent/create', {
        makerAddress: relayerAddr,
        sellToken: 'BCH',
        buyToken: TARGET_TOKEN,
        sellAmount: SELL_AMOUNT.toString(),
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

    // ── 3. Fund & Monitor E2E DIRECT swap ────────────────────────────────────
    // WS subscription
    const fillPromise = waitForFillEvent(intentRes.intentId, FILL_TIMEOUT_MS);

    info('Funding on-chain covenant...');
    const fundTxid = await fundCovenant(wallet, intentRes.contractAddress, SELL_AMOUNT, provider);
    pass(`Covenant funded: ${fundTxid}`);

    info(`⏳ Waiting for bot to fill using DIRECT route (timeout ${FILL_TIMEOUT_MS/1000}s)...`);
    let fillData: any;
    try {
        fillData = await fillPromise;
    } catch (e: any) {
        fail(`Fill not received: ${e.message}`);
        return;
    }

    // ── 4. E2E Assertions ────────────────────────────────────────────────────
    banner('E2E Assertions');
    info(`Fill txid:       ${fillData.fillTxid}`);
    info(`Route type:      ${fillData.routeType}`);
    info(`Pre-fill txid:   ${fillData.preFillTxid ?? 'NONE'}`);
    info(`Post-fill txid:  ${fillData.postFillTxid ?? 'NONE'}`);

    assert.strictEqual(fillData.routeType, 'DIRECT', 'Relayer bot must fill using DIRECT route');
    assert.strictEqual(fillData.preFillTxid, undefined, 'No pre-fill swap should be executed');
    assert.strictEqual(fillData.postFillTxid, undefined, 'No post-fill rebalance should be executed');
    pass('DIRECT E2E fill succeeded on-chain natively from inventory!');

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  E2E DIRECT SWAP ONLY VERIFICATION PASSED ✅');
    console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
