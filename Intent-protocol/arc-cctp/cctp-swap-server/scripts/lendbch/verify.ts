/**
 * scripts/lendbch/verify.ts — verify a Paryon deployment's five genesis transactions were set up correctly.
 *
 *   npx tsx scripts/lendbch/verify.ts            # Paryon mainnet-v1 (uses the known mainnet genesis txids)
 *   npx tsx scripts/lendbch/verify.ts chipnet    # our chipnet copy, from data/lendbch-chipnet.json
 *
 * This is our own rewrite of Paryon's verify_contract_deployment tool (see src/lendbch/verifySetup.ts). For mainnet
 * it doubles as a cross-check that our address derivation matches the live deployment. Read-only; nothing is signed.
 */
import { ChainClient } from '../../src/lendbch/chain.js';
import { deriveDeployment, MAINNET_V1 } from '../../src/lendbch/deployment.js';
import { verifySetup, type GenesisTxIds, type RawTx } from '../../src/lendbch/verifySetup.js';
import { loadChipnetDeployment } from '../../src/lendbch/chipnetConfig.js';

// Paryon mainnet-v1 genesis txids (from their verify_contract_deployment/config.ts).
const MAINNET_GENESIS: GenesisTxIds = {
    paryon: '9c938f53eb97e089c72c47e9e5cf5f68ad23fd5eb4cb579c5266f04bba4b4d62',
    pool: '6a9eb371b2f9379568dad9ed0d4757859f2aa1db33207b6b885135ed8db31c2f',
    redeemer: '693c322cf1f0012bd17e765ffb5fa46602c1a37af21f6a8a69447e0a511895ea',
    loanKeyFactory: '9d432d0f13842ced1f37d03dc3d31faf628c24146292a4c69b09c1a6758a79ff',
    oracleMigrationKey: '68180fe720cfd1240e8fc571843522a7fe151ddc6405d6c5d93f3543906051de',
};

const which = process.argv[2] === 'chipnet' ? 'chipnet' : 'mainnet';
const chain = new ChainClient(which);

async function main() {
    let deployment, genesis: GenesisTxIds, priceLb: string, label: string;
    if (which === 'chipnet') {
        const cfg = loadChipnetDeployment();
        if (!cfg) { console.error('No chipnet deployment found (data/lendbch-chipnet.json). Run deploy-chipnet.ts first.'); process.exit(2); }
        deployment = deriveDeployment(cfg.params, chain.getProvider());
        genesis = cfg.genesis;
        // Our chipnet deploy puts the Guarded price contract in genesis (no migration), so verify against it.
        priceLb = deployment.priceVariants[0].lockingBytecode;
        label = cfg.params.id;
    } else {
        deployment = deriveDeployment(MAINNET_V1, chain.getProvider());
        genesis = MAINNET_GENESIS;
        // Mainnet genesis created the ORIGINAL PriceContract; it was later migrated to Guarded.
        priceLb = deployment.priceVariants[1].lockingBytecode;
        label = MAINNET_V1.id;
    }

    console.log(`Verifying ${label} on ${which}…`);
    const result = await verifySetup(deployment, genesis, (txid) => chain.getRawTransaction(txid) as Promise<RawTx>, priceLb);
    for (const c of result.checks) console.log(`  ${c.ok ? 'OK  ' : 'FAIL'} ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
    console.log(result.ok ? `\n✅ ${label} setup verified (${result.checks.length} checks).` : `\n❌ ${label} verification FAILED (${result.checks.filter(c => !c.ok).length}/${result.checks.length}).`);
    process.exit(result.ok ? 0 : 1);
}
main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
