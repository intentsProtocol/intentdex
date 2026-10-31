import { ElectrumNetworkProvider } from 'cashscript';

async function check() {
    const provider = new ElectrumNetworkProvider('chipnet');
    const utxos = await provider.getUtxos('bchtest:p008tp4hr60f7g08r2mn8fuugrea74tq70fld8dv7zll2k6ltlyjgzxwqr482');
    console.log("UTXOs found:", utxos.length);
    console.log(JSON.stringify(utxos, null, 2));
}

check().catch(console.error);
