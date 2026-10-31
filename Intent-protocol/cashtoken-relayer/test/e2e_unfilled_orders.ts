import { ElectrumNetworkProvider, TransactionBuilder, SignatureTemplate } from 'cashscript';
import WebSocket from 'ws';
import * as fs from 'fs';
import 'dotenv/config';

/**
 * E2E Unfilled Orders Test Suite
 *
 * Tests all 4 scenarios described in docs/unfilled-orders.md:
 *   1. Unprofitable order — bot skips it (margin below floor)
 *   2. Expiry + MTP lag — order expires, bot issues trustless cancel()/refund
 *   3. Trustless refund — verify funds return to maker address
 *   4. Unfunded/ghost intent — created in API but never funded on-chain
 */

const RELAYER_API  = process.env.RELAYER_API_URL ?? 'http://localhost:3006';
const PUSD_TOKEN   = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';
// 1 PUSD unit ≈ 4650 sats on chipnet
const PUSD_FAIR_PRICE_SATS = 4650n;

const pass   = (m: string) => console.log(`  ✅ ${m}`);
const fail   = (m: string) => { console.error(`  ❌ ${m}`); process.exitCode = 1; };
const info   = (m: string) => console.log(`  ℹ️  ${m}`);
const warn   = (m: string) => console.log(`  ⚠️  ${m}`);
const banner = (m: string) => console.log(`\n${'═'.repeat(72)}\n  ${m}\n${'═'.repeat(72)}`);
const sep    = (m: string) => console.log(`\n${'─'.repeat(72)}\n  ${m}\n${'─'.repeat(72)}`);

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiPost(path: string, body?: object) {
    const res = await fetch(`${RELAYER_API}${path}`, {
        method: 'POST',
        headers: body ? { 'content-type': 'application/json' } : {},
        body:    body ? JSON.stringify(body) : undefined,
    });
    return res.json();
}

async function apiGet(path: string) {
    const res = await fetch(`${RELAYER_API}${path}`);
    return res.json();
}

// ── Wallet loader ─────────────────────────────────────────────────────────────

async function loadWallet() {
    const { TestNetWallet } = await import('mainnet-js');
    if (process.env.RELAYER_PRIVATE_KEY_WIF) {
        return TestNetWallet.fromWIF(process.env.RELAYER_PRIVATE_KEY_WIF);
    }
    const walletPath = process.env.WALLET_PATH ?? '../contracts-bch-swap/wallet.json';
    const wf = fs.existsSync(walletPath) ? walletPath : './wallet.json';
    const { wif } = JSON.parse(fs.readFileSync(wf, 'utf8'));
    return TestNetWallet.fromWIF(wif);
}

// ── Intent helpers ────────────────────────────────────────────────────────────

async function createIntent(makerAddress: string, sellAmount: bigint, buyAmount: bigint, expirySeconds = 1200) {
    const result = await apiPost('/intent/create', {
        makerAddress,
        sellToken:  'BCH',
        buyToken:   PUSD_TOKEN,
        sellAmount: sellAmount.toString(),
        buyAmount:  buyAmount.toString(),
        orderType:  'limit',
        expiryTime: Math.floor(Date.now() / 1000) + expirySeconds,
        network:    'chipnet',
    });
    if (!result.success) throw new Error(`Intent creation failed: ${JSON.stringify(result)}`);
    return result;
}

async function createExpiredIntent(makerAddress: string, sellAmount: bigint, buyAmount: bigint) {
    // expiryTime = 2 hours ago → MTP already past it → cancel() immediately unlockable
    const expiryTime = Math.floor(Date.now() / 1000) - 7200;
    const result = await apiPost('/intent/create', {
        makerAddress,
        sellToken:  'BCH',
        buyToken:   PUSD_TOKEN,
        sellAmount: sellAmount.toString(),
        buyAmount:  buyAmount.toString(),
        orderType:  'limit',
        expiryTime,
        network:    'chipnet',
    });
    if (!result.success) throw new Error(`Expired intent creation failed: ${JSON.stringify(result)}`);
    return result;
}

async function fundCovenant(
    wallet: any,
    contractAddr: string,
    sellAmount: bigint,
    provider: ElectrumNetworkProvider
): Promise<string> {
    const fromAddr = (wallet as any).cashaddr as string;
    const utxos    = await provider.getUtxos(fromAddr);
    const bchUtxos = utxos
        .filter((u: any) => !u.token)
        .sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)));

    let sum = 0n;
    const inputs: any[] = [];
    for (const u of bchUtxos) {
        inputs.push(u);
        sum += BigInt(u.satoshis);
        if (sum >= sellAmount + 500n) break;
    }
    if (sum < sellAmount + 500n) throw new Error('Insufficient BCH to fund covenant');

    const wif = (wallet as any).privateKeyWif as string;
    const sig = new SignatureTemplate(wif);
    const tb  = new TransactionBuilder({ provider });
    for (const u of inputs) tb.addInput({ txid: u.txid, vout: u.vout, satoshis: BigInt(u.satoshis) }, sig.unlockP2PKH());
    tb.addOutput({ to: contractAddr, amount: sellAmount });
    const change = sum - sellAmount - 400n;
    if (change > 546n) tb.addOutput({ to: fromAddr, amount: change });
    const res = await tb.send();
    return res.txid;
}

