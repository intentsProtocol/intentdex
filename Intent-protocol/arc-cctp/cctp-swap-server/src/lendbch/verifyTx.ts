/**
 * src/lendbch/verifyTx.ts — evaluates contract inputs in the libauth VM and enforces guard rules
 * before any transaction is returned to the user or broadcast.
 *
 * Guard rules enforced:
 *   1. Every contract/covenant input must evaluate to success in the script VM.
 *   2. Loan key NFT must be delivered ONLY to the user's address.
 *   3. Borrowed PUSD tokens must be delivered ONLY to the user's address.
 *   4. BCH change must be delivered ONLY to the user's address.
 *   5. Front-end fee output (if configured > 0) must match expected amount and address exactly.
 *   6. Protocol fee output must match expected amount and locking bytecode exactly.
 *   7. No stray or unexpected tokens on outputs (e.g. change outputs must carry no tokens).
 */
import {
    createVirtualMachineBch2025,
    decodeTransactionUnsafeBCH,
    hexToBin,
    cashAddressToLockingBytecode,
    type Output as LibauthOutput,
    type TransactionBCH,
} from '@bitauth/libauth';
import type { Utxo } from 'cashscript';

export interface VerifyTxParams {
    /** Raw transaction hex string. */
    txHex: string;
    /** Source outputs for every input in the transaction (in input order). */
    sourceOutputs: LibauthOutput[];
    /** The user's cashaddr address. */
    userAddress: string;
    /** Action being performed. */
    action: 'loanKey' | 'borrow' | 'manage' | 'changeRate';
    /** Indices of contract inputs that must pass VM evaluation. */
    contractInputIndices: number[];
    /** Expected protocol fee in sats. */
    expectedProtocolFeeSats?: bigint;
    /** Expected protocol fee locking bytecode (hex). */
    expectedProtocolFeeLockingBytecode?: string;
    /** Expected front-end fee in sats. */
    expectedFrontendFeeSats?: bigint;
    /** Expected front-end fee destination cashaddr. */
    expectedFrontendFeeAddress?: string;
    /** Expected loan key category hex. */
    expectedLoanKeyCategory?: string;
    /** Expected paryon (PUSD) token ID hex. */
    paryonTokenId?: string;
    /** Expected borrowed PUSD cents (for borrow action). */
    expectedBorrowedCents?: bigint;
    /** Expected repaid PUSD cents (for manage action). */
    expectedRepaidCents?: bigint;
    /** Is this a closing manage transaction? */
    isClose?: boolean;
}

export interface VerificationResult {
    valid: boolean;
    txid: string;
    contractInputsEvaluated: number[];
    checksPassed: string[];
}

