import { TestNetWallet, Config } from 'mainnet-js';
import * as fs from 'fs';

(Config as any).EnforceCashScript = false;
(Config as any).DefaultNetwork = "chipnet";

async function run() {
    const w = await TestNetWallet.fromWIF(JSON.parse(fs.readFileSync('wallet.json', 'utf8')).wif);
    const utxos = await w.getUtxos();
    console.log(JSON.stringify(utxos[0], (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    process.exit(0);
}
run();