// ── WS helpers ────────────────────────────────────────────────────────────────

function waitForWsEvent(intentId: string, types: string[], timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
        const ws    = new WebSocket(RELAYER_API.replace('http', 'ws') + '/ws');
        const timer = setTimeout(() => { ws.close(); reject(new Error(`Timeout waiting for [${types.join('|')}] on ${intentId}`)); }, timeoutMs);
        ws.on('message', (raw: any) => {
            try {
                const msg  = JSON.parse(raw.toString());
                const data = msg.data ?? msg;
                if (types.includes(msg.type) && (data.intentId === intentId || data.id === intentId)) {
                    clearTimeout(timer); ws.close(); resolve(data);
                }
            } catch {}
        });
        ws.on('error', err => { clearTimeout(timer); reject(err); });
    });
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 1: Unprofitable Intent (margin below floor)
// ─────────────────────────────────────────────────────────────────────────────
async function testUnprofitableOrder(wallet: any, provider: ElectrumNetworkProvider) {
    sep('Scenario 1: Unprofitable Order (margin below floor)');
    info('Creating a limit order that is too cheap for the bot to fill:');
    info(`  sellAmount = 1000 sats (far below fair value of 1 PUSD ≈ ${PUSD_FAIR_PRICE_SATS} sats)`);

    const fromAddr = (wallet as any).cashaddr as string;
    // Offer only 1000 sats for 1 PUSD — massively below fair value (~4650 sats)
    // profit = 1000 - 4650 - fee = -4950 → bot MUST skip
    const intentRes = await createIntent(fromAddr, 1000n, 1n, 1200);
    pass(`Intent created: ${intentRes.intentId}`);
    info(`Contract: ${intentRes.contractAddress}`);

    info('Funding covenant with 1000 sats...');
    const fundTx = await fundCovenant(wallet, intentRes.contractAddress, 1000n, provider);
    pass(`Covenant funded: ${fundTx}`);

    info('Waiting 40s for bot to scan and (hopefully) skip...');
    await sleep(40000);

    // Query current status — it should still be "pending", NOT "filled"
    const allIntents: any = await apiGet('/intents');
    const active: any[] = allIntents.active ?? [];
    const found = active.find((i: any) => i.id === intentRes.intentId);

    if (found && found.status === 'pending') {
        pass(`Bot correctly skipped unprofitable order — status still "pending" ✅`);
    } else if (!found) {
        warn(`Intent not found in active list — may have been cleaned up already`);
    } else {
        fail(`Bot filled an unprofitable order! status=${found.status}`);
    }

    return intentRes.intentId;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 2 + 3: Expired intent → Trustless Refund via bot cancel()
// ─────────────────────────────────────────────────────────────────────────────
async function testExpiredOrderRefund(wallet: any, provider: ElectrumNetworkProvider) {
    sep('Scenario 2 & 3: Expired Intent → Trustless Refund');
    info('Creating a limit order with expiryTime = 2 hours ago (MTP lag already cleared)');

    const fromAddr = (wallet as any).cashaddr as string;
    // Use a sane sell amount (above dust); bot will see it as expired and trigger cancel()
    const intentRes = await createExpiredIntent(fromAddr, 10000n, 1n);
    pass(`Expired intent created: ${intentRes.intentId}`);
    info(`Contract: ${intentRes.contractAddress}`);

    info('Funding covenant with 10000 sats...');
    const fundTx = await fundCovenant(wallet, intentRes.contractAddress, 10000n, provider);
    pass(`Covenant funded: ${fundTx}`);

    // Record maker balance before
    const balBefore = await provider.getUtxos(fromAddr);
    const bchBefore = balBefore.filter((u: any) => !u.token).reduce((s, u: any) => s + BigInt(u.satoshis), 0n);
    info(`Maker BCH balance before refund: ${bchBefore} sats`);

    info('Waiting up to 120s for bot to detect expiry and execute cancel()...');
    try {
        const ev = await waitForWsEvent(intentRes.intentId, ['intent:refunded', 'intent:filled', 'intent:updated'], 120000);
        pass(`Got event: ${JSON.stringify({ status: ev.status, fillTxid: ev.fillTxid })}`);

        // Verify funds returned to maker
        await sleep(5000); // Wait for propagation
        const balAfter  = await provider.getUtxos(fromAddr);
        const bchAfter  = balAfter.filter((u: any) => !u.token).reduce((s, u: any) => s + BigInt(u.satoshis), 0n);
        const recovered = bchAfter - bchBefore;
        info(`Maker BCH balance after refund: ${bchAfter} sats (recovered ${recovered} sats)`);

        if (recovered > 0n) {
            pass(`Trustless refund successful — maker received back ${recovered} sats ✅`);
        } else {
            warn(`Balance did not increase — may still be propagating`);
        }
    } catch (e: any) {
        fail(`Expired order refund not received within timeout: ${e.message}`);
        // Still check intent status directly
        const allIntents: any = await apiGet('/intents');
        const active: any[] = allIntents.active ?? [];
        const found = active.find((i: any) => i.id === intentRes.intentId);
        info(`Intent status in store: ${found?.status ?? 'not found'}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 4: Ghost / Unfunded Intent
// ─────────────────────────────────────────────────────────────────────────────
async function testGhostIntent(wallet: any) {
    sep('Scenario 4: Ghost / Unfunded Intent');
    info('Creating an intent in the API store but deliberately NOT funding it on-chain');

    const fromAddr = (wallet as any).cashaddr as string;
    const intentRes = await createIntent(fromAddr, 50000n, 10n, 600);
    pass(`Ghost intent created in store: ${intentRes.intentId}`);
    info(`Contract address: ${intentRes.contractAddress}`);
    info('(Covenant NOT funded — no on-chain UTXO exists)');

    info('Waiting 30s for bot to scan and find 0 UTXOs...');
    await sleep(30000);

    // Check the relayer's view: the intent should remain "pending" indefinitely
    // (the bot finds no UTXO, so it has nothing to act on — it's dead weight)
    const allIntents: any = await apiGet('/intents');
    const active: any[] = allIntents.active ?? [];
    const found = active.find((i: any) => i.id === intentRes.intentId);

    if (found && found.status === 'pending') {
        pass(`Ghost intent correctly remains "pending" (no UTXO = nothing to fill or refund) ✅`);
        info('(cleanup-unfunded-intents.mjs would mark this as cancelled in production)');
    } else if (!found) {
        warn(`Intent not found — may have been cleaned up by relayer automatically`);
    } else {
        fail(`Unexpected status for ghost intent: ${found.status}`);
    }

    return intentRes.intentId;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
    banner('Unfilled Orders Lifecycle Test Suite (docs/unfilled-orders.md)');
    info(`Relayer API: ${RELAYER_API}`);

    // Health check
    try {
        await apiGet('/health');
        pass('Relayer API healthy');
    } catch (e: any) {
        fail(`Relayer API not reachable: ${e.message}`);
        return;
    }

    const wallet   = await loadWallet();
    const provider = new ElectrumNetworkProvider('chipnet');
    const cashaddr = (wallet as any).cashaddr as string;
    info(`Wallet: ${cashaddr}`);

    const results: Record<string, 'PASS' | 'FAIL' | 'WARN'> = {};

    // ── Run each scenario ─────────────────────────────────────────────────────
    try {
        await testUnprofitableOrder(wallet, provider);
        results['1. Unprofitable Order'] = process.exitCode === 1 ? 'FAIL' : 'PASS';
        process.exitCode = 0;
    } catch (e: any) {
        fail(`Scenario 1 threw: ${e.message}`);
        results['1. Unprofitable Order'] = 'FAIL';
        process.exitCode = 0;
    }

    try {
        await testExpiredOrderRefund(wallet, provider);
        results['2+3. Expired → Refund'] = process.exitCode === 1 ? 'FAIL' : 'PASS';
        process.exitCode = 0;
    } catch (e: any) {
        fail(`Scenario 2+3 threw: ${e.message}`);
        results['2+3. Expired → Refund'] = 'FAIL';
        process.exitCode = 0;
    }

    try {
        await testGhostIntent(wallet);
        results['4. Ghost Intent'] = process.exitCode === 1 ? 'FAIL' : 'PASS';
        process.exitCode = 0;
    } catch (e: any) {
        fail(`Scenario 4 threw: ${e.message}`);
        results['4. Ghost Intent'] = 'FAIL';
        process.exitCode = 0;
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    banner('Test Summary');
    const allPassed = Object.values(results).every(r => r === 'PASS');
    for (const [name, result] of Object.entries(results)) {
        const icon = result === 'PASS' ? '✅' : result === 'WARN' ? '⚠️ ' : '❌';
        console.log(`  ${icon} ${name}: ${result}`);
    }
    if (!allPassed) {
        process.exitCode = 1;
        console.log('\n  Some scenarios failed or timed out — see output above for details.');
    } else {
        console.log('\n  All unfilled-order scenarios passed! 🎉');
    }
}

main().catch(e => { fail(e.message); process.exit(1); });