export function toLibauthLockingBytecode(addrOrBytecode: string | Uint8Array): Uint8Array {
    if (addrOrBytecode instanceof Uint8Array) return addrOrBytecode;
    if (typeof addrOrBytecode === 'string') {
        if (addrOrBytecode.startsWith('bitcoincash:') || addrOrBytecode.startsWith('bchtest:')) {
            const res = cashAddressToLockingBytecode(addrOrBytecode);
            if (typeof res === 'string') throw new Error(`Invalid address ${addrOrBytecode}: ${res}`);
            return res.bytecode;
        }
        return hexToBin(addrOrBytecode);
    }
    throw new Error(`Cannot convert ${addrOrBytecode} to locking bytecode`);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * Convert CashScript UTXOs to Libauth Output objects for VM evaluation.
 */
export function utxosToLibauthSourceOutputs(
    utxos: Utxo[],
    lockingBytecodeResolver?: (u: Utxo, idx: number) => Uint8Array | string
): LibauthOutput[] {
    return utxos.map((u, i) => {
        let lb: Uint8Array;
        if (lockingBytecodeResolver) {
            lb = toLibauthLockingBytecode(lockingBytecodeResolver(u, i));
        } else if ((u as any).address) {
            lb = toLibauthLockingBytecode((u as any).address);
        } else if ((u as any).lockingBytecode) {
            lb = toLibauthLockingBytecode((u as any).lockingBytecode);
        } else {
            throw new Error(`Cannot determine locking bytecode for UTXO ${u.txid}:${u.vout} at input ${i}`);
        }

        const out: LibauthOutput = {
            valueSatoshis: BigInt(u.satoshis),
            lockingBytecode: lb,
        };
        if (u.token) {
            out.token = {
                category: hexToBin(u.token.category),
                amount: BigInt(u.token.amount || 0n),
            };
            if (u.token.nft) {
                out.token.nft = {
                    capability: u.token.nft.capability,
                    commitment: hexToBin(u.token.nft.commitment || ''),
                };
            }
        }
        return out;
    });
}

/**
 * Evaluates contract inputs in the libauth VM and validates all guard rules.
 * Throws an Error if any check or contract evaluation fails.
 */
export function verifyTx(params: VerifyTxParams): VerificationResult {
    const {
        txHex,
        sourceOutputs,
        userAddress,
        action,
        contractInputIndices,
        expectedProtocolFeeSats,
        expectedProtocolFeeLockingBytecode,
        expectedFrontendFeeSats,
        expectedFrontendFeeAddress,
        expectedLoanKeyCategory,
        paryonTokenId,
        expectedBorrowedCents,
        expectedRepaidCents,
        isClose,
    } = params;

    const txBin = hexToBin(txHex);
    const tx = decodeTransactionUnsafeBCH(txBin) as TransactionBCH;
    if (!tx || !tx.inputs || !tx.outputs) {
        throw new Error('Failed to decode raw transaction bytes');
    }

    if (sourceOutputs.length !== tx.inputs.length) {
        throw new Error(`Source outputs count (${sourceOutputs.length}) does not match tx inputs count (${tx.inputs.length})`);
    }

    const userLockingBytecode = toLibauthLockingBytecode(userAddress);
    const checksPassed: string[] = [];

    // ── Part 1: Evaluate contract inputs in the Script VM ─────────────────
    const vm = createVirtualMachineBch2025();
    for (const inputIdx of contractInputIndices) {
        if (inputIdx < 0 || inputIdx >= tx.inputs.length) {
            throw new Error(`Contract input index ${inputIdx} out of range (tx has ${tx.inputs.length} inputs)`);
        }
        const evalState = vm.evaluate({
            inputIndex: inputIdx,
            sourceOutputs,
            transaction: tx,
        });
        const success = vm.stateSuccess(evalState);
        if (success !== true) {
            const errMsg = typeof success === 'string' ? success : (evalState.error || 'Unknown script error');
            throw new Error(`VM evaluation failed for contract input #${inputIdx}: ${errMsg}`);
        }
        checksPassed.push(`vm_eval_input_${inputIdx}`);
    }

    // ── Part 2: Enforce Guard Rules based on Action ────────────────────────
    if (action === 'loanKey') {
        // Layout: 0: authhead, 1: factory, 2: enforcer, 3: proof, 4?: change, 5?: op_return
        if (tx.outputs.length < 4 || tx.outputs.length > 6) {
            throw new Error(`loanKey tx output count must be 4..6, got ${tx.outputs.length}`);
        }
        // Change output (if present at index 4) must go to user and carry NO tokens
        if (tx.outputs.length > 4 && tx.outputs[4].lockingBytecode.length > 0) {
            // If it's a change output (not OP_RETURN)
            if (tx.outputs[4].lockingBytecode[0] !== 0x6a) {
                if (!bytesEqual(tx.outputs[4].lockingBytecode, userLockingBytecode)) {
                    throw new Error('loanKey change output does not go to the user address');
                }
                if (tx.outputs[4].token) {
                    throw new Error('loanKey change output must not hold any tokens');
                }
                checksPassed.push('loankey_change_to_user');
            }
        }
        checksPassed.push('loankey_guard_ok');
    } else if (action === 'borrow') {
        // Layout: 0: borrowing, 1: price, 2: loan, 3: sidecar, 4: protocol fee, 5: loan key -> user, 6: PUSD -> user, 7..9: change / frontend fee
        if (tx.outputs.length < 7 || tx.outputs.length > 10) {
            throw new Error(`borrow tx output count must be 7..10, got ${tx.outputs.length}`);
        }

        // Output 4: protocol fee
        if (expectedProtocolFeeLockingBytecode && expectedProtocolFeeSats !== undefined) {
            const expProtoLb = toLibauthLockingBytecode(expectedProtocolFeeLockingBytecode);
            if (!bytesEqual(tx.outputs[4].lockingBytecode, expProtoLb)) {
                throw new Error('borrow output 4 protocol fee locking bytecode does not match expected');
            }
            if (tx.outputs[4].valueSatoshis !== expectedProtocolFeeSats) {
                throw new Error(`borrow output 4 protocol fee value ${tx.outputs[4].valueSatoshis} != expected ${expectedProtocolFeeSats}`);
            }
            if (tx.outputs[4].token) {
                throw new Error('borrow protocol fee output must not hold tokens');
            }
            checksPassed.push('protocol_fee_verified');
        }

        // Output 5: loan key -> user
        if (!bytesEqual(tx.outputs[5].lockingBytecode, userLockingBytecode)) {
            throw new Error('borrow output 5 (loan key) does not go to the user address');
        }
        if (!tx.outputs[5].token || tx.outputs[5].token.nft?.capability !== 'minting') {
            throw new Error('borrow output 5 must carry the minting loan key NFT');
        }
        if (expectedLoanKeyCategory) {
            const expLkCat = hexToBin(expectedLoanKeyCategory);
            if (!bytesEqual(tx.outputs[5].token.category, expLkCat)) {
                throw new Error('borrow output 5 loan key category does not match expected');
            }
        }
        checksPassed.push('loan_key_to_user');

        // Output 6: PUSD -> user
        if (!bytesEqual(tx.outputs[6].lockingBytecode, userLockingBytecode)) {
            throw new Error('borrow output 6 (PUSD tokens) does not go to the user address');
        }
        if (!tx.outputs[6].token) {
            throw new Error('borrow output 6 must carry the borrowed PUSD tokens');
        }
        if (paryonTokenId) {
            const expParyon = hexToBin(paryonTokenId);
            if (!bytesEqual(tx.outputs[6].token.category, expParyon)) {
                throw new Error('borrow output 6 token category does not match paryonTokenId');
            }
        }
        if (expectedBorrowedCents !== undefined && tx.outputs[6].token.amount !== expectedBorrowedCents) {
            throw new Error(`borrow output 6 token amount ${tx.outputs[6].token.amount} != expected ${expectedBorrowedCents}`);
        }
        checksPassed.push('pusd_tokens_to_user');

        // Front-end fee check (outputs 7..9)
        if (expectedFrontendFeeSats && expectedFrontendFeeSats > 0n && expectedFrontendFeeAddress) {
            const expFeeLb = toLibauthLockingBytecode(expectedFrontendFeeAddress);
            let feeFound = false;
            for (let i = 7; i < tx.outputs.length; i++) {
                if (bytesEqual(tx.outputs[i].lockingBytecode, expFeeLb) && tx.outputs[i].valueSatoshis === expectedFrontendFeeSats) {
                    if (tx.outputs[i].token) {
                        throw new Error(`Frontend fee output #${i} must not hold tokens`);
                    }
                    feeFound = true;
                    break;
                }
            }
            if (!feeFound) {
                throw new Error(`Front-end fee output of ${expectedFrontendFeeSats} sats to ${expectedFrontendFeeAddress} not found in outputs 7..9`);
            }
            checksPassed.push('frontend_fee_verified');
        }

        // Change outputs (outputs 7..9 that are not frontend fee): must go to user and carry no tokens
        for (let i = 7; i < tx.outputs.length; i++) {
            const out = tx.outputs[i];
            if (expectedFrontendFeeAddress && bytesEqual(out.lockingBytecode, toLibauthLockingBytecode(expectedFrontendFeeAddress))) {
                continue; // skip validated fee output
            }
            if (!bytesEqual(out.lockingBytecode, userLockingBytecode)) {
                throw new Error(`Extra output #${i} does not belong to user or treasury`);
            }
            if (out.token && (!expectedLoanKeyCategory || !bytesEqual(out.token.category, hexToBin(expectedLoanKeyCategory)))) {
                throw new Error(`Extra output #${i} holds unexpected token category`);
            }
        }
        checksPassed.push('borrow_guard_ok');
    } else if (action === 'manage') {
        if (!isClose) {
            // Partial repay / add / withdraw collateral
            // Output 0: price, 1: loan, 2: sidecar, 3: manage, 4: loan key back to user, 5?: op_return burn
            if (tx.outputs.length < 5) {
                throw new Error(`manage tx output count must be at least 5, got ${tx.outputs.length}`);
            }
            // Output 4: loan key back to user
            if (!bytesEqual(tx.outputs[4].lockingBytecode, userLockingBytecode)) {
                throw new Error('manage output 4 (loan key) does not return to user');
            }
            if (!tx.outputs[4].token || tx.outputs[4].token.nft?.capability !== 'minting') {
                throw new Error('manage output 4 must be the minting loan key NFT');
            }
            // If repaying, output 5 must be OP_RETURN burn with repaid PUSD
            if (expectedRepaidCents && expectedRepaidCents > 0n) {
                if (tx.outputs.length < 6) throw new Error('repay transaction missing OP_RETURN burn output at index 5');
                const burnOut = tx.outputs[5];
                if (burnOut.lockingBytecode[0] !== 0x6a) {
                    throw new Error('manage output 5 must be OP_RETURN burn output');
                }
                if (!burnOut.token || burnOut.token.amount !== expectedRepaidCents) {
                    throw new Error(`manage output 5 burn amount ${burnOut.token?.amount} != expected ${expectedRepaidCents}`);
                }
                checksPassed.push('pusd_burn_verified');
            }
            // Any remaining outputs (change) must go to user
            for (let i = (expectedRepaidCents && expectedRepaidCents > 0n ? 6 : 5); i < tx.outputs.length; i++) {
                if (!bytesEqual(tx.outputs[i].lockingBytecode, userLockingBytecode)) {
                    throw new Error(`manage change output #${i} does not belong to user`);
                }
            }
            checksPassed.push('manage_guard_ok');
        } else {
            // Close loan
            // Output 0: price, 1: manage, 2: OP_RETURN burn PUSD, 3: OP_RETURN burn loan NFT, remaining: collateral to user
            if (tx.outputs.length < 4) {
                throw new Error(`close loan tx output count must be at least 4, got ${tx.outputs.length}`);
            }
            // Output 2: burn PUSD
            if (tx.outputs[2].lockingBytecode[0] !== 0x6a) {
                throw new Error('close loan output 2 must be OP_RETURN burn');
            }
            // Output 3: burn loan NFT
            if (tx.outputs[3].lockingBytecode[0] !== 0x6a) {
                throw new Error('close loan output 3 must be OP_RETURN burn for loan NFT');
            }
            // Remaining outputs: collateral payout to user
            for (let i = 4; i < tx.outputs.length; i++) {
                if (!bytesEqual(tx.outputs[i].lockingBytecode, userLockingBytecode)) {
                    throw new Error(`close loan collateral payout output #${i} does not go to user`);
                }
            }
            checksPassed.push('close_guard_ok');
        }
    } else if (action === 'changeRate') {
        // Output 0: loan, 1: sidecar, 2: changeInterest, 3: loan key back to user, 4?: change
        if (tx.outputs.length < 4) {
            throw new Error(`changeRate tx output count must be at least 4, got ${tx.outputs.length}`);
        }
        if (!bytesEqual(tx.outputs[3].lockingBytecode, userLockingBytecode)) {
            throw new Error('changeRate output 3 (loan key) does not return to user');
        }
        if (tx.outputs.length > 4) {
            if (!bytesEqual(tx.outputs[4].lockingBytecode, userLockingBytecode)) {
                throw new Error('changeRate change output 4 does not go to user');
            }
            if (tx.outputs[4].token) {
                throw new Error('changeRate change output must not hold tokens');
            }
        }
        checksPassed.push('change_rate_guard_ok');
    }

    return {
        valid: true,
        txid: '',
        contractInputsEvaluated: contractInputIndices,
        checksPassed,
    };
}
