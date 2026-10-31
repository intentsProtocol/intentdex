/**
 * E2E — Limit Order early cancellation (cancelEarly()) against the LIVE relayer.
 *
 * Exercises the full stack added for maker-initiated early cancellation:
 *   - contracts-bch-swap: LimitOrderSwap.cash `cancelEarly(pubkey, sig)` branch
 *   - cashtoken-relayer:  POST /intent/:id/cancel verification + bookkeeping
 *
 * Scenario:
 *   1. Create a same-chain Limit Order (BCH → PUSD) via POST /intent/create,
 *      priced so far above fair value that the bot will NEVER find it
 *      profitable — guarantees no race with the bot's own fill logic while
 *      we test cancellation.
 *   2. Fund the covenant with real chipnet BCH.
 *   3. Build, sign (cancelEarly), and broadcast the maker's own cancel
 *      transaction directly against chipnet — exactly what the frontend's
 *      cancelSameChainOrder() does.
 *   4. Call POST /intent/:id/cancel with the txid and verify the relayer
 *      independently confirms it and marks the order "cancelled".
 *   5. Verify the covenant is empty and funds landed back in the maker's
 *      wallet.
 *   6. Negative checks: cancelling twice → 409; cancelling a Dutch Auction
 *      → 400 (early cancel is Limit-Order-only by design).
 *
 * Usage:
 *   RELAYER_API_URL=http://localhost:3006 npx tsx test/e2e_cancel_early.ts
 */
import { Contract, ElectrumNetworkProvider, SignatureTemplate, TransactionBuilder } from 'cashscript';
import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

const PUSD_TOKEN = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';
const RELAYER_API = process.env.RELAYER_API_URL ?? 'http://localhost:3006';
const ARTIFACT_FILE = path.resolve('../contracts-bch-swap/artifacts/LimitOrderSwap.json');

const pass   = (m: string) => { console.log(`  ✅ ${m}`); results.push({ name: m, passed: true }); };
const fail   = (m: string) => { console.error(`  ❌ ${m}`); results.push({ name: m, passed: false }); process.exitCode = 1; };
const info   = (m: string) => console.log(`  ℹ️  ${m}`);
const banner = (m: string) => console.log(`\n${'═'.repeat(72)}\n  ${m}\n${'═'.repeat(72)}`);
const sep    = (m: string) => console.log(`\n${'─'.repeat(72)}\n  ${m}\n${'─'.repeat(72)}`);
const sleep  = (ms: number) => new Promise(r => setTimeout(r, ms));
const reverseHex = (hex: string) => hex.match(/.{2}/g)!.reverse().join('');

const results: { name: string; passed: boolean }[] = [];

