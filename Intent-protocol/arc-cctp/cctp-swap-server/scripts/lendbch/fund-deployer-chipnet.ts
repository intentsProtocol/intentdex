/**
 * scripts/lendbch/fund-deployer-chipnet.ts — one-off: fund the lendbch chipnet deployer from the mesh server's
 * chipnet wallet. The mesh WIF is read from BCHMesh/meshserver/.env into this process by dotenv and used only to
 * sign; it is never printed. Chipnet only. Sends a few separate outputs so the deployer has spendable UTXOs.
 *
 *   npx tsx scripts/lendbch/fund-deployer-chipnet.ts [totalBch]
 */
import 'dotenv/config';
import * as path from 'path';
import * as url from 'url';
import dotenv from 'dotenv';
import { ElectrumNetworkProvider, Network, SignatureTemplate, TransactionBuilder } from 'cashscript';
import { decodePrivateKeyWif, secp256k1, hash160, encodeCashAddress, cashAddressToLockingBytecode } from '@bitauth/libauth';
import { loadChipnetSecrets } from '../../src/lendbch/chipnetConfig.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../../BCHMesh/meshserver/.env') });

const wif = process.env.SOLVER_PRIVATE_KEY_WIF;
if (!wif) throw new Error('SOLVER_PRIVATE_KEY_WIF not found in the mesh env');

const secrets = loadChipnetSecrets();
if (!secrets) throw new Error('No chipnet secrets — run gen-keys-chipnet.ts first');

const decoded = decodePrivateKeyWif(wif);
if (typeof decoded === 'string') throw new Error(decoded);
const priv = decoded.privateKey;
const pub = secp256k1.derivePublicKeyCompressed(priv);
if (typeof pub === 'string') throw new Error(pub);
const srcAddrRes = encodeCashAddress({ prefix: 'bchtest', type: 'p2pkh', payload: hash160(pub) });
const srcAddr = typeof srcAddrRes === 'string' ? srcAddrRes : srcAddrRes.address;

const totalBch = Number(process.argv[2] || '0.05');
const total = BigInt(Math.round(totalBch * 1e8));
const chunks = 5n;                                  // several outputs → separate UTXOs for genesis seeds + fees
const per = total / chunks;

const provider = new ElectrumNetworkProvider(Network.CHIPNET);
const lb = (a: string) => { const r = cashAddressToLockingBytecode(a); if (typeof r === 'string') throw new Error(r); return r.bytecode; };

async function main() {
    const utxos = (await provider.getUtxos(srcAddr)).filter(u => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis));
    const fee = 2000n;
    const inputs: typeof utxos = [];
    let sum = 0n;
    for (const u of utxos) { inputs.push(u); sum += u.satoshis; if (sum >= total + fee) break; }
    if (sum < total + fee) throw new Error(`insufficient funds: have ${sum}, need ${total + fee}`);

    const tb = new TransactionBuilder({ provider });
    const sig = new SignatureTemplate(wif as string);
    for (const u of inputs) tb.addInput(u, sig.unlockP2PKH());
    for (let i = 0n; i < chunks; i++) tb.addOutput({ to: lb(secrets!.deployerAddress), amount: per });
    const change = sum - per * chunks - fee;
    if (change > 546n) tb.addOutput({ to: lb(srcAddr), amount: change });

    const raw = await tb.build();
    const txid = await provider.sendRawTransaction(raw);
    console.log('Funded deployer', secrets!.deployerAddress, 'with', totalBch, 'BCH in', String(chunks), 'outputs');
    console.log('TXID:', txid);
    console.log('Explorer:', `https://chipnet.imaginary.cash/tx/${txid}`);
    process.exit(0);
}
main().catch(e => { console.error('fund error:', (e as Error).message); process.exit(1); });
