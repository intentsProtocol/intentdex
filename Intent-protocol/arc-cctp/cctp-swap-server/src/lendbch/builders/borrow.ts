/**
 * src/lendbch/builders/borrow.ts — builds the Borrowing.borrow transaction.
 *
 * Inputs:
 *   0: Borrowing thread UTXO (minting NFT of paryonTokenId, commitment: currentPeriod 4B)
 *   1: PriceContractGuarded thread UTXO (mutable NFT of paryonTokenId, commitment: 0x00 | seq 4B | price 4B)
 *   2: LoanKeyOriginEnforcer UTXO (minting NFT of loanKeyTokenId, 1000 sats, from loanKey tx output 2)
 *   3: LoanKeyOriginProof UTXO (immutable NFT of loanKeyFactoryTokenId, 1000 sats, from loanKey tx output 3)
 *   4..: User BCH UTXO(s) covering collateral + protocol fee + front-end fee + miner fee
 *
 * Outputs:
 *   0: Borrowing thread re-creation (1000 sats, minting NFT)
 *   1: PriceContractGuarded thread re-creation (1000 sats, mutable NFT)
 *   2: Loan contract output (collateral BCH, 27-byte mutable NFT)
 *   3: LoanSidecar output (1000 sats, immutable NFT of loanKeyTokenId, commitment 0x01)
 *   4: Protocol fee output (borrowingFeeBchClamped, protocolFeeLockingBytecode)
 *   5: LoanKey to user (1000 sats, minting NFT of loanKeyTokenId)
 *   6: Borrowed PUSD tokens to user (1000 sats, fungible paryonTokenId tokens)
 *   7?: User BCH change
 *   8?: Front-end fee to our treasury (Decision D1)
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
import { reverseHex, lockingBytecodeOf } from '../deployment.js';
import { deriveFullDeployment } from '../deployFull.js';
import { decodePrice, decodeBorrowingPeriod } from '../state.js';
import { protocolBorrowFeeSats, frontendFeeSats as calcFrontendFeeSats } from '../math.js';
import type { DeploymentParams } from '../types.js';
import { verifyTx, utxosToLibauthSourceOutputs, toLibauthLockingBytecode } from '../verifyTx.js';

export const le = (v: number | bigint, bytes: number): string => {
    let h = '';
    let n = BigInt(v);
    for (let i = 0; i < bytes; i++) {
        h += Number(n & 0xffn).toString(16).padStart(2, '0');
        n >>= 8n;
    }
    return h;
};

export interface BuildBorrowParams {
    params: DeploymentParams;
    provider: NetworkProvider;
    /** User's standard cashaddr. */
    userAddress: string;
    /** User's token-aware cashaddr (where loanKey and PUSD tokens will be sent). */
    userTokenAddress: string;
    /** Borrowing thread UTXO (input 0). */
    borrowingUtxo: Utxo;
    /** PriceContractGuarded thread UTXO (input 1). */
    priceUtxo: Utxo;
    /** LoanKeyOriginEnforcer UTXO (input 2). */
    enforcerUtxo: Utxo;
    /** LoanKeyOriginProof UTXO (input 3). */
    proofUtxo: Utxo;
    /** User BCH collateral/fee UTXOs (inputs 4..). */
    userBchUtxos: Utxo[];
    /** Borrow amount in PUSD cents (e.g. 10000 = $100.00). Must be >= 10000. */
    borrowCents: bigint;
    /** Collateral amount in satoshis to deposit in the loan. */
    collateralSats: bigint;
    /** Starting interest rate (per 10-million per period; e.g. 137). Default: 137. */
    startingRate?: number;
    /** Front-end fee in basis points (0..100; D1 default is 25). */
    frontendFeeBps?: number;
    /** Destination address for the front-end fee. */
    frontendFeeAddress?: string;
    /** Optional user unlocker; defaults to placeholderP2PKHUnlocker. */
    userUnlocker?: Unlocker;
    /** Estimated miner fee in sats (default: 1200). */
    minerFeeSats?: bigint;
}

export interface BuildBorrowResult {
    txHex: string;
    txid: string;
    wcPayload: any;
    sourceOutputs: Utxo[];
    loanTokenId: string;
    borrowedCents: bigint;
    collateralSats: bigint;
    protocolFeeSats: bigint;
    frontendFeeSats: bigint;
}

