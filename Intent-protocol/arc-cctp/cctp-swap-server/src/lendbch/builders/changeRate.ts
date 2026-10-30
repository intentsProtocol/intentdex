/**
 * src/lendbch/builders/changeRate.ts — builds the changeInterest transaction.
 * Updates the loan's next period interest rate.
 *
 * Inputs:
 *   0: Loan UTXO (holding collateral BCH + 27-byte mutable NFT)
 *   1: LoanSidecar UTXO (holding loanTokenId NFT, 1000 sats)
 *   2: changeInterest function thread UTXO (immutable NFT of paryonTokenId, commitment 0x08)
 *   3: LoanKey UTXO from user (minting NFT of loanKeyTokenId)
 *   4..: User BCH UTXO(s) for fees
 *
 * Outputs:
 *   0: Loan contract re-creation (same collateral, updated nextInterestRate in commitment)
 *   1: LoanSidecar re-creation (1000 sats, immutable NFT)
 *   2: changeInterest thread re-creation (1000 sats, immutable NFT)
 *   3: LoanKey back to user (1000 sats, minting NFT)
 *   4?: User BCH change
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
import { hexToBin, binToHex, sha256 } from '@bitauth/libauth';
import { deriveFullDeployment } from '../deployFull.js';
import { decodeLoan } from '../state.js';
import type { DeploymentParams } from '../types.js';
import { verifyTx, utxosToLibauthSourceOutputs } from '../verifyTx.js';
import { le } from './borrow.js';

export interface BuildChangeRateParams {
    params: DeploymentParams;
    provider: NetworkProvider;
    userAddress: string;
    userTokenAddress: string;
    loanUtxo: Utxo;
    sidecarUtxo: Utxo;
    changeRateUtxo: Utxo;
    loanKeyUtxo: Utxo;
    userBchUtxos: Utxo[];
    /** New interest rate per 10-million per period (0..1000000; e.g. 137). */
    nextRate: number;
    userUnlocker?: Unlocker;
    minerFeeSats?: bigint;
}

export interface BuildChangeRateResult {
    txHex: string;
    txid: string;
    wcPayload: any;
    sourceOutputs: Utxo[];
    nextRate: number;
}

