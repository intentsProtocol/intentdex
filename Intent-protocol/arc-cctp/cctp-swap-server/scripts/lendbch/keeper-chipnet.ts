/**
 * scripts/lendbch/keeper-chipnet.ts — the chipnet-only operator our test deployment needs. On mainnet General
 * Protocols and Paryon's operator do this work; on our copy we do it ourselves. CHIPNET ONLY.
 *
 *   npx tsx scripts/lendbch/keeper-chipnet.ts price [priceCents]   # sign + push a new oracle price to every thread
 *   npx tsx scripts/lendbch/keeper-chipnet.ts period               # advance the borrowing period (needs blocks mined)
 *
 * price: builds the 16-byte oracle message (timestamp | msgSeq | contentSeq | price), Schnorr-signs its SHA256 with
 * the test oracle key, and recreates each price thread with state 0x00 | contentSeq | price. PriceContractGuarded
 * only accepts a heartbeat (contentSeq % 10 == 0) or a ≥0.5% move, with a sequence newer than the current one, so we
 * step contentSeq by 10 each run. period: sets tx locktime into the next period and rolls the borrowing thread's
 * period forward; it only succeeds once that period's start height has been mined (startBlockHeight + period). The
 * pool's newPeriodPool + payInterest are left for the full keeper (they need the collector/loan lifecycle, P3).
 */
import { Contract, ElectrumNetworkProvider, Network, SignatureTemplate, TransactionBuilder, type Utxo } from 'cashscript';
import { paryonArtifacts } from '@paryonusd/contracts';
import { cashAddressToLockingBytecode, hexToBin, sha256, secp256k1 } from '@bitauth/libauth';
import { reverseHex, lockingBytecodeOf } from '../../src/lendbch/deployment.js';
import { deriveFullDeployment } from '../../src/lendbch/deployFull.js';
import { loadChipnetDeployment, loadChipnetSecrets } from '../../src/lendbch/chipnetConfig.js';
import { decodePrice, decodeBorrowingPeriod } from '../../src/lendbch/state.js';

const le = (v: number | bigint, bytes: number) => { let h = ''; let n = BigInt(v); for (let i = 0; i < bytes; i++) { h += (Number(n & 0xffn)).toString(16).padStart(2, '0'); n >>= 8n; } return h; };

