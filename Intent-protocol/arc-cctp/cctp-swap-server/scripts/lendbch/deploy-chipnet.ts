/**
 * scripts/lendbch/deploy-chipnet.ts — deploy our own copy of the Paryon contract system on chipnet, so the lendbch
 * flows can be tested end to end with free coins. CHIPNET ONLY (guarded by the secrets file's network tag).
 *
 * Mechanics. A CashToken category equals the txid of the prevout spent at input index 0 (which must be output 0), so
 * we first broadcast five "prep" transactions — their txids become the five token categories. We then derive every
 * contract address from those categories (deriveFullDeployment) and broadcast five genesis transactions whose token
 * outputs match the shape our verifier checks (see src/lendbch/verifySetup.ts). We deploy the *Guarded* price
 * contract directly, so there is no migration. The result is written to data/lendbch-chipnet.json.
 *
 *   npx tsx scripts/lendbch/deploy-chipnet.ts
 *   npx tsx scripts/lendbch/verify.ts chipnet      # then verify it
 */
import { ElectrumNetworkProvider, Network, SignatureTemplate, TransactionBuilder, type Utxo } from 'cashscript';
import { cashAddressToLockingBytecode, hexToBin, binToHex } from '@bitauth/libauth';
import { deriveFullDeployment, type FullContract } from '../../src/lendbch/deployFull.js';
import { chipnetParams, loadChipnetSecrets, saveChipnetDeployment } from '../../src/lendbch/chipnetConfig.js';
import type { GenesisTxIds } from '../../src/lendbch/verifySetup.js';

const MAX_SUPPLY = 9223372036854775807n;
const THREAD_VALUE = 1000n;         // the sats value the covenants require on each thread/NFT output
const PREP_FEE = 600n;
const GENESIS_FEE = 2500n;
const INITIAL_PRICE_CENTS = 30000;  // $300.00 starting test price
const N_BORROW = 2;                 // small thread counts for chipnet
const N_PRICE = 2;

const le = (v: number | bigint, bytes: number) => { let h = ''; let n = BigInt(v); for (let i = 0; i < bytes; i++) { h += (Number(n & 0xffn)).toString(16).padStart(2, '0'); n >>= 8n; } return h; };
const PERIOD0 = le(0, 4);
const PRICE_COMMIT = '00' + le(0, 4) + le(INITIAL_PRICE_CENTS, 4);   // 0x00 | seq0 | price(LE4)
const POOL_START = le(0, 4) + le(0, 6);                             // period0 | totalStakedEpoch0

