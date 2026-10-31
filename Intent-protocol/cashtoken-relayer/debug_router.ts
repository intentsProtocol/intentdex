import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider } from 'cashscript';
import { CauldronRouter } from './src/bot/CauldronRouter';
import { SpreadQuant } from './src/bot/SpreadQuant';
import { DexLab } from './src/bot/DexLab';
import { Intent } from './src/intentStore';
import * as fs from 'fs';
import 'dotenv/config';

const TARGET_TOKEN = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';

async function main() {
    const solverWif = process.env.RELAYER_PRIVATE_KEY_WIF!;
    const solverWallet = await TestNetWallet.fromWIF(solverWif);
    const provider = new ElectrumNetworkProvider('chipnet');
    
    // Simulate the router
    const router = new CauldronRouter(true);
    await router.initialize();
    
    const intent: Intent = {
        id: "debug_intent",
        type: "LIMIT_ORDER",
        makerAddress: "bchtest:qqmhr60gt2w2kz7aps6ds9rgv2e3f4ksdg3gye8det",
        contractAddress: "debug_addr",
        tokenAddress: "debug_addr",
        sellToken: "BCH",
        buyToken: TARGET_TOKEN,
        sellAmount: "50000",
        buyAmount: "5",
        status: "pending",
        createdAt: Date.now(),
        expiryTime: Math.floor(Date.now() / 1000) + 3600,
        network: "chipnet"
    };

    const solverUtxos = await provider.getUtxos((solverWallet as any).cashaddr);

    console.log("=== Debugging Route Evaluation ===");
    const quote = router.evaluateRoute(intent, solverUtxos, {
        profitSats: 25000n, // Not actually used by CauldronRouter for limit orders in this way
        tradeValueSats: 50000n,
        slippageBps: 0
    } as any);

    console.log("\nChosen Route:");
    console.log(JSON.stringify(quote, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

main().catch(console.error);