export function buildBorrowTx(opts: BuildBorrowParams): BuildBorrowResult {
    const {
        params,
        provider,
        userAddress,
        userTokenAddress,
        borrowingUtxo,
        priceUtxo,
        enforcerUtxo,
        proofUtxo,
        userBchUtxos,
        borrowCents,
        collateralSats,
        startingRate = 137,
        frontendFeeBps = 25,
        frontendFeeAddress,
        userUnlocker,
        minerFeeSats = 1200n,
    } = opts;

    if (borrowCents < 10000n) {
        throw new Error(`Minimum borrow is 100.00 PUSD (10000 cents), got ${borrowCents}`);
    }
    if (!userBchUtxos.length) {
        throw new Error('No user BCH UTXOs provided for collateral and fees');
    }

    const d = deriveFullDeployment(params, provider);
    const { paryonTokenId, loanKeyFactoryTokenId, oracleMigrationKeyTokenId } = params.tokenIds;
    const { oraclePublicKey, protocolFeeLockingBytecode, startBlockHeight, periodLengthBlocks } = params.contractParams;

    // Decode oracle price and validate collateral ratio >= 110%
    const priceState = decodePrice(priceUtxo.token!.nft!.commitment);
    const oraclePrice = BigInt(priceState.priceCents);
    const maxBorrowBase = (collateralSats * 10n) / 11n;
    const maxBorrowCents = (maxBorrowBase * oraclePrice) / 100_000_000n;
    if (borrowCents > maxBorrowCents) {
        throw new Error(`Borrow amount ${borrowCents} cents exceeds max borrow ${maxBorrowCents} cents (ratio < 110%)`);
    }

    // Contracts setup
    const borrowingContract = new Contract(paryonArtifacts.artifactBorrowing as any, [
        d.loan.lockingBytecode,
        d.loanSidecar.lockingBytecode,
        protocolFeeLockingBytecode,
        d.loanKeyOriginEnforcer.lockingBytecode,
        BigInt(startBlockHeight),
        BigInt(periodLengthBlocks),
    ], { provider });

    const priceGuarded = new Contract(paryonArtifacts.artifactPriceContractGuarded as any, [
        oraclePublicKey,
        reverseHex(oracleMigrationKeyTokenId),
    ], { provider });

    const enforcerContract = new Contract(paryonArtifacts.loanKey.artifactLoanKeyOriginEnforcer as any, [
        reverseHex(loanKeyFactoryTokenId),
        reverseHex(paryonTokenId),
    ], { provider });

    const proofContract = new Contract(paryonArtifacts.loanKey.artifactLoanKeyOriginProof as any, [], { provider });

    // Function arguments for borrowing.borrow(startingInterest, interestManagerConfig)
    const startingInterestBytes = hexToBin(le(startingRate, 2));
    const interestManagerConfigBytes = hexToBin('0000000000'); // 5 bytes: no manager (00), minRate 0 (0000), maxRate 0 (0000)

    const unlocker = userUnlocker || placeholderP2PKHUnlocker(userAddress);
    const tb = new TransactionBuilder({ provider });

    // Input 0: Borrowing thread
    tb.addInput(borrowingUtxo, borrowingContract.unlock.borrow(startingInterestBytes, interestManagerConfigBytes));
    // Input 1: PriceContractGuarded thread
    tb.addInput(priceUtxo, priceGuarded.unlock.sharePrice());
    // Input 2: LoanKeyOriginEnforcer
    tb.addInput(enforcerUtxo, enforcerContract.unlock.enforce());
    // Input 3: LoanKeyOriginProof
    tb.addInput(proofUtxo, proofContract.unlock.attach());
    // Input 4..: User BCH UTXOs
    for (const u of userBchUtxos) {
        tb.addInput(u, unlocker);
    }

    const loanKeyTokenId = enforcerUtxo.token!.category;
    const periodBorrowingBytes = borrowingUtxo.token!.nft!.commitment; // 4-byte LE period

    // 27-byte loan commitment
    // 0x01 + borrowedAmount 6B + 0 6B + 0x00 + periodBorrowing 4B + rate 2B + rate 2B + managerConfig 5B
    const loanCommitment = '01' +
        le(borrowCents, 6) +
        le(0n, 6) +
        '00' +
        periodBorrowingBytes +
        le(startingRate, 2) +
        le(startingRate, 2) +
        '0000000000';

    // Output 0: Re-create Borrowing contract
    const remainingParyonSupply = borrowingUtxo.token!.amount - borrowCents;
    tb.addOutput({
        to: borrowingContract.tokenAddress,
        amount: 1000n,
        token: {
            category: paryonTokenId,
            amount: remainingParyonSupply,
            nft: { capability: 'minting', commitment: periodBorrowingBytes },
        },
    });

    // Output 1: Re-create PriceContractGuarded
    tb.addOutput({
        to: priceGuarded.tokenAddress,
        amount: 1000n,
        token: {
            category: paryonTokenId,
            amount: 0n,
            nft: { capability: 'mutable', commitment: priceUtxo.token!.nft!.commitment },
        },
    });

    // Output 2: Loan contract holding collateral BCH
    tb.addOutput({
        to: d.loan.tokenAddress,
        amount: collateralSats,
        token: {
            category: paryonTokenId,
            amount: 0n,
            nft: { capability: 'mutable', commitment: loanCommitment },
        },
    });

    // Output 3: LoanSidecar
    tb.addOutput({
        to: d.loanSidecar.tokenAddress,
        amount: 1000n,
        token: {
            category: loanKeyTokenId,
            amount: 0n,
            nft: { capability: 'none', commitment: '01' },
        },
    });

    // Output 4: Protocol fee
    const protoFee = protocolBorrowFeeSats(borrowCents, oraclePrice);
    tb.addOutput({
        to: toLibauthLockingBytecode(protocolFeeLockingBytecode),
        amount: protoFee,
    });

    // Output 5: LoanKey to user
    tb.addOutput({
        to: userTokenAddress,
        amount: 1000n,
        token: {
            category: loanKeyTokenId,
            amount: 0n,
            nft: { capability: 'minting', commitment: '' },
        },
    });

    // Output 6: Borrowed PUSD tokens to user
    tb.addOutput({
        to: userTokenAddress,
        amount: 1000n,
        token: {
            category: paryonTokenId,
            amount: borrowCents,
        },
    });

    // Output 7..9: Front-end fee and BCH change
    const fFee = calcFrontendFeeSats(borrowCents, oraclePrice, frontendFeeBps);
    let feeAdded = false;
    if (fFee > 0n && frontendFeeAddress) {
        feeAdded = true;
    }

    const totalInputSats = BigInt(borrowingUtxo.satoshis) +
        BigInt(priceUtxo.satoshis) +
        BigInt(enforcerUtxo.satoshis) +
        BigInt(proofUtxo.satoshis) +
        userBchUtxos.reduce((s, u) => s + BigInt(u.satoshis), 0n);

    const fixedOutputSats = 1000n + 1000n + collateralSats + 1000n + protoFee + 1000n + 1000n + (feeAdded ? fFee : 0n);
    const changeSats = totalInputSats - fixedOutputSats - minerFeeSats;

    if (changeSats < 0n) {
        throw new Error(`Insufficient user BCH: inputs ${totalInputSats} sats, outputs ${fixedOutputSats + minerFeeSats} sats (short by ${-(changeSats)} sats)`);
    }

    if (changeSats >= 546n) {
        tb.addOutput({
            to: userAddress,
            amount: changeSats,
        });
    }

    if (feeAdded && frontendFeeAddress) {
        tb.addOutput({
            to: frontendFeeAddress,
            amount: fFee,
        });
    }

    const txHex = tb.build();
    const sourceUtxos: Utxo[] = [borrowingUtxo, priceUtxo, enforcerUtxo, proofUtxo, ...userBchUtxos];
    const libauthSourceOutputs = utxosToLibauthSourceOutputs(sourceUtxos, (_u, idx) => {
        if (idx === 0) return d.borrowing.lockingBytecode;
        if (idx === 1) return d.priceGuarded.lockingBytecode;
        if (idx === 2) return d.loanKeyOriginEnforcer.lockingBytecode;
        if (idx === 3) return d.loanKeyOriginProof.lockingBytecode;
        return userAddress;
    });

    // Verify all 4 contract inputs (borrowing, price, enforcer, proof) in the VM and check guard rules
    verifyTx({
        txHex,
        sourceOutputs: libauthSourceOutputs,
        userAddress,
        action: 'borrow',
        contractInputIndices: [0, 1, 2, 3],
        expectedProtocolFeeSats: protoFee,
        expectedProtocolFeeLockingBytecode: protocolFeeLockingBytecode,
        expectedFrontendFeeSats: feeAdded ? fFee : 0n,
        expectedFrontendFeeAddress: feeAdded ? frontendFeeAddress : undefined,
        expectedLoanKeyCategory: loanKeyTokenId,
        paryonTokenId,
        expectedBorrowedCents: borrowCents,
    });

    const wcPayload = tb.generateWcTransactionObject({
        broadcast: false,
        userPrompt: `Borrow ${Number(borrowCents) / 100} PUSD against ${Number(collateralSats) / 1e8} BCH`,
    });

    const txid = binToHex(sha256.hash(sha256.hash(hexToBin(txHex))).reverse());

    return {
        txHex,
        txid,
        wcPayload,
        sourceOutputs: sourceUtxos,
        loanTokenId: loanKeyTokenId,
        borrowedCents: borrowCents,
        collateralSats,
        protocolFeeSats: protoFee,
        frontendFeeSats: feeAdded ? fFee : 0n,
    };
}
