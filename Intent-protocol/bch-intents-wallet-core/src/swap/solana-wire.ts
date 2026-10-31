/**
 * The wire format of a Solana transaction, as much of it as a wallet needs to put signatures in their slots.
 *
 *   [compact-u16 number of signatures] [64 bytes each] [message]
 *
 * and the message starts, after a version byte when it is a v0 message, with a three-byte header whose first
 * byte is the number of required signatures, then the account keys (the signers first, the fee payer first of
 * all), then the recent blockhash.
 *
 * The mobile wallet signs inside a worklet that hands back the message and a signature per signer; this module
 * turns that into the bytes a node accepts. Nothing here signs.
 */
import { base58, fromBase64 } from './encoding';
import type { SignedSolanaTx } from './flows';

/** Solana's compact-u16: seven bits per byte, low bits first. */
function readCompactU16(bytes: Uint8Array, at: number): { value: number; next: number } {
    let value = 0;
    for (let i = 0; i < 3; i++) {
        const byte = bytes[at + i];
        if (byte === undefined) throw new Error('truncated Solana transaction');
        value |= (byte & 0x7f) << (7 * i);
        if (!(byte & 0x80)) return { value, next: at + i + 1 };
    }
    throw new Error('malformed length in a Solana transaction');
}

function writeCompactU16(value: number): number[] {
    const out: number[] = [];
    let rest = value;
    for (;;) {
        const byte = rest & 0x7f;
        rest >>= 7;
        if (rest === 0) { out.push(byte); return out; }
        out.push(byte | 0x80);
    }
}

export interface SolanaMessageInfo {
    /** Addresses that must sign, in slot order. The first pays the fee. */
    signers: string[];
    blockhash: string;
    version: 'legacy' | 0;
}

/** Read who must sign a message, and its blockhash. */
export function readSolanaMessage(message: Uint8Array): SolanaMessageInfo {
    const versioned = (message[0] & 0x80) !== 0;
    if (versioned && (message[0] & 0x7f) !== 0) throw new Error('unsupported Solana transaction version');
    let at = versioned ? 1 : 0;
    const required = message[at];
    at += 3;
    const keys = readCompactU16(message, at);
    at = keys.next;
    if (required === undefined || required > keys.value || message.length < at + keys.value * 32 + 32) throw new Error('truncated Solana transaction');
    const signers: string[] = [];
    for (let i = 0; i < required; i++) signers.push(base58(message.subarray(at + i * 32, at + (i + 1) * 32)));
    at += keys.value * 32;
    return { signers, blockhash: base58(message.subarray(at, at + 32)), version: versioned ? 0 : 'legacy' };
}

/** Split a serialized transaction into its signature slots and its message. */
export function splitSolanaTx(wire: Uint8Array): { signatures: Uint8Array[]; message: Uint8Array } {
    const count = readCompactU16(wire, 0);
    const signatures: Uint8Array[] = [];
    let at = count.next;
    for (let i = 0; i < count.value; i++, at += 64) signatures.push(wire.subarray(at, at + 64));
    if (wire.length <= at) throw new Error('truncated Solana transaction');
    return { signatures, message: wire.subarray(at) };
}

export function joinSolanaTx(signatures: Uint8Array[], message: Uint8Array): Uint8Array {
    const head = writeCompactU16(signatures.length);
    const out = new Uint8Array(head.length + signatures.length * 64 + message.length);
    out.set(head, 0);
    signatures.forEach((s, i) => out.set(s, head.length + i * 64));
    out.set(message, head.length + signatures.length * 64);
    return out;
}

/**
 * Bytes that crossed a JSON boundary. A Uint8Array arrives as an object with index keys, a Buffer as
 * `{ type: 'Buffer', data: [...] }`; a plain array or base64 text is taken too.
 */
export function bytesFromJson(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) return value;
    if (typeof value === 'string') return fromBase64(value);
    if (Array.isArray(value)) return Uint8Array.from(value as number[]);
    if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if (obj.type === 'Buffer' && Array.isArray(obj.data)) return Uint8Array.from(obj.data as number[]);
        const keys = Object.keys(obj);
        const out = new Uint8Array(keys.length);
        for (const key of keys) {
            const i = Number(key);
            if (!Number.isInteger(i) || i < 0 || i >= keys.length) throw new Error('not a byte array');
            out[i] = Number(obj[key]);
        }
        return out;
    }
    throw new Error('not a byte array');
}

/**
 * The transaction a WDK Solana account returns from `signTransaction(base64)`, after its trip through JSON:
 * `{ messageBytes, signatures: { [address]: bytes | null } }`. Signatures are placed by address, so the order
 * of the map does not matter.
 */
export function solanaTxFromWdk(signed: unknown): SignedSolanaTx {
    const tx = signed as { messageBytes?: unknown; signatures?: Record<string, unknown> } | null;
    if (!tx?.messageBytes || !tx.signatures) throw new Error('The wallet did not return a signed transaction.');
    const message = bytesFromJson(tx.messageBytes);
    const info = readSolanaMessage(message);
    const signatures = info.signers.map(address => {
        const bytes = tx.signatures![address] ? bytesFromJson(tx.signatures![address]) : null;
        if (!bytes || bytes.length !== 64 || bytes.every(b => b === 0)) throw new Error('The transaction is missing a signature.');
        return bytes;
    });
    return { raw: joinSolanaTx(signatures, message), signature: base58(signatures[0]), blockhash: info.blockhash };
}
