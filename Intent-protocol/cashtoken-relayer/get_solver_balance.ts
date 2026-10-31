import { TestNetWallet } from 'mainnet-js';
import * as fs from 'fs';
import 'dotenv/config';

async function main() {
    let wallet;
    if (process.env.RELAYER_PRIVATE_KEY_WIF) {
        wallet = await TestNetWallet.fromWIF(process.env.RELAYER_PRIVATE_KEY_WIF);
    } else {
        let walletPath = '../contracts-bch-swap/wallet.json';
        if (!fs.existsSync(walletPath)) {
            walletPath = './wallet.json';
        }
        const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
        wallet = await TestNetWallet.fromWIF(walletData.wif);
    }
    console.log(`Solver Cash Address: ${wallet.cashaddr}`);
    console.log(`Solver Token Address: ${wallet.tokenaddr}`);
    
    const balance = await wallet.getBalance('bch');
    console.log(`BCH Balance: ${balance} BCH`);

    const utxos = await wallet.getUtxos();
    console.log('\nToken Balances:');
    const tokenBalances: Record<string, bigint> = {};
    for (const utxo of utxos as any[]) {
        if (utxo.token) {
            const cat = utxo.token.category;
            tokenBalances[cat] = (tokenBalances[cat] || 0n) + BigInt(utxo.token.amount);
        }
    }
    const categories = Object.keys(tokenBalances);
    if (categories.length === 0) {
        console.log('No tokens found.');
    } else {
        for (const cat of categories) {
            console.log(`  - Category: ${cat}`);
            console.log(`    Amount:   ${tokenBalances[cat]}`);
        }
    }
    process.exit(0);
}

main().catch(console.error);
