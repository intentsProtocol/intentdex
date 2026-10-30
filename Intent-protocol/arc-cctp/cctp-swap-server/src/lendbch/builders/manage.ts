/**
 * src/lendbch/builders/manage.ts — builds manage transactions:
 *   - add collateral
 *   - withdraw collateral
 *   - repay debt (partial)
 *   - close loan (full repayment)
 *
 * Inputs:
 *   0: PriceContractGuarded thread UTXO
 *   1: Loan UTXO (holding collateral BCH + 27-byte mutable NFT)
 *   2: LoanSidecar UTXO (holding loanTokenId NFT, 1000 sats)
 *   3: ManageLoan function thread UTXO (immutable NFT of paryonTokenId, commitment 0x02)
 *   4: LoanKey UTXO from user (minting NFT of loanKeyTokenId)
 *   5..: User BCH UTXO(s)
 *   6.. (if repaying): User PUSD UTXO(s)
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
import { reverseHex } from '../deployment.js';
import { deriveFullDeployment } from '../deployFull.js';
import { decodePrice, decodeLoan } from '../state.js';
import type { DeploymentParams } from '../types.js';
import { verifyTx, utxosToLibauthSourceOutputs } from '../verifyTx.js';
import { le } from './borrow.js';

export interface BuildManageParams {
    params: DeploymentParams;
    provider: NetworkProvider;
    userAddress: string;
    userTokenAddress: string;
    priceUtxo: Utxo;
    loanUtxo: Utxo;
    sidecarUtxo: Utxo;
    manageUtxo: Utxo;
    loanKeyUtxo: Utxo;
    userBchUtxos: Utxo[];
    userPusdUtxos?: Utxo[];
    actionType: 'add' | 'withdraw' | 'repay' | 'close';
    /** Collateral delta in sats (for add or withdraw). */
    collateralDeltaSats?: bigint;
    /** Repay amount in PUSD cents (for repay or close). */
    repayCents?: bigint;
    userUnlocker?: Unlocker;
    minerFeeSats?: bigint;
}

export interface BuildManageResult {
    txHex: string;
    txid: string;
    wcPayload: any;
    sourceOutputs: Utxo[];
    actionType: 'add' | 'withdraw' | 'repay' | 'close';
    isClose: boolean;
    newCollateralSats: bigint;
    newDebtCents: bigint;
}

