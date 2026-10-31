import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider, TransactionBuilder, SignatureTemplate } from 'cashscript';
import WebSocket from 'ws';
import * as fs from 'fs';
import * as assert from 'assert';
import 'dotenv/config';

// On chipnet PUSD pool: 1 PUSD unit ≈ 4650 sats fair value
// Solver profit = SELL_AMOUNT - fairValue(BUY_AMOUNT) - ~1300 fee must exceed 1500 sats floor
// With BUY_AMOUNT=5 PUSD: fairValue ≈ 23250 sats → SELL_AMOUNT=50000 gives ~25450 sats profit ✅
const TARGET_TOKEN = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';
const RELAYER_API = process.env.RELAYER_API_URL ?? 'http://localhost:3006';
const FILL_TIMEOUT_MS = 240000; 
const INTENT_COUNT = 3;
const BUY_AMOUNT = 5n; // 5 PUSD units per intent
const SELL_AMOUNT = 50000n; // 50000 sats BCH per intent — ~25450 sats profit after fair value + fees

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

// Creates an un-funded intent limit order
async function createIntent(wallet: TestNetWallet, sellAmount: bigint, buyAmount: bigint) {
    const fromAddr = (wallet as any).cashaddr as string;
    const body = {
        makerAddress: fromAddr,
        sellToken: 'BCH',
        buyToken: TARGET_TOKEN,
        sellAmount: sellAmount.toString(),
        buyAmount: buyAmount.toString(),
        orderType: 'limit',
        expiryTime: Math.floor(Date.now() / 1000) + 1200,
        network: 'chipnet',
    };
    const result = await apiPost('/intent/create', body);
    if (!result.success) {
        throw new Error(`Failed to create limit intent: ${JSON.stringify(result)}`);
    }
    return { intentId: result.intentId, contractAddress: result.contractAddress };
}

// Funds an intent's covenant
async function fundCovenant(wallet: TestNetWallet, contractAddr: string, sellAmount: bigint, provider: ElectrumNetworkProvider): Promise<string> {
    const fromAddr = (wallet as any).cashaddr as string;
    const utxos = await provider.getUtxos(fromAddr);
    const bchUtxos = utxos.filter((u: any) => !u.token).sort((a, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)));

    let sum = 0n;
    const inputs = [];
    for (const u of bchUtxos) {
        inputs.push(u);
        sum += BigInt(u.satoshis);
        if (sum >= sellAmount + 500n) break;
    }

    if (sum < sellAmount + 500n) {
        throw new Error('Insufficient BCH to fund intent covenant');
    }

    const wif = (wallet as any).privateKeyWif as string;
    const sig = new SignatureTemplate(wif);
    const tb = new TransactionBuilder({ provider });

    for (const input of inputs) {
        tb.addInput({ txid: input.txid, vout: input.vout, satoshis: BigInt(input.satoshis) }, sig.unlockP2PKH());
    }

    tb.addOutput({ to: contractAddr, amount: sellAmount });

    const change = sum - sellAmount - 300n;
    if (change > 546n) {
        tb.addOutput({ to: fromAddr, amount: change });
    }

    const result = await tb.send();
    return result.txid;
}

