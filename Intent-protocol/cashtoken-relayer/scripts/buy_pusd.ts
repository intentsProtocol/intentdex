import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider, TransactionBuilder, SignatureTemplate } from 'cashscript';
import { ExchangeLab } from '@cashlab/cauldron';
import { NATIVE_BCH_TOKEN_ID } from '@cashlab/common';
import 'dotenv/config';

const PUSD_TOKEN = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';

async function main() {
    console.log('--- Buying PUSD on Cauldron ---');

    if (!process.env.RELAYER_PRIVATE_KEY_WIF) {
        throw new Error('RELAYER_PRIVATE_KEY_WIF not set in .env');
    }

    const wallet = await TestNetWallet.fromWIF(process.env.RELAYER_PRIVATE_KEY_WIF);
    const provider = new ElectrumNetworkProvider('chipnet');
    
    const cashaddr = (wallet as any).cashaddr as string;
    const tokenaddr = (wallet as any).tokenaddr as string;

    console.log(`Wallet: ${cashaddr}`);

    const utxos = await provider.getUtxos(cashaddr);
    const bchUtxos = utxos.filter((u: any) => !u.token);

    const spendAmount = 50_000_000n; // 0.5 tBCH

    const totalBch = bchUtxos.reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);
    console.log(`Total BCH available: ${totalBch} sats`);

    if (totalBch < spendAmount + 10000n) {
        throw new Error('Insufficient BCH to perform swap of 0.5 tBCH');
    }

    console.log('Fetching Cauldron Pools...');
    const indexerUrl = 'https://indexer-chipnet.riften.net/api/graphql';
    
    // Use CauldronPoolCache from src to get pools properly
    const { CauldronPoolCache } = await import('../src/bot/CauldronPoolCache.js');
    const cache = CauldronPoolCache.forNetwork('chipnet');
    await cache.refresh();
    const pools = await cache.getPoolsForPair('BCH', PUSD_TOKEN);
    
    if (pools.length === 0) {
        throw new Error('No pools found for BCH -> PUSD');
    }

    console.log(`Found ${pools.length} pools. Constructing trade...`);
    const lab = new ExchangeLab();
    
    // We want to spend 0.5 BCH (TargetSupply)
    // The trade returns demand (tokens) and taking fee from supply.
    const trade = lab.constructTradeBestRateForTargetSupply(NATIVE_BCH_TOKEN_ID, PUSD_TOKEN, spendAmount, pools, 2n);
    
    console.log(`Will receive approximately ${trade.summary.demand} PUSD units for 0.5 tBCH.`);
    
    const { CauldronRouter } = await import('../src/bot/CauldronRouter.js');
    const router = new CauldronRouter(cache);
    
    const quote: any = {
        profitable: true,
        routeType: 'BCH_TO_TOKEN',
        preFillTrade: trade,
        preFillTokenId: PUSD_TOKEN
    };

    const walletInfo = {
        privateKey: (wallet as any).privateKey as Uint8Array,
        publicKeyHash: (wallet as any).publicKeyHash as Uint8Array,
        cashaddr,
        tokenaddr,
    };

    console.log('Executing Cauldron Pre-fill Swap...');
    const result = await router.executePrefill(quote, [...utxos], walletInfo, provider);

    console.log(`Swap successful! Transaction ID: ${result.txid}`);
    process.exit(0);
}

main().catch(console.error);
