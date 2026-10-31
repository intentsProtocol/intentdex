/**
 * The handful of EVM contract calls the wallet makes, ABI-encoded by hand so the package needs no chain library:
 * ERC-20 transfer, balanceOf, approve and allowance, and Circle's MessageTransmitterV2.receiveMessage.
 */
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from './encoding';
import type { CctpChain, EvmBuiltTx, Transfer } from './types';

const SELECTOR = {
    transfer: 'a9059cbb',        // transfer(address,uint256)
    balanceOf: '70a08231',       // balanceOf(address)
    approve: '095ea7b3',         // approve(address,uint256)
    allowance: 'dd62ed3e',       // allowance(address,address)
    receiveMessage: '57ecfd28',  // receiveMessage(bytes,bytes)
};

const word = (hex: string) => hex.replace(/^0x/i, '').toLowerCase().padStart(64, '0');
const uint = (value: bigint | number) => BigInt(value).toString(16).padStart(64, '0');

function address(value: string): string {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`not an EVM address: ${value}`);
    return word(value);
}

/** A `bytes` value: its length, then the data padded to a whole word. */
function bytes(hex: string): string {
    const clean = hex.replace(/^0x/i, '').toLowerCase();
    if (clean.length % 2 || /[^0-9a-f]/.test(clean)) throw new Error('not hex bytes');
    return uint(clean.length / 2) + clean.padEnd(Math.ceil(clean.length / 64) * 64, '0');
}

export const encodeErc20Transfer = (to: string, amount: bigint) => `0x${SELECTOR.transfer}${address(to)}${uint(amount)}`;
export const encodeErc20BalanceOf = (owner: string) => `0x${SELECTOR.balanceOf}${address(owner)}`;
export const encodeErc20Approve = (spender: string, amount: bigint) => `0x${SELECTOR.approve}${address(spender)}${uint(amount)}`;
export const encodeErc20Allowance = (owner: string, spender: string) => `0x${SELECTOR.allowance}${address(owner)}${address(spender)}`;

export function encodeReceiveMessage(message: string, attestation: string): string {
    const first = bytes(message);
    const second = bytes(attestation);
    // Two dynamic arguments: each head slot holds the offset of its data from the start of the arguments.
    return `0x${SELECTOR.receiveMessage}${uint(64)}${uint(64 + first.length / 2)}${first}${second}`;
}

/** The hash of a signed transaction: what the network will call it once it is broadcast. */
export const evmTxHash = (signedTxHex: string) => `0x${bytesToHex(keccak_256(hexToBytes(signedTxHex)))}`;

/** The service-fee transaction of a transfer, rebuilt from its record: a plain USDC transfer to the treasury. */
export function feeTx(chain: CctpChain, feeRecipient: string, protocolFee: string): EvmBuiltTx {
    return {
        kind: 'fee', chain: 'evm', chainId: chain.chainId!, to: chain.usdc, value: '0',
        data: encodeErc20Transfer(feeRecipient, BigInt(protocolFee)),
        minMaxFeePerGasGwei: chain.minMaxFeePerGasGwei,
    };
}

/** The delivery of an attested transfer, for the user to send: MessageTransmitterV2.receiveMessage on the destination. */
export function mintTx(dst: CctpChain, selfMint: NonNullable<Transfer['selfMint']>): Pick<EvmBuiltTx, 'to' | 'data' | 'chainId' | 'minMaxFeePerGasGwei'> {
    return {
        chainId: dst.chainId!, to: selfMint.contract,
        data: encodeReceiveMessage(selfMint.message, selfMint.attestation),
        minMaxFeePerGasGwei: dst.minMaxFeePerGasGwei,
    };
}
