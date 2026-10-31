import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider } from 'cashscript';
import 'dotenv/config';

async function main() {
    const solverWif = process.env.RELAYER_PRIVATE_KEY_WIF!;
    const solverWallet = await TestNetWallet.fromWIF(solverWif);
    const provider = new ElectrumNetworkProvider('chipnet');
    
    const utxos = await provider.getUtxos((solverWallet as any).cashaddr);
    const targetUtxos = utxos.filter((u: any) => u.token && u.token.category === 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b');
    
    console.log(`Found ${targetUtxos.length} token UTXOs for solver.`);
    for (const u of targetUtxos) {
        console.log(`UTXO txid=${u.txid.slice(0, 10)}... amount=${u.token!.amount} dust=${u.satoshis} sats`);
    }
}
main().catch(console.error);