async function main() {
    const action = process.argv[2];
    const cfg = loadChipnetDeployment();
    const secrets = loadChipnetSecrets();
    if (!cfg || !secrets) throw new Error('No chipnet deployment/secrets — deploy first');
    if (cfg.params.network !== 'chipnet' || secrets.network !== 'chipnet') throw new Error('keeper is chipnet-only');

    const provider = new ElectrumNetworkProvider(Network.CHIPNET);
    const sig = new SignatureTemplate(secrets.deployerWif);
    const deployerLb = (() => { const r = cashAddressToLockingBytecode(secrets.deployerAddress); if (typeof r === 'string') throw new Error(r); return r.bytecode; })();
    const paryon = cfg.params.tokenIds.paryonTokenId;
    const d = deriveFullDeployment(cfg.params, provider);
    const { oraclePublicKey, startBlockHeight, periodLengthBlocks } = cfg.params.contractParams;

    const feeUtxos = (await provider.getUtxos(secrets.deployerAddress)).filter(u => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis));
    if (!feeUtxos.length) throw new Error('no deployer BCH UTXOs for fees');

    if (action === 'price') {
        const priceGuarded = new Contract(paryonArtifacts.artifactPriceContractGuarded as any, [oraclePublicKey, reverseHex(cfg.params.tokenIds.oracleMigrationKeyTokenId)], { provider });
        const newPrice = Number(process.argv[3] || '0') || null;
        const threads = (await provider.getUtxos(priceGuarded.address)).filter(u => u.token?.category === paryon && u.token.nft?.capability === 'mutable');
        if (!threads.length) throw new Error('no price threads found');
        const oraclePriv = hexToBin(secrets.oraclePrivateKey);

        for (let i = 0; i < threads.length; i++) {
            const thread = threads[i];
            const fee = feeUtxos[i];
            if (!fee) throw new Error(`not enough deployer BCH UTXOs: need ${threads.length}, have ${feeUtxos.length}`);
            const state = decodePrice(thread.token!.nft!.commitment);
            const contentSeq = Math.floor(state.sequence / 10) * 10 + 10;   // next heartbeat, strictly greater
            const price = newPrice ?? state.priceCents;
            const message = hexToBin(le(Math.floor(Date.now() / 1000), 4) + le(contentSeq, 4) + le(contentSeq, 4) + le(price, 4));
            const signature = secp256k1.signMessageHashSchnorr(oraclePriv, sha256.hash(message));
            if (typeof signature === 'string') throw new Error(signature);
            const newState = '00' + le(contentSeq, 4) + le(price, 4);

            const tb = new TransactionBuilder({ provider });
            tb.addInput(thread, priceGuarded.unlock.updatePrice(message, signature));
            tb.addInput(fee, sig.unlockP2PKH());
            tb.addOutput({ to: priceGuarded.tokenAddress, amount: 1000n, token: { category: paryon, amount: 0n, nft: { capability: 'mutable', commitment: newState } } });
            const change = fee.satoshis - 1000n - 900n;
            if (change > 546n) tb.addOutput({ to: deployerLb, amount: change });
            const txid = await provider.sendRawTransaction(tb.build());
            console.log(`price thread ${thread.txid.slice(0, 10)}:${thread.vout} → seq ${contentSeq}, price ${price}c  tx ${txid.slice(0, 12)}…`);
        }
        console.log(`\n✅ updated ${threads.length} price thread(s).`);
    } else if (action === 'period') {
        const borrowing = new Contract(paryonArtifacts.artifactBorrowing as any, [
            d.loan.lockingBytecode, d.loanSidecar.lockingBytecode, cfg.params.contractParams.protocolFeeLockingBytecode,
            d.loanKeyOriginEnforcer.lockingBytecode, BigInt(startBlockHeight), BigInt(periodLengthBlocks),
        ], { provider });
        const threads = (await provider.getUtxos(borrowing.address)).filter(u => u.token?.category === paryon && u.token.nft?.capability === 'minting');
        if (!threads.length) throw new Error('no borrowing threads found');
        const height = await provider.getBlockHeight();

        let moved = 0;
        for (let i = 0; i < threads.length; i++) {
            const thread = threads[i];
            const fee = feeUtxos[i];
            if (!fee) { console.log('out of fee UTXOs; stopping'); break; }
            const current = decodeBorrowingPeriod(thread.token!.nft!.commitment);
            const nextPeriodStart = startBlockHeight + (current + 1) * periodLengthBlocks;
            if (height < nextPeriodStart) { console.log(`thread at period ${current}: next period starts at height ${nextPeriodStart}, chain at ${height} — waiting ${nextPeriodStart - height} block(s)`); continue; }
            const newPeriod = Math.floor((nextPeriodStart - startBlockHeight) / periodLengthBlocks);
            const tb = new TransactionBuilder({ provider });
            tb.setLocktime(nextPeriodStart);
            tb.addInput(thread, borrowing.unlock.updatePeriodState(), { sequence: 0xfffffffe });
            tb.addInput(fee, sig.unlockP2PKH(), { sequence: 0xfffffffe });
            tb.addOutput({ to: borrowing.tokenAddress, amount: 1000n, token: { category: paryon, amount: thread.token!.amount, nft: { capability: 'minting', commitment: le(newPeriod, 4) } } });
            const change = fee.satoshis - 1000n - 900n;
            if (change > 546n) tb.addOutput({ to: deployerLb, amount: change });
            const txid = await provider.sendRawTransaction(tb.build());
            console.log(`borrowing thread → period ${newPeriod}  tx ${txid.slice(0, 12)}…`);
            moved++;
        }
        console.log(moved ? `\n✅ advanced ${moved} borrowing thread(s).` : '\nNo threads advanced (waiting on block height).');
    } else {
        console.log('usage: keeper-chipnet.ts price [priceCents] | period');
    }
    void lockingBytecodeOf;
    process.exit(0);
}
main().catch(e => { console.error('keeper error:', (e as Error).message); process.exit(1); });
