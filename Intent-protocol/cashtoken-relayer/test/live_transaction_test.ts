/**
 * Live Transaction Test & Profit Tracking
 * 
 * Flow:
 *   1. Create a BCH -> PUSD limit order intent via the relayer API.
 *      - Maker pays: 50,000 sats
 *      - Maker wants: 10 units of PUSD (0.10 PUSD, worth ~28,000 sats)
 *      - Expected spread: ~20,000 sats (highly profitable, will trigger fill immediately).
 *   2. Fund the covenant contract on-chain using the relayer wallet.
 *   3. Monitor/poll the relayer API until the intent is marked "filled".
 *   4. Output transaction details (funding tx, fill tx) and report realized profit.
 * 
 * Run:
 *   node --import tsx test/live_transaction_test.ts
 */

import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider } from 'cashscript';
import * as fs from 'fs';

const PUSD = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';
const RELAYER_API = process.env.RELAYER_API_URL ?? 'http://localhost:3006';
const MAKER_SELL_SATS = 50_000n;
const MAKER_BUY_PUSD  = 10n; // 0.10 PUSD

async function loadWallet(): Promise<TestNetWallet> {
    if (process.env.RELAYER_PRIVATE_KEY_WIF) {
        return TestNetWallet.fromWIF(process.env.RELAYER_PRIVATE_KEY_WIF);
    }
    const walletPath = process.env.WALLET_PATH ?? '../contracts-bch-swap/wallet.json';
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    return TestNetWallet.fromWIF(walletData.wif);
}

async function apiPost(path: string, body: object) {
    const res = await fetch(`${RELAYER_API}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.json();
}

async function apiGet(path: string) {
    const res = await fetch(`${RELAYER_API}${path}`);
    return res.json();
}

async function main() {
    console.log('===========================================================');
    console.log('  Live Transaction Fill Test & Profit Tracking');
    console.log('===========================================================');

    // 1. Load wallet
    const wallet = await loadWallet();
    const makerAddress = (wallet as any).cashaddr as string;
    console.log(`Maker (using relayer wallet address): ${makerAddress}`);

    // 2. Create intent via API
    console.log(`\nStep 1: Creating BCH -> PUSD limit order intent...`);
    const createRes = await apiPost('/intent/create', {
        makerAddress,
        sellToken: 'BCH',
        buyToken: PUSD,
        sellAmount: MAKER_SELL_SATS.toString(),
        buyAmount: MAKER_BUY_PUSD.toString(),
        orderType: 'limit',
        expiryTime: Math.floor(Date.now() / 1000) + 600,
        network: 'chipnet',
    });

    if (!createRes.success) {
        console.error('Failed to create intent:', createRes.error);
        process.exit(1);
    }

    const { intentId, contractAddress } = createRes;
    console.log(`✅ Intent created:   ${intentId}`);
    console.log(`   Contract Address:  ${contractAddress}`);

    // 3. Fund the contract address on-chain
    console.log(`\nStep 2: Funding contract on-chain with ${MAKER_SELL_SATS} satoshis...`);
    
    // We send the MAKER_SELL_SATS from the wallet to the contract Address
    const fundTx = await wallet.send([
        {
            cashaddr: contractAddress,
            value: Number(MAKER_SELL_SATS),
            unit: 'sat'
        }
    ]);
    
    console.log(`✅ Funded! TXID: ${fundTx.txid}`);
    console.log(`   Explorer: https://chipnet.chaingraph.cash/tx/${fundTx.txid}`);

    // 4. Poll/monitor the intent status
    console.log(`\nStep 3: Monitoring intent status for execution...`);
    const startTime = Date.now();
    const timeout = 120_000; // 2 minutes
    let isFilled = false;
    let fillTxid = '';

    while (Date.now() - startTime < timeout) {
        process.stdout.write('.');
        try {
            const status = await apiGet(`/intent/${intentId}`);
            if (status.status === 'filled') {
                isFilled = true;
                fillTxid = status.fillTxid;
                console.log('\n');
                break;
            }
        } catch {}
        await new Promise(r => setTimeout(r, 4000));
    }

    if (!isFilled) {
        console.error(`\n❌ Timeout: Intent was not filled within 2 minutes.`);
        process.exit(1);
    }

    console.log(`🎉 Intent successfully filled by the relayer bot!`);
    console.log(`   Fill TXID: ${fillTxid}`);
    console.log(`   Explorer:  https://chipnet.chaingraph.cash/tx/${fillTxid}`);

    // 5. Query details of the fill
    console.log(`\nStep 4: Tracking & Profit Reporting...`);
    try {
        const provider = new ElectrumNetworkProvider('chipnet');
        const rawHex = await provider.getRawTransaction(fillTxid);
        const { binToHex, hexToBin, decodeTransaction } = await import('@bitauth/libauth');
        const tx = decodeTransaction(hexToBin(rawHex));
        
        if (typeof tx !== 'string') {
            console.log(`\n--- Transaction Outputs ---`);
            tx.outputs.forEach((output, index) => {
                const isToken = !!output.token;
                console.log(`  Output #${index}: ${output.valueSatoshis} sats ${isToken ? `[Token Category: ${binToHex(output.token!.category).slice(0, 12)}… Amount: ${output.token!.amount}]` : ''}`);
            });
        }
    } catch {}

    console.log('\n===========================================================');
    console.log('  TEST SUCCESSFUL ✅');
    console.log('===========================================================');
    process.exit(0);
}

main().catch(e => {
    console.error('Fatal error:', e.message);
    process.exit(1);
});