async function apiPost(p: string, body?: object) {
    const res = await fetch(`${RELAYER_API}${p}`, {
        method: 'POST',
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
}
async function apiGet(p: string) {
    const res = await fetch(`${RELAYER_API}${p}`);
    return { status: res.status, data: await res.json() };
}

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

async function main() {
    banner('E2E: Limit Order Early Cancellation (cancelEarly)');

    const wallet = await loadWallet();
    const makerAddress = (wallet as any).cashaddr as string;
    const provider = new ElectrumNetworkProvider('chipnet');
    const artifact = JSON.parse(fs.readFileSync(ARTIFACT_FILE, 'utf8'));
    info(`Wallet: ${makerAddress}`);

    // ── 1. Create an intentionally unfillable limit order (BCH → PUSD) ──────
    sep('Step 1: Create Limit Order (deliberately unprofitable — asks for 100x fair value)');
    const sellAmount = 20000n; // sats locked
    const buyAmount = 500n;    // PUSD units — absurdly high ask vs ~4650 sats/PUSD fair value,
                               // guarantees the bot's ProfitPolicy always rejects it as unprofitable.
    const expiryTime = Math.floor(Date.now() / 1000) + 3600;

    const createRes = await apiPost('/intent/create', {
        makerAddress,
        sellToken: 'BCH',
        buyToken: PUSD_TOKEN,
        sellAmount: sellAmount.toString(),
        buyAmount: buyAmount.toString(),
        orderType: 'limit',
        expiryTime,
        network: 'chipnet',
    });
    if (!createRes.data.success) { fail(`Intent creation failed: ${JSON.stringify(createRes.data)}`); return report(); }
    pass(`Intent created: ${createRes.data.intentId}`);
    info(`Contract: ${createRes.data.contractAddress}`);

    const intentId = createRes.data.intentId as string;
    const contractAddress = createRes.data.contractAddress as string;

    // ── 2. Fund the covenant ────────────────────────────────────────────────
    sep('Step 2: Fund the covenant');
    const fundTxid = await fundCovenantBch(wallet, contractAddress, sellAmount, provider);
    pass(`Covenant funded: ${fundTxid}`);
    info(`Explorer: https://chipnet.chaingraph.cash/tx/${fundTxid}`);

    // Give the bot a little time to see it and populate fundingTxid (exercises
    // the "strong" outpoint-match verification path in /intent/:id/cancel).
    // Not required for correctness — the endpoint falls back to a zero-UTXO
    // check if the bot hasn't scanned it yet — but worth giving it a chance.
    info('Waiting 12s for the bot to scan and mark the intent active...');
    await sleep(12000);

    // ── 3. Reconstruct the contract and build the cancelEarly() transaction ─
    sep('Step 3: Build & broadcast cancelEarly()');
    const makerPkh = await (wallet as any).getPublicKeyHash();
    // cashaddrs are derived from the COMPRESSED pubkey hash — getPublicKey() can
    // return the uncompressed form, which would make hash160(makerPk) != makerPkh
    // and the covenant would (correctly) reject the cancelEarly() unlock.
    const makerPk: Uint8Array = (wallet as any).publicKeyCompressed || (wallet as any).publicKey;
    const wif = (wallet as any).privateKeyWif as string;
    const sigTemplate = new SignatureTemplate(wif);

    const contract = new Contract(artifact, [
        makerPkh, '0x', `0x${reverseHex(PUSD_TOKEN)}`, sellAmount, buyAmount, BigInt(expiryTime),
    ], { provider });

    if (contract.address !== contractAddress) {
        fail(`Reconstructed contract address (${contract.address}) does not match created intent (${contractAddress})`);
        return report();
    }
    pass('Reconstructed contract address matches the created intent');

    const covenantUtxos = await provider.getUtxos(contract.address);
    if (!covenantUtxos.length) { fail('No unspent covenant UTXO found — funding may not have propagated yet'); return report(); }
    const covenantUtxo = covenantUtxos[0];

    const walletUtxos = (await provider.getUtxos(makerAddress)).filter((u: any) => !u.token);
    if (!walletUtxos.length) { fail('No plain BCH UTXOs in wallet to pay the cancellation fee'); return report(); }
    const feeUtxo = [...walletUtxos].sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)))[0];

    const tb = new TransactionBuilder({ provider });
    tb.addInput(
        { txid: covenantUtxo.txid, vout: covenantUtxo.vout, satoshis: BigInt(covenantUtxo.satoshis) },
        contract.unlock.cancelEarly(makerPk, sigTemplate),
    );
    tb.addInput({ txid: feeUtxo.txid, vout: feeUtxo.vout, satoshis: BigInt(feeUtxo.satoshis) }, sigTemplate.unlockP2PKH());

    const FEE = 1500n;
    const totalIn = BigInt(covenantUtxo.satoshis) + BigInt(feeUtxo.satoshis);
    const change = totalIn - sellAmount - FEE;
    tb.addOutput({ to: makerAddress, amount: sellAmount });
    if (change >= 546n) tb.addOutput({ to: makerAddress, amount: change });

    const cancelTx = await tb.send();
    const cancelTxid = cancelTx.txid;
    pass(`cancelEarly() broadcast: ${cancelTxid}`);
    info(`Explorer: https://chipnet.chaingraph.cash/tx/${cancelTxid}`);

    // ── 4. Notify the relayer ────────────────────────────────────────────────
    sep('Step 4: POST /intent/:id/cancel');
    await sleep(5000); // let Electrum catch up so the relayer's getUtxos()/getRawTransaction() sees it
    const cancelRes = await apiPost(`/intent/${intentId}/cancel`, { txid: cancelTxid });
    if (cancelRes.status === 200 && cancelRes.data.success) {
        pass(`Relayer verified and accepted the cancellation (intentId=${cancelRes.data.intentId})`);
    } else {
        fail(`Relayer rejected the cancellation: ${JSON.stringify(cancelRes.data)}`);
    }

    // ── 5. Verify order-book state ──────────────────────────────────────────
    sep('Step 5: Verify order book reflects "cancelled"');
    const intentRes = await apiGet(`/intent/${intentId}`);
    if (intentRes.data.status === 'cancelled' && intentRes.data.cancelTxid === cancelTxid) {
        pass(`Intent status = "cancelled", cancelTxid recorded correctly`);
    } else {
        fail(`Expected status=cancelled/cancelTxid=${cancelTxid}, got ${JSON.stringify({ status: intentRes.data.status, cancelTxid: intentRes.data.cancelTxid })}`);
    }

    const remainingUtxos = await provider.getUtxos(contract.address);
    if (remainingUtxos.length === 0) pass('Covenant address is empty — funds moved out on-chain');
    else fail(`Covenant still has ${remainingUtxos.length} UTXO(s) — cancel did not actually spend it`);

    // ── 6a. Negative: cancel an already-cancelled order ─────────────────────
    sep('Step 6a: Cancelling an already-cancelled order must be rejected (409)');
    const doubleCancel = await apiPost(`/intent/${intentId}/cancel`, { txid: cancelTxid });
    if (doubleCancel.status === 409) pass('Second cancel attempt correctly rejected with 409 (already cancelled)');
    else fail(`Expected 409 on double-cancel, got ${doubleCancel.status}: ${JSON.stringify(doubleCancel.data)}`);

    // ── 6b. Negative: cancel a Dutch Auction ────────────────────────────────
    sep('Step 6b: Early cancel must be rejected for Dutch Auctions (400)');
    const dutchRes = await apiPost('/intent/create', {
        makerAddress,
        sellToken: 'BCH',
        buyToken: PUSD_TOKEN,
        sellAmount: '20000',
        buyAmount: '500',
        orderType: 'dutch',
        duration: 3600,
        network: 'chipnet',
    });
    if (!dutchRes.data.success) {
        fail(`Dutch auction intent creation failed: ${JSON.stringify(dutchRes.data)}`);
    } else {
        const dutchCancel = await apiPost(`/intent/${dutchRes.data.intentId}/cancel`, { txid: '00'.repeat(32) });
        if (dutchCancel.status === 400) pass('Dutch Auction cancel attempt correctly rejected with 400 (Limit Orders only)');
        else fail(`Expected 400 for Dutch Auction cancel, got ${dutchCancel.status}: ${JSON.stringify(dutchCancel.data)}`);
    }

    return report();
}

