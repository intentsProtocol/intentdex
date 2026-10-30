/**
 * src/lendbch/builders/loanKey.ts — builds the LoanKeyFactory.create transaction.
 *
 * Inputs:
 *   0: User UTXO with outpointIndex 0 (its txid becomes the unique reservedTokenId)
 *   1: LoanKeyFactory thread UTXO (minting NFT of loanKeyFactoryTokenId)
 *   2..: User funding/fee BCH UTXO(s)
 *
 * Outputs:
 *   0: Authhead (BCMR metadata standard) -> treasury address (Decision D3)
 *   1: LoanKeyFactory thread re-creation (1000 sats, minting NFT)
 *   2: LoanKeyOriginEnforcer (1000 sats, minting NFT of reservedTokenId)
 *   3: LoanKeyOriginProof (1000 sats, immutable NFT of loanKeyFactoryTokenId)
 *   4?: BCH change back to user
 */
import {
    Contract,
    TransactionBuilder,
    placeholderP2PKHUnlocker,
    type Unlocker,
    type Utxo,
    type NetworkProvider,
} from 'cashscript';
import { paryonArtifacts } from '@paryonusd/contracts';
import { binToHex, hexToBin, sha256 } from '@bitauth/libauth';
import { lockingBytecodeOf } from '../deployment.js';
import { deriveFullDeployment } from '../deployFull.js';
import type { DeploymentParams } from '../types.js';
import { verifyTx, utxosToLibauthSourceOutputs } from '../verifyTx.js';

export interface BuildLoanKeyParams {
    params: DeploymentParams;
    provider: NetworkProvider;
    /** User's cashaddr address. */
    userAddress: string;
    /** User UTXO with vout === 0 that defines the new token category (input 0). */
    genesisUtxo: Utxo;
    /** LoanKeyFactory thread UTXO (input 1). */
    factoryUtxo: Utxo;
    /** Additional user BCH UTXOs to cover fees/output dust. */
    feeUtxos: Utxo[];
    /** Optional explicit user unlocker (e.g. for testing/scripts); defaults to placeholder. */
    userUnlocker?: Unlocker;
    /** Address to receive the authchain head (output 0); defaults to treasury address. */
    treasuryAddress?: string;
    /** Estimated miner fee in sats (default 1000). */
    feeSats?: bigint;
}

export interface BuildLoanKeyResult {
    txHex: string;
    txid: string;
    reservedTokenId: string;
    wcPayload: any;
    sourceOutputs: Utxo[];
    enforcerOutpoint: { txid: string; vout: number };
    proofOutpoint: { txid: string; vout: number };
}

export function buildCreateLoanKeyTx(opts: BuildLoanKeyParams): BuildLoanKeyResult {
    const {
        params,
        provider,
        userAddress,
        genesisUtxo,
        factoryUtxo,
        feeUtxos,
        userUnlocker,
        treasuryAddress,
        feeSats = 1000n,
    } = opts;

    if (genesisUtxo.vout !== 0) {
        throw new Error(`genesisUtxo outpointIndex must be 0, got ${genesisUtxo.vout}`);
    }

    const d = deriveFullDeployment(params, provider);
    const factoryContract = new Contract(paryonArtifacts.loanKey.artifactLoanKeyFactory as any, [
        d.loanKeyOriginEnforcer.lockingBytecode,
        d.loanKeyOriginProof.lockingBytecode,
    ], { provider });

    const unlocker = userUnlocker || placeholderP2PKHUnlocker(userAddress);
    const tb = new TransactionBuilder({ provider });

    // Input 0: genesis outpoint (vout 0)
    tb.addInput(genesisUtxo, unlocker);
    // Input 1: factory thread
    tb.addInput(factoryUtxo, factoryContract.unlock.create());
    // Input 2..: fee UTXOs
    for (const u of feeUtxos) {
        tb.addInput(u, unlocker);
    }

    const reservedTokenId = genesisUtxo.txid;
    const lkfTokenId = params.tokenIds.loanKeyFactoryTokenId;
    const authTarget = treasuryAddress || userAddress;

    // Output 0: authhead (1000 sats, BCMR standard)
    tb.addOutput({
        to: authTarget,
        amount: 1000n,
    });

    // Output 1: LoanKeyFactory re-creation
    tb.addOutput({
        to: factoryContract.tokenAddress,
        amount: 1000n,
        token: {
            category: lkfTokenId,
            amount: 0n,
            nft: { capability: 'minting', commitment: '' },
        },
    });

    // Output 2: LoanKeyOriginEnforcer
    tb.addOutput({
        to: d.loanKeyOriginEnforcer.tokenAddress,
        amount: 1000n,
        token: {
            category: reservedTokenId,
            amount: 0n,
            nft: { capability: 'minting', commitment: '' },
        },
    });

    // Output 3: LoanKeyOriginProof
    tb.addOutput({
        to: d.loanKeyOriginProof.tokenAddress,
        amount: 1000n,
        token: {
            category: lkfTokenId,
            amount: 0n,
            nft: { capability: 'none', commitment: '' },
        },
    });

    // Output 4: BCH change back to user
    const totalInputSats = BigInt(genesisUtxo.satoshis) + BigInt(factoryUtxo.satoshis) + feeUtxos.reduce((s, u) => s + BigInt(u.satoshis), 0n);
    const fixedOutputSats = 1000n + 1000n + 1000n + 1000n; // outputs 0..3
    const changeSats = totalInputSats - fixedOutputSats - feeSats;

    if (changeSats < 0n) {
        throw new Error(`Insufficient funds: total inputs ${totalInputSats} sats, need at least ${fixedOutputSats + feeSats} sats`);
    }
    if (changeSats >= 546n) {
        tb.addOutput({
            to: userAddress,
            amount: changeSats,
        });
    }

    const txHex = tb.build();
    const sourceUtxos: Utxo[] = [genesisUtxo, factoryUtxo, ...feeUtxos];
    const libauthSourceOutputs = utxosToLibauthSourceOutputs(sourceUtxos, (_u, idx) => {
        if (idx === 1) return d.loanKeyFactory.lockingBytecode;
        return userAddress;
    });

    // Verify contract input 1 (LoanKeyFactory) in the VM and check guard rules
    verifyTx({
        txHex,
        sourceOutputs: libauthSourceOutputs,
        userAddress,
        action: 'loanKey',
        contractInputIndices: [1],
    });

    const wcPayload = tb.generateWcTransactionObject({
        broadcast: false,
        userPrompt: 'Create LendBCH Loan Key',
    });

    const txid = binToHex(sha256.hash(sha256.hash(hexToBin(txHex))).reverse());

    return {
        txHex,
        txid,
        reservedTokenId,
        wcPayload,
        sourceOutputs: sourceUtxos,
        enforcerOutpoint: { txid, vout: 2 },
        proofOutpoint: { txid, vout: 3 },
    };
}