/** Pre-position direct token liquidity into MULTIPLE utxos (1 per intent) */
async function prePositionTokensForMultiple(wallet: TestNetWallet, buyAmountPerIntent: bigint, count: number, provider: ElectrumNetworkProvider): Promise<string> {
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
    
    const totalRequired = buyAmountPerIntent * BigInt(count);
    const totalAvail = tokenUtxos.reduce((s, u: any) => s + BigInt(u.token!.amount), 0n);
    if (totalAvail < totalRequired) {
        throw new Error(`Insufficient PUSD in wallet to pre-position DIRECT liquidity: have ${totalAvail}, need ${totalRequired}`);
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

    // Create `count` outputs with 5000 sats BCH dust each
    for (let i = 0; i < count; i++) {
        tb.addOutput({
            to: fromTok,
            amount: 5000n,
            token: { amount: buyAmountPerIntent, category: TARGET_TOKEN }
        });
    }

    const tokenChange = tokenInputSum - totalRequired;
    const txFee = 3000n;
    const totalDust = 5000n * BigInt(count);
    const needBch = totalDust + txFee + (tokenChange > 0n ? 1000n : 0n);
    
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

    const satChange = bchIn - totalDust - txFee - (tokenChange > 0n ? 1000n : 0n);
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

async function waitForFills(intentIds: string[], timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const wsUrl = RELAYER_API.replace('http', 'ws') + '/ws';
        const ws = new WebSocket(wsUrl);
        const pending = new Set(intentIds);

        const timer = setTimeout(() => {
            ws.close();
            reject(new Error(`fill timeout after ${timeoutMs/1000}s. Pending: ${Array.from(pending).join(', ')}`));
        }, timeoutMs);

        ws.on('open', () => {
            info('WS connected, listening for fill events...');
        });

        ws.on('message', (raw: any) => {
            try {
                const msg = JSON.parse(raw.toString());
                const type = msg.type as string;
                const data = msg.data ?? msg;

                // router:fill — fires immediately after tx broadcast
                if (type === 'router:fill' && data.intentId) {
                    if (pending.has(data.intentId)) {
                        pass(`Intent ${data.intentId} → DIRECT fill tx: ${data.fillTxid}`);
                        pending.delete(data.intentId);
                    }
                }
                // intent:filled — fires when the scanner confirms the fill on-chain
                if ((type === 'intent:filled' || type === 'intent:updated') && data.id) {
                    if (pending.has(data.id) && data.status === 'filled') {
                        pass(`Intent ${data.id} confirmed filled (route: ${data.routeType ?? 'DIRECT'})`);
                        pending.delete(data.id);
                    }
                }

                if (pending.size === 0) {
                    clearTimeout(timer);
                    ws.close();
                    resolve();
                }
            } catch (_) {}
        });

        ws.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

async function main() {
    banner(`E2E Multiple Direct Fills Test (${INTENT_COUNT} intents)`);
    info(`Relayer API: ${RELAYER_API}`);

    const wallet = await loadWallet();
    const provider = new ElectrumNetworkProvider('chipnet');
    const relayerAddr = (wallet as any).cashaddr as string;
    const relayerTokAddr = (wallet as any).tokenaddr as string;
    info(`Wallet cashaddr:    ${relayerAddr}`);
    info(`Wallet tokenaddr:   ${relayerTokAddr}`);

    // Verify relayer API is up
    try {
        await apiGet('/health');
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
    // We need INTENT_COUNT utxos, each with >= BUY_AMOUNT and >= MIN_DIRECT_TOKEN_BCH_DUST
    const viableUtxos = uniqUtxos.filter((u: any) =>
        u.token?.category === TARGET_TOKEN
        && BigInt(u.token.amount) >= BUY_AMOUNT
        && BigInt(u.satoshis) >= MIN_DIRECT_TOKEN_BCH_DUST
    );

    if (viableUtxos.length < INTENT_COUNT) {
        info(`Found ${viableUtxos.length} viable UTXOs, need ${INTENT_COUNT}. Pre-positioning existing inventory...`);
        const splitTxid = await prePositionTokensForMultiple(wallet, BUY_AMOUNT, INTENT_COUNT, provider);
        pass(`Liquidity consolidated/pre-positioned into ${INTENT_COUNT} UTXOs in tx: ${splitTxid}`);
        info('Waiting for consolidating transaction to propagate...');
        const success = await waitForUtxoPropagation(splitTxid, relayerTokAddr, provider);
        if (!success) {
            fail('Consolidating tx did not propagate in time.');
            return;
        }
    } else {
        pass(`Found ${viableUtxos.length} viable DIRECT UTXOs!`);
    }

    // ── 2. Create Multiple Intents ───────────────────────────────────
    const intentIds: string[] = [];
    const contracts: string[] = [];

    info(`Creating ${INTENT_COUNT} simultaneous BCH→PUSD limit order intents: sellAmount=${SELL_AMOUNT} sats, buyAmount=${BUY_AMOUNT} PUSD`);
    for (let i = 0; i < INTENT_COUNT; i++) {
        const result = await createIntent(wallet, SELL_AMOUNT, BUY_AMOUNT);
        intentIds.push(result.intentId);
        contracts.push(result.contractAddress);
        pass(`Intent ${i+1} created: ${result.intentId}`);
    }

    // ── 3. Fund Intents ───────────────────────────────────
    info(`Funding ${INTENT_COUNT} on-chain covenants...`);
    for (let i = 0; i < INTENT_COUNT; i++) {
        const fundTx = await fundCovenant(wallet, contracts[i], SELL_AMOUNT, provider);
        pass(`Covenant ${i+1} funded: ${fundTx}`);
        await new Promise(r => setTimeout(r, 1000)); // slight delay to ensure correct order
    }

    // ── 4. Wait for Fills ───────────────────────────────────
    info(`⏳ Waiting for bot to fill all ${INTENT_COUNT} intents using DIRECT route (timeout ${FILL_TIMEOUT_MS/1000}s)...`);
    
    try {
        await waitForFills(intentIds, FILL_TIMEOUT_MS);
        pass(`All ${INTENT_COUNT} intents were successfully filled natively from inventory!`);
    } catch (e: any) {
        fail(e.message);
    }
}

main().catch(e => fail(e.message));