async function fundCovenantBch(wallet: any, contractAddr: string, sellAmount: bigint, provider: ElectrumNetworkProvider): Promise<string> {
    const fromAddr = wallet.cashaddr as string;
    const utxos = await provider.getUtxos(fromAddr);
    const bchUtxos = utxos.filter((u: any) => !u.token).sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)));
    let sum = 0n;
    const inputs: any[] = [];
    for (const u of bchUtxos) {
        inputs.push(u);
        sum += BigInt(u.satoshis);
        if (sum >= sellAmount + 1500n) break;
    }
    if (sum < sellAmount + 1500n) throw new Error('Insufficient BCH to fund covenant');
    const sig = new SignatureTemplate(wallet.privateKeyWif as string);
    const tb = new TransactionBuilder({ provider });
    for (const u of inputs) tb.addInput({ txid: u.txid, vout: u.vout, satoshis: BigInt(u.satoshis) }, sig.unlockP2PKH());
    tb.addOutput({ to: contractAddr, amount: sellAmount });
    const change = sum - sellAmount - 1200n;
    if (change > 546n) tb.addOutput({ to: fromAddr, amount: change });
    const res = await tb.send();
    return res.txid;
}

function report() {
    const passedCount = results.filter(r => r.passed).length;
    banner(`RESULTS: ${passedCount}/${results.length} passed`);
    for (const r of results) console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}`);

    const reportPath = `test/reports/cancel_early_report_${Date.now()}.json`;
    try {
        fs.mkdirSync('test/reports', { recursive: true });
        fs.writeFileSync(reportPath, JSON.stringify({ timestamp: Date.now(), results }, null, 2));
        info(`Report saved: ${reportPath}`);
    } catch { /* best-effort */ }

    if (results.every(r => r.passed)) {
        console.log('\n  🎉 ALL EARLY-CANCEL E2E CHECKS PASSED\n');
    } else {
        console.log('\n  ⚠️  SOME EARLY-CANCEL E2E CHECKS FAILED\n');
    }
}

main().catch(e => { console.error('FATAL:', e); process.exitCode = 1; });