async function main() {
    const secrets = loadChipnetSecrets();
    if (!secrets) throw new Error('No chipnet secrets — run gen-keys-chipnet.ts and fund the deployer first');
    if (secrets.network !== 'chipnet') throw new Error('refusing to deploy with non-chipnet secrets');

    const provider = new ElectrumNetworkProvider(Network.CHIPNET);
    const sig = new SignatureTemplate(secrets.deployerWif);
    const dRes = cashAddressToLockingBytecode(secrets.deployerAddress);
    if (typeof dRes === 'string') throw new Error(dRes);
    const deployerLb = dRes.bytecode;
    const to = (lbHex: string) => hexToBin(lbHex);

    const funding = (await provider.getUtxos(secrets.deployerAddress)).filter(u => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis));
    if (funding.length < 5) throw new Error(`need 5 pure-BCH funding UTXOs, have ${funding.length}; fund the deployer first`);

    // ── 1. Five prep txs → their txids are the five token categories (order fixed) ──
    const CATS = ['paryon', 'pool', 'redeemer', 'loanKeyFactory', 'oracleMigrationKey'] as const;
    const seeds: Utxo[] = [];
    const prepTxids: string[] = [];
    for (let i = 0; i < 5; i++) {
        const u = funding[i];
        const seedVal = u.satoshis - PREP_FEE;
        const tb = new TransactionBuilder({ provider });
        tb.addInput(u, sig.unlockP2PKH());
        tb.addOutput({ to: deployerLb, amount: seedVal });   // single output ⇒ it is vout 0
        const txid = await provider.sendRawTransaction(tb.build());
        prepTxids.push(txid);
        seeds.push({ txid, vout: 0, satoshis: seedVal });
        console.log(`prep ${CATS[i]} → category ${txid}`);
    }

    const tokenIds = {
        paryonTokenId: prepTxids[0], poolTokenId: prepTxids[1], redeemerTokenId: prepTxids[2],
        loanKeyFactoryTokenId: prepTxids[3], oracleMigrationKeyTokenId: prepTxids[4],
    };
    const height = await provider.getBlockHeight();
    const params = chipnetParams(tokenIds, secrets.oraclePublicKey, binToHex(deployerLb), height);
    const d = deriveFullDeployment(params, provider);
    console.log(`derived deployment at startBlockHeight ${height}, period ${params.contractParams.periodLengthBlocks}`);

    // Helper to build+broadcast a genesis tx: spend a seed, add outputs, change back to the deployer.
    const broadcastGenesis = async (label: string, seed: Utxo, outputs: { lb: string; token: NonNullable<Utxo['token']> }[]) => {
        const tb = new TransactionBuilder({ provider });
        tb.addInput(seed, sig.unlockP2PKH());
        let spent = 0n;
        for (const o of outputs) { tb.addOutput({ to: to(o.lb), amount: THREAD_VALUE, token: o.token }); spent += THREAD_VALUE; }
        const change = seed.satoshis - spent - GENESIS_FEE;
        if (change > 546n) tb.addOutput({ to: deployerLb, amount: change });
        const txid = await provider.sendRawTransaction(tb.build());
        console.log(`genesis ${label} → ${txid} (${outputs.length} token outputs)`);
        return txid;
    };
    const nft = (category: string, capability: 'none' | 'mutable' | 'minting', commitment: string, amount = 0n) => ({ category, amount, nft: { capability, commitment } });

    // ── 2a. paryon genesis: borrowing (minting, MAX supply split), price guarded (mutable), 8 loan fns (none, 01–08) ──
    const half = MAX_SUPPLY / BigInt(N_BORROW);
    const borrowOuts = Array.from({ length: N_BORROW }, (_, i) => ({ lb: d.borrowing.lockingBytecode, token: nft(tokenIds.paryonTokenId, 'minting', PERIOD0, i === N_BORROW - 1 ? MAX_SUPPLY - half * BigInt(N_BORROW - 1) : half) }));
    const priceOuts = Array.from({ length: N_PRICE }, () => ({ lb: d.priceGuarded.lockingBytecode, token: nft(tokenIds.paryonTokenId, 'mutable', PRICE_COMMIT) }));
    const loanFnOuts = d.loanFunctions.map((f: FullContract, i: number) => ({ lb: f.lockingBytecode, token: nft(tokenIds.paryonTokenId, 'none', le(i + 1, 1)) }));
    const paryonGenesis = await broadcastGenesis('paryon', seeds[0], [...borrowOuts, ...priceOuts, ...loanFnOuts]);

    // ── 2b. pool genesis: stability pool (minting), sidecar (no token, next output), collector (mutable), 4 pool fns ──
    // The sidecar must directly follow the stability-pool output, and it carries no token — so build this one by hand.
    const poolTb = new TransactionBuilder({ provider });
    poolTb.addInput(seeds[1], sig.unlockP2PKH());
    poolTb.addOutput({ to: to(d.stabilityPool.lockingBytecode), amount: THREAD_VALUE, token: nft(tokenIds.poolTokenId, 'minting', POOL_START) });
    poolTb.addOutput({ to: to(d.stabilityPoolSidecar.lockingBytecode), amount: THREAD_VALUE });   // sidecar: no token
    poolTb.addOutput({ to: to(d.collector.lockingBytecode), amount: THREAD_VALUE, token: nft(tokenIds.poolTokenId, 'mutable', PERIOD0) });
    d.poolFunctions.forEach((f: FullContract, i: number) => poolTb.addOutput({ to: to(f.lockingBytecode), amount: THREAD_VALUE, token: nft(tokenIds.poolTokenId, 'none', le(i + 1, 1)) }));
    { const spent = THREAD_VALUE * BigInt(3 + d.poolFunctions.length); const change = seeds[1].satoshis - spent - GENESIS_FEE; if (change > 546n) poolTb.addOutput({ to: deployerLb, amount: change }); }
    const poolGenesis = await provider.sendRawTransaction(poolTb.build());
    console.log(`genesis pool → ${poolGenesis}`);

    // ── 2c. redeemer genesis: minting NFT, empty commitment ──
    const redeemerGenesis = await broadcastGenesis('redeemer', seeds[2], [{ lb: d.redeemer.lockingBytecode, token: nft(tokenIds.redeemerTokenId, 'minting', '') }]);

    // ── 2d. loanKeyFactory genesis: minting NFT, empty commitment ──
    const lkfGenesis = await broadcastGenesis('loanKeyFactory', seeds[3], [{ lb: d.loanKeyFactory.lockingBytecode, token: nft(tokenIds.loanKeyFactoryTokenId, 'minting', '') }]);

    // ── 2e. oracleMigrationKey genesis: mint the migration key to the deployer (we won't migrate; Guarded is live) ──
    const migGenesis = await broadcastGenesis('oracleMigrationKey', seeds[4], [{ lb: binToHex(deployerLb), token: nft(tokenIds.oracleMigrationKeyTokenId, 'minting', '') }]);

    const genesis: GenesisTxIds = { paryon: paryonGenesis, pool: poolGenesis, redeemer: redeemerGenesis, loanKeyFactory: lkfGenesis, oracleMigrationKey: migGenesis };
    saveChipnetDeployment({ params, genesis, deployedAt: new Date().toISOString() });
    console.log('\n✅ deployed. Wrote data/lendbch-chipnet.json');
    console.log('Token IDs:', tokenIds);
    console.log('Next: npx tsx scripts/lendbch/verify.ts chipnet');
    process.exit(0);
}
main().catch((e) => { console.error('deploy error:', (e as Error).message); process.exit(1); });