export function buildChangeRateTx(opts: BuildChangeRateParams): BuildChangeRateResult {
    const {
        params,
        provider,
        userAddress,
        userTokenAddress,
        loanUtxo,
        sidecarUtxo,
        changeRateUtxo,
        loanKeyUtxo,
        userBchUtxos,
        nextRate,
        userUnlocker,
        minerFeeSats = 1200n,
    } = opts;

    if (nextRate < 0) {
        throw new Error(`nextRate must be non-negative, got ${nextRate}`);
    }

    const d = deriveFullDeployment(params, provider);
    const { paryonTokenId } = params.tokenIds;

    const loanContract = new Contract(paryonArtifacts.artifactLoan as any, [], { provider });
    const sidecarContract = new Contract(paryonArtifacts.artifactLoanSidecar as any, [], { provider });
    const changeInterestContract = new Contract(paryonArtifacts.loanContractFunctions.artifactFunctionChangeInterest as any, [], { provider });

    const nextRateBytes = hexToBin(le(nextRate, 2));
    const unlocker = userUnlocker || placeholderP2PKHUnlocker(userAddress);
    const tb = new TransactionBuilder({ provider });

    // Inputs:
    // 0: loan, 1: sidecar, 2: changeInterest, 3: loanKey
    tb.addInput(loanUtxo, loanContract.unlock.interact());
    tb.addInput(sidecarUtxo, sidecarContract.unlock.attach());
    tb.addInput(changeRateUtxo, changeInterestContract.unlock.changeInterest(nextRateBytes));
    tb.addInput(loanKeyUtxo, unlocker);

    // Inputs 4..: User BCH UTXOs
    for (const u of userBchUtxos) {
        tb.addInput(u, unlocker);
    }

    const loanKeyTokenId = sidecarUtxo.token!.category;

    // 27-byte updated loan commitment:
    // bytes20 fixedPartLoanState = loanState.split(20)[0] (first 20 bytes = 40 hex chars)
    // newLoanCommitment = fixedPartLoanState + nextInterestRate(2 bytes) + interestManagerConfiguration(5 bytes)
    const oldCommitmentHex = loanUtxo.token!.nft!.commitment;
    const fixedPartHex = oldCommitmentHex.slice(0, 40); // 20 bytes
    const managerConfigHex = oldCommitmentHex.slice(44); // last 5 bytes
    const newLoanCommitment = fixedPartHex + le(nextRate, 2) + managerConfigHex;

    // Output 0: Loan contract re-creation
    tb.addOutput({
        to: d.loan.tokenAddress,
        amount: BigInt(loanUtxo.satoshis),
        token: {
            category: paryonTokenId,
            amount: 0n,
            nft: { capability: 'mutable', commitment: newLoanCommitment },
        },
    });

    // Output 1: LoanSidecar re-creation
    tb.addOutput({
        to: d.loanSidecar.tokenAddress,
        amount: 1000n,
        token: {
            category: loanKeyTokenId,
            amount: 0n,
            nft: { capability: 'none', commitment: '01' },
        },
    });

    // Output 2: changeInterest thread re-creation
    tb.addOutput({
        to: d.loanFunctions[7].tokenAddress,
        amount: 1000n,
        token: {
            category: paryonTokenId,
            amount: 0n,
            nft: { capability: 'none', commitment: '08' },
        },
    });

    // Output 3: LoanKey back to user
    tb.addOutput({
        to: userTokenAddress,
        amount: 1000n,
        token: {
            category: loanKeyTokenId,
            amount: 0n,
            nft: { capability: 'minting', commitment: '' },
        },
    });

    // Change Output
    const totalInputSats = BigInt(loanUtxo.satoshis) +
        BigInt(sidecarUtxo.satoshis) +
        BigInt(changeRateUtxo.satoshis) +
        BigInt(loanKeyUtxo.satoshis) +
        userBchUtxos.reduce((s, u) => s + BigInt(u.satoshis), 0n);

    const explicitOutputSats = BigInt(loanUtxo.satoshis) + 1000n + 1000n + 1000n;
    const changeSats = totalInputSats - explicitOutputSats - minerFeeSats;

    if (changeSats < 0n) {
        throw new Error(`Insufficient BCH: total inputs ${totalInputSats} sats, required ${explicitOutputSats + minerFeeSats} sats`);
    }

    if (changeSats >= 546n) {
        tb.addOutput({
            to: userAddress,
            amount: changeSats,
        });
    }

    const txHex = tb.build();
    const sourceUtxos: Utxo[] = [loanUtxo, sidecarUtxo, changeRateUtxo, loanKeyUtxo, ...userBchUtxos];
    const libauthSourceOutputs = utxosToLibauthSourceOutputs(sourceUtxos, (_u, idx) => {
        if (idx === 0) return d.loan.lockingBytecode;
        if (idx === 1) return d.loanSidecar.lockingBytecode;
        if (idx === 2) return d.loanFunctions[7].lockingBytecode;
        return userAddress;
    });

    // Verify contract inputs [0, 1, 2] in the VM and check guard rules
    verifyTx({
        txHex,
        sourceOutputs: libauthSourceOutputs,
        userAddress,
        action: 'changeRate',
        contractInputIndices: [0, 1, 2],
        expectedLoanKeyCategory: loanKeyTokenId,
        paryonTokenId,
    });

    const wcPayload = tb.generateWcTransactionObject({
        broadcast: false,
        userPrompt: `Change Loan Interest Rate to ${nextRate}`,
    });

    const txid = binToHex(sha256.hash(sha256.hash(hexToBin(txHex))).reverse());

    return {
        txHex,
        txid,
        wcPayload,
        sourceOutputs: sourceUtxos,
        nextRate,
    };
}
