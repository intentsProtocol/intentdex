import { TestNetWallet, Config } from 'mainnet-js';
import * as fs from 'fs';

// Force Chipnet
(Config as any).EnforceCashScript = false;
(Config as any).DefaultNetwork = "chipnet";

async function consolidate() {
    console.log("Loading wallet...");
    const walletData = JSON.parse(fs.readFileSync('wallet.json', 'utf8'));
    const wallet = await TestNetWallet.fromWIF(walletData.wif);
    const address = (wallet as any).address || (wallet as any).cashaddr;

    console.log(`Wallet address: ${address}`);
    const balance = await wallet.getBalance();
    console.log(`Current balance: ${balance} sats`);

    console.log("Consolidating UTXOs (sending max to self)");
    try {
        const result = await wallet.sendMax(address);
        console.log(`Consolidation TXID: ${result.txId}`);
    } catch (e: any) {
        console.error("Failed to consolidate:", e.message);
    }
}

consolidate().catch(console.error);
