import { ElectrumNetworkProvider } from 'cashscript';

const provider = new ElectrumNetworkProvider('chipnet');
const relayerAddr = 'bchtest:qzufsn0wtcmc4lhc3s3trhl0nxn6dgkpmgvzngkxl7';
const tokenAddr  = 'bchtest:zzufsn0wtcmc4lhc3s3trhl0nxn6dgkpmgtgqkcqqd';
const PUSDTEST   = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';

async function main() {
    const utxos1 = await provider.getUtxos(relayerAddr);
    const utxos2 = await provider.getUtxos(tokenAddr);
    const all = [...utxos1, ...utxos2];
    console.log(`Total UTXOs: ${all.length} (${utxos1.length} p2pkh + ${utxos2.length} token-addr)`);
    const tokenUtxos = all.filter((u: any) => u.token?.category === PUSDTEST);
    const total = tokenUtxos.reduce((s: bigint, u: any) => s + BigInt(u.token!.amount), 0n);
    console.log(`\nPUSDTEST UTXOs: ${tokenUtxos.length}`);
    console.log(`Total PUSDTEST balance: ${total} units`);
    for (const u of tokenUtxos) {
        console.log(`  txid=${u.txid}:${u.vout}  sats=${u.satoshis}  tokens=${u.token.amount}`);
    }
    const bchUtxos = utxos1.filter((u: any) => !u.token);
    const totalBch = bchUtxos.reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);
    console.log(`\nBCH UTXOs: ${bchUtxos.length}, total: ${totalBch} sats`);
    process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
