/**
 * scripts/lendbch/gen-keys-chipnet.ts — generate the chipnet-only secrets for our Paryon test copy: a test oracle
 * keypair (stands in for General Protocols) and a deployer/keeper wallet that funds and signs the genesis and
 * keeper transactions. Writes data/lendbch-chipnet-secrets.json (gitignored). Idempotent: refuses to overwrite.
 *
 *   npx tsx scripts/lendbch/gen-keys-chipnet.ts
 *
 * NEVER run against mainnet secrets; the file is tagged network:chipnet and the loader refuses anything else.
 */
import { generatePrivateKey, secp256k1, encodeCashAddress, hash160, encodePrivateKeyWif } from '@bitauth/libauth';
import { binToHex } from '@bitauth/libauth';
import { loadChipnetSecrets, saveChipnetSecrets, type ChipnetSecrets } from '../../src/lendbch/chipnetConfig.js';

const existing = loadChipnetSecrets();
if (existing) { console.log('Chipnet secrets already exist — refusing to overwrite. Deployer address:', existing.deployerAddress); process.exit(0); }

function newKey(): { priv: Uint8Array; pub: Uint8Array } {
    const priv = generatePrivateKey();
    const pub = secp256k1.derivePublicKeyCompressed(priv);
    if (typeof pub === 'string') throw new Error(pub);
    return { priv, pub };
}

const oracle = newKey();
const deployer = newKey();
const pkh = hash160(deployer.pub);
const wif = encodePrivateKeyWif(deployer.priv, 'testnet');
const addrResult = encodeCashAddress({ prefix: 'bchtest', type: 'p2pkh', payload: pkh });
const deployerAddress = typeof addrResult === 'string' ? addrResult : addrResult.address;

const secrets: ChipnetSecrets = {
    oraclePublicKey: binToHex(oracle.pub),
    oraclePrivateKey: binToHex(oracle.priv),
    deployerWif: typeof wif === 'string' ? wif : (wif as any).wif,
    deployerAddress,
    network: 'chipnet',
};
saveChipnetSecrets(secrets);
console.log('Wrote data/lendbch-chipnet-secrets.json');
console.log('Test oracle pubkey:', secrets.oraclePublicKey);
console.log('Deployer address (FUND THIS on chipnet):', secrets.deployerAddress);