export function buildManageTx(opts: BuildManageParams): BuildManageResult {
    const {
        params,
        provider,
        userAddress,
        userTokenAddress,
        priceUtxo,
        loanUtxo,
        sidecarUtxo,
        manageUtxo,
        loanKeyUtxo,
        userBchUtxos,
        userPusdUtxos = [],
        actionType,
        collateralDeltaSats = 0n,
        repayCents = 0n,
        userUnlocker,
        minerFeeSats = 1500n,
    } = opts;

    const d = deriveFullDeployment(params, provider);
    const { paryonTokenId, oracleMigrationKeyTokenId } = params.tokenIds;
    const { oraclePublicKey } = params.contractParams;

    const priceState = decodePrice(priceUtxo.token!.nft!.commitment);
    const loanState = decodeLoan(loanUtxo.token!.nft!.commitment);
    const oraclePrice = BigInt(priceState.priceCents);

    const borrowedAmount = BigInt(loanState.borrowed);
    const amountBeingRedeemed = BigInt(loanState.beingRedeemed);
    const redeemableDebt = borrowedAmount - amountBeingRedeemed;

    let actualRepayCents = repayCents;
    if (actionType === 'close') {
        if (amountBeingRedeemed > 0n) {
            throw new Error(`Cannot close loan with active redemptions (${amountBeingRedeemed} cents being redeemed)`);
        }
        actualRepayCents = borrowedAmount;
    }

    const isClose = actionType === 'close' || (actualRepayCents === redeemableDebt && amountBeingRedeemed === 0n);

    // Calculate new collateral & debt
    let newCollateralSats = BigInt(loanUtxo.satoshis);
    if (actionType === 'add') {
        newCollateralSats += collateralDeltaSats;
    } else if (actionType === 'withdraw') {
        if (amountBeingRedeemed > 0n) {
            throw new Error('Cannot withdraw collateral during ongoing redemptions');
        }
        if (collateralDeltaSats > newCollateralSats) {
            throw new Error(`Withdrawal amount ${collateralDeltaSats} sats exceeds collateral ${newCollateralSats} sats`);
        }
        newCollateralSats -= collateralDeltaSats;
    }

    const newDebtCents = borrowedAmount - actualRepayCents;

    if (!isClose) {
        if (newDebtCents < 10000n) {
            throw new Error(`Remaining debt must be >= 100.00 PUSD (10000 cents), got ${newDebtCents}`);
        }
        if (actualRepayCents > 0n && actualRepayCents < 10000n) {
            throw new Error(`Partial repayment must be >= 100.00 PUSD (10000 cents), got ${actualRepayCents}`);
        }
        // Verify collateral ratio >= 110%
        const maxBorrowBase = (newCollateralSats * 10n) / 11n;
        const maxBorrowCents = (maxBorrowBase * oraclePrice) / 100_000_000n;
        if (newDebtCents > maxBorrowCents) {
            throw new Error(`New debt ${newDebtCents} cents exceeds max borrow ${maxBorrowCents} cents for new collateral (ratio < 110%)`);
        }
    }

    // Contracts setup
    const priceGuarded = new Contract(paryonArtifacts.artifactPriceContractGuarded as any, [
        oraclePublicKey,
        reverseHex(oracleMigrationKeyTokenId),
    ], { provider });

    const loanContract = new Contract(paryonArtifacts.artifactLoan as any, [], { provider });
    const sidecarContract = new Contract(paryonArtifacts.artifactLoanSidecar as any, [], { provider });
    const manageContract = new Contract(paryonArtifacts.loanContractFunctions.artifactFunctionManage as any, [], { provider });

    const interestManagerConfigBytes = hexToBin('0000000000'); // 5 bytes
    const unlocker = userUnlocker || placeholderP2PKHUnlocker(userAddress);
    const tb = new TransactionBuilder({ provider });

    // Inputs:
    // 0: price, 1: loan, 2: sidecar, 3: manage, 4: loanKey
    tb.addInput(priceUtxo, priceGuarded.unlock.sharePrice());
    tb.addInput(loanUtxo, loanContract.unlock.interact());
    tb.addInput(sidecarUtxo, sidecarContract.unlock.attach());
    tb.addInput(manageUtxo, manageContract.unlock.manage(actualRepayCents, interestManagerConfigBytes));
    tb.addInput(loanKeyUtxo, unlocker);

    // Inputs 5..: User BCH UTXOs
    for (const u of userBchUtxos) {
        tb.addInput(u, unlocker);
    }

    // Inputs 6..: User PUSD UTXOs (if repaying)
    for (const u of userPusdUtxos) {
        tb.addInput(u, unlocker);
    }

    const loanKeyTokenId = sidecarUtxo.token!.category;
    const opReturnNullData = new Uint8Array([0x6a]);

    if (!isClose) {
        // Output 0: PriceContractGuarded re-creation
        tb.addOutput({
            to: priceGuarded.tokenAddress,
            amount: 1000n,
            token: {
                category: paryonTokenId,
                amount: 0n,
                nft: { capability: 'mutable', commitment: priceUtxo.token!.nft!.commitment },
            },
        });

        // 27-byte updated loan commitment:
        // 0x01 + toPaddedBytes(newBorrowAmount, 6) + fixedPartLoanState(15) + interestManagerConfiguration(5)
        // From existing commitment: slice from index 7 to 22 (15 bytes)
        const oldCommitmentHex = loanUtxo.token!.nft!.commitment;
        const fixedPartHex = oldCommitmentHex.slice(14, 44); // bytes 7..21 (15 bytes, 30 hex chars)
        const newLoanCommitment = '01' + le(newDebtCents, 6) + fixedPartHex + '0000000000';

        // Output 1: Loan re-creation with newCollateralSats
        tb.addOutput({
            to: d.loan.tokenAddress,
            amount: newCollateralSats,
            token: {
                category: paryonTokenId,
                amount: 0n,
                nft: { capability: 'mutable', commitment: newLoanCommitment },
            },
        });

        // Output 2: LoanSidecar re-creation
        tb.addOutput({
            to: d.loanSidecar.tokenAddress,
            amount: 1000n,
            token: {
                category: loanKeyTokenId,
                amount: 0n,
                nft: { capability: 'none', commitment: '01' },
            },
        });

        // Output 3: manage function thread re-creation
        tb.addOutput({
            to: d.loanFunctions[1].tokenAddress,
            amount: 1000n,
            token: {
                category: paryonTokenId,
                amount: 0n,
                nft: { capability: 'none', commitment: '02' },
            },
        });

        // Output 4: LoanKey back to user
        tb.addOutput({
            to: userTokenAddress,
            amount: 1000n,
            token: {
                category: loanKeyTokenId,
                amount: 0n,
                nft: { capability: 'minting', commitment: '' },
            },
        });

        // Output 5 (if repaying): OP_RETURN burn with repaid PUSD
        if (actualRepayCents > 0n) {
            tb.addOutput({
                to: opReturnNullData,
                amount: 0n,
                token: {
                    category: paryonTokenId,
                    amount: actualRepayCents,
                },
            });
        }
    } else {
        // CLOSE LOAN LAYOUT:
        // Output 0: priceContract
        tb.addOutput({
            to: priceGuarded.tokenAddress,
            amount: 1000n,
            token: {
                category: paryonTokenId,
                amount: 0n,
                nft: { capability: 'mutable', commitment: priceUtxo.token!.nft!.commitment },
            },
        });

        // Output 1: manage function thread re-creation
        tb.addOutput({
            to: d.loanFunctions[1].tokenAddress,
            amount: 1000n,
            token: {
                category: paryonTokenId,
                amount: 0n,
                nft: { capability: 'none', commitment: '02' },
            },
        });

        // Output 2: OP_RETURN burn with repaid PUSD
        tb.addOutput({
            to: opReturnNullData,
            amount: 0n,
            token: {
                category: paryonTokenId,
                amount: actualRepayCents,
            },
        });

        // Output 3: OP_RETURN burn mutable Loan NFT
        tb.addOutput({
            to: opReturnNullData,
            amount: 0n,
            token: {
                category: paryonTokenId,
                amount: 0n,
                nft: { capability: 'mutable', commitment: '' },
            },
        });
    }

    // PUSD Token Change (if user provided more PUSD than repaid)
    const totalPusdInput = userPusdUtxos.reduce((s, u) => s + BigInt(u.token?.amount || 0n), 0n);
    if (totalPusdInput > actualRepayCents) {
        const pusdChange = totalPusdInput - actualRepayCents;
        tb.addOutput({
            to: userTokenAddress,
            amount: 1000n,
            token: {
                category: paryonTokenId,
                amount: pusdChange,
            },
        });
    }

    // BCH Change Calculation
    const totalBchInput = BigInt(priceUtxo.satoshis) +
        BigInt(loanUtxo.satoshis) +
        BigInt(sidecarUtxo.satoshis) +
        BigInt(manageUtxo.satoshis) +
        BigInt(loanKeyUtxo.satoshis) +
        userBchUtxos.reduce((s, u) => s + BigInt(u.satoshis), 0n);

    // Sum explicit non-change BCH outputs
    let explicitBchOutputs = 1000n; // price
    if (!isClose) {
        explicitBchOutputs += newCollateralSats + 1000n + 1000n + 1000n; // loan, sidecar, manage, loanKey
    } else {
        explicitBchOutputs += 1000n; // manage
    }
    if (totalPusdInput > actualRepayCents) {
        explicitBchOutputs += 1000n; // pusd change dust
    }

    const changeSats = totalBchInput - explicitBchOutputs - minerFeeSats;
    if (changeSats < 0n) {
        throw new Error(`Insufficient BCH: inputs ${totalBchInput} sats, outputs ${explicitBchOutputs + minerFeeSats} sats (short by ${-(changeSats)} sats)`);
    }

    if (changeSats >= 546n) {
        tb.addOutput({
            to: userAddress,
            amount: changeSats,
        });
    }

    const txHex = tb.build();
    const sourceUtxos: Utxo[] = [priceUtxo, loanUtxo, sidecarUtxo, manageUtxo, loanKeyUtxo, ...userBchUtxos, ...userPusdUtxos];
    const libauthSourceOutputs = utxosToLibauthSourceOutputs(sourceUtxos, (_u, idx) => {
        if (idx === 0) return d.priceGuarded.lockingBytecode;
        if (idx === 1) return d.loan.lockingBytecode;
        if (idx === 2) return d.loanSidecar.lockingBytecode;
        if (idx === 3) return d.loanFunctions[1].lockingBytecode;
        return userAddress;
    });

    // Verify contract inputs [0, 1, 2, 3] in the VM and check guard rules
    verifyTx({
        txHex,
        sourceOutputs: libauthSourceOutputs,
        userAddress,
        action: 'manage',
        contractInputIndices: [0, 1, 2, 3],
        paryonTokenId,
        expectedLoanKeyCategory: loanKeyTokenId,
        expectedRepaidCents: actualRepayCents,
        isClose,
    });

    const wcPayload = tb.generateWcTransactionObject({
        broadcast: false,
        userPrompt: `Manage Loan: ${actionType.toUpperCase()}`,
    });

    const txid = binToHex(sha256.hash(sha256.hash(hexToBin(txHex))).reverse());

    return {
        txHex,
        txid,
        wcPayload,
        sourceOutputs: sourceUtxos,
        actionType,
        isClose,
        newCollateralSats,
        newDebtCents,
    };
}
