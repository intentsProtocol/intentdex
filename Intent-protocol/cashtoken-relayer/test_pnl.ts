import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider, TransactionBuilder, SignatureTemplate } from 'cashscript';
import * as fs from 'fs';
import 'dotenv/config';
import WebSocket from 'ws';

const TARGET_TOKEN = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';
const RELAYER_API = 'http://localhost:3006';
const SELL_AMOUNT = 50000n; // User sells BCH
const BUY_AMOUNT = 5n; // User buys PUSD

async function apiPost(path: string, body: object) {
    const res = await fetch(`${RELAYER_API}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.json();
}

async function getTokenBalance(address: string, tokenId: string, provider: ElectrumNetworkProvider): Promise<bigint> {
    const utxos = await provider.getUtxos(address);
    let total = 0n;
    for (const u of utxos) {
        if (u.token && u.token.category === tokenId) {
            total += BigInt(u.token.amount);
        }
    }
    return total;
}

async function getBCHBalance(address: string, provider: ElectrumNetworkProvider): Promise<bigint> {
    const utxos = await provider.getUtxos(address);
    let total = 0n;
    for (const u of utxos) {
        total += BigInt(u.satoshis);
    }
    return total;
}

async function fundCovenant(wallet: TestNetWallet, contractAddr: string, sellAmount: bigint, provider: ElectrumNetworkProvider): Promise<string> {
    const fromAddr = (wallet as any).cashaddr as string;
    const utxos = await provider.getUtxos(fromAddr);
    const bchUtxos = utxos.filter((u: any) => !u.token).sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)));

    let sum = 0n;
    const inputs = [];
    for (const u of bchUtxos) {
        inputs.push(u);
        sum += BigInt(u.satoshis);
        if (sum >= sellAmount + 500n) break;
    }

    if (sum < sellAmount + 500n) throw new Error('Insufficient BCH to fund intent covenant');

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

    const tx = await tb.send();
    return tx.txid;
}

function waitForFillEvent(intentId: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
        const wsUrl = RELAYER_API.replace(/^http/, 'ws') + '/ws';
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => { ws.close(); reject(new Error(`fill timeout`)); }, timeoutMs);
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

async function main() {
    console.log("=== P&L E2E Test ===");
    const provider = new ElectrumNetworkProvider('chipnet');

    // Fetch USD price
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd');
    const data = await res.json();
    const bchPrice = data['bitcoin-cash'].usd;
    console.log(`BCH Price: $${bchPrice}`);

    const satsToUsd = (sats: bigint) => `$${((Number(sats) / 1e8) * bchPrice).toFixed(4)}`;

    // Setup Wallets
    const walletData = JSON.parse(fs.readFileSync('wallet.json', 'utf8'));
    const userWallet = await TestNetWallet.fromWIF(walletData.wif);
    const userAddr = (userWallet as any).cashaddr;

    const solverWif = process.env.RELAYER_PRIVATE_KEY_WIF;
    if (!solverWif) throw new Error("No solver WIF");
    const solverWallet = await TestNetWallet.fromWIF(solverWif);
    const solverAddr = (solverWallet as any).cashaddr;

    console.log(`User Address: ${userAddr}`);
    console.log(`Solver Address: ${solverAddr}`);

    // Initial Balances
    const userInitialBCH = await getBCHBalance(userAddr, provider);
    const userInitialPUSD = await getTokenBalance(userAddr, TARGET_TOKEN, provider);
    const solverInitialBCH = await getBCHBalance(solverAddr, provider);
    const solverInitialPUSD = await getTokenBalance(solverAddr, TARGET_TOKEN, provider);

    console.log("\n[BEFORE]");
    console.log(`User:   BCH: ${userInitialBCH} sats (${satsToUsd(userInitialBCH)}) | PUSD: ${userInitialPUSD}`);
    console.log(`Solver: BCH: ${solverInitialBCH} sats (${satsToUsd(solverInitialBCH)}) | PUSD: ${solverInitialPUSD}`);

    // Create Intent
    console.log("\nCreating limit intent (User sells 50,000 sats, buys 5 PUSD)...");
    const createRes = await apiPost('/intent/create', {
        makerAddress: userAddr,
        sellToken: 'BCH',
        buyToken: TARGET_TOKEN,
        sellAmount: SELL_AMOUNT.toString(),
        buyAmount: BUY_AMOUNT.toString(),
        orderType: 'limit',
        expiryTime: Math.floor(Date.now() / 1000) + 1200,
        network: 'chipnet',
    });

    if (!createRes.success) throw new Error(`Create failed: ${JSON.stringify(createRes)}`);
    const { intentId, contractAddress } = createRes;
    console.log(`Intent ID: ${intentId}`);
    console.log(`Contract: ${contractAddress}`);

    // Fund Covenant
    console.log("Funding covenant...");
    const fundTxid = await fundCovenant(userWallet, contractAddress, SELL_AMOUNT, provider);
    console.log(`Funded in TX: ${fundTxid}`);

    // Wait for fill
    console.log("Waiting for solver to fill intent...");
    try {
        const fillData = await waitForFillEvent(intentId, 120000);
        console.log(`✅ Intent Filled! Fill TX: ${fillData.fillTxid}`);
    } catch (e: any) {
        throw new Error(`Intent was not filled within timeout! ${e.message}`);
    }

    // Wait a moment for blockchain indexing / balance sync
    console.log("\nWaiting for blockchain balance sync (10s)...");
    await new Promise(r => setTimeout(r, 10000));

    // Final Balances
    const userFinalBCH = await getBCHBalance(userAddr, provider);
    const userFinalPUSD = await getTokenBalance(userAddr, TARGET_TOKEN, provider);
    const solverFinalBCH = await getBCHBalance(solverAddr, provider);
    const solverFinalPUSD = await getTokenBalance(solverAddr, TARGET_TOKEN, provider);

    console.log("\n[AFTER]");
    console.log(`User:   BCH: ${userFinalBCH} sats (${satsToUsd(userFinalBCH)}) | PUSD: ${userFinalPUSD}`);
    console.log(`Solver: BCH: ${solverFinalBCH} sats (${satsToUsd(solverFinalBCH)}) | PUSD: ${solverFinalPUSD}`);

    // PNL
    console.log("\n=== P&L SUMMARY ===");
    const userPnlBch = userFinalBCH - userInitialBCH;
    const userPnlPusd = userFinalPUSD - userInitialPUSD;
    const solverPnlBch = solverFinalBCH - solverInitialBCH;
    const solverPnlPusd = solverFinalPUSD - solverInitialPUSD;

    const formatPnl = (sats: bigint) => {
        const sign = sats >= 0n ? '+' : '';
        const absSats = sats >= 0n ? sats : -sats;
        const usdStr = sats >= 0n ? satsToUsd(sats) : '-' + satsToUsd(absSats);
        return `${sign}${sats} sats (${usdStr})`;
    };

    console.log(`USER P&L:   BCH: ${formatPnl(userPnlBch)} | PUSD: ${userPnlPusd > 0n ? '+' : ''}${userPnlPusd}`);
    console.log(`SOLVER P&L: BCH: ${formatPnl(solverPnlBch)} | PUSD: ${solverPnlPusd > 0n ? '+' : ''}${solverPnlPusd}`);
    console.log("\nNote: The user's BCH P&L includes the network fee paid for the funding transaction.");
}

main().catch(console.error);
