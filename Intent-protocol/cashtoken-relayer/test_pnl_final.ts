import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider } from 'cashscript';
import * as fs from 'fs';
import 'dotenv/config';

const TARGET_TOKEN = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';

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

async function main() {
    const provider = new ElectrumNetworkProvider('chipnet');
    
    // Fetch USD price
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd');
    const data = await res.json();
    const bchPrice = data['bitcoin-cash'].usd;
    const satsToUsd = (sats: bigint) => `$${((Number(sats) / 1e8) * bchPrice).toFixed(4)}`;

    const userInitialBCH = 202993147n;
    const userInitialPUSD = 60n;
    const solverInitialBCH = 4312804408n;
    const solverInitialPUSD = 13869n;

    // Wallets
    const walletData = JSON.parse(fs.readFileSync('wallet.json', 'utf8'));
    const userWallet = await TestNetWallet.fromWIF(walletData.wif);
    const userAddr = (userWallet as any).cashaddr;

    const solverWif = process.env.RELAYER_PRIVATE_KEY_WIF!;
    const solverWallet = await TestNetWallet.fromWIF(solverWif);
    const solverAddr = (solverWallet as any).cashaddr;

    const userFinalBCH = await getBCHBalance(userAddr, provider);
    const userFinalPUSD = await getTokenBalance(userAddr, TARGET_TOKEN, provider);
    const solverFinalBCH = await getBCHBalance(solverAddr, provider);
    const solverFinalPUSD = await getTokenBalance(solverAddr, TARGET_TOKEN, provider);

    console.log(`BCH Price: $${bchPrice}`);
    console.log("\n[BEFORE]");
    console.log(`User:   BCH: ${userInitialBCH} sats (${satsToUsd(userInitialBCH)}) | PUSD: ${userInitialPUSD}`);
    console.log(`Solver: BCH: ${solverInitialBCH} sats (${satsToUsd(solverInitialBCH)}) | PUSD: ${solverInitialPUSD}`);

    console.log("\n[AFTER]");
    console.log(`User:   BCH: ${userFinalBCH} sats (${satsToUsd(userFinalBCH)}) | PUSD: ${userFinalPUSD}`);
    console.log(`Solver: BCH: ${solverFinalBCH} sats (${satsToUsd(solverFinalBCH)}) | PUSD: ${solverFinalPUSD}`);

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
}

main().catch(console.error);
