import { TestNetWallet } from 'mainnet-js';
import * as fs from 'fs';
import 'dotenv/config';

async function checkBalances() {
    console.log("=== Checking Balances ===");

    // User Wallet
    const walletData = JSON.parse(fs.readFileSync('wallet.json', 'utf8'));
    const userWallet = await TestNetWallet.fromWIF(walletData.wif);
    const userAddr = (userWallet as any).address;
    
    // Solver Wallet
    const solverWif = process.env.RELAYER_PRIVATE_KEY_WIF;
    if (!solverWif) throw new Error("No solver WIF");
    const solverWallet = await TestNetWallet.fromWIF(solverWif);
    const solverAddr = (solverWallet as any).address;

    // Fetch USD price
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd');
    const data = await res.json();
    const bchPrice = data['bitcoin-cash'].usd;

    const bchToUsd = (sats: number) => `$${((sats / 1e8) * bchPrice).toFixed(4)}`;

    console.log(`BCH Price: $${bchPrice}`);
    console.log("\n[User]", userAddr);
    console.log("BCH:", await userWallet.getBalance(), "sats", "(", bchToUsd(await userWallet.getBalance()), ")");
    const utxos = await userWallet.getTokenBalances();
    console.log("Tokens:", utxos);

    console.log("\n[Solver]", solverAddr);
    console.log("BCH:", await solverWallet.getBalance(), "sats", "(", bchToUsd(await solverWallet.getBalance()), ")");
    const solverUtxos = await solverWallet.getTokenBalances();
    console.log("Tokens:", solverUtxos);
}

checkBalances().catch(console.error);
