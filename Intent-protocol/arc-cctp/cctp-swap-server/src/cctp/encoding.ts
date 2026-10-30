/**
 * encoding.ts — bytes32 address helpers and CCTP V2 message parsing.
 *
 * Layouts from circlefin/evm-cctp-contracts src/messages/v2/{MessageV2,BurnMessageV2}.sol:
 *   Message:  version 0 | sourceDomain 4 | destinationDomain 8 | nonce 12 | sender 44 | recipient 76
 *             | destinationCaller 108 | minFinalityThreshold 140 | finalityThresholdExecuted 144 | body 148
 *   BurnBody: version 0 | burnToken 4 | mintRecipient 36 | amount 68 | messageSender 100 | maxFee 132
 *             | feeExecuted 164 | expirationBlock 196 | hookData 228
 */
import bs58 from 'bs58';

export const ZERO_BYTES32 = '0x' + '00'.repeat(32);

const HEX_RE = /^0x[0-9a-fA-F]*$/;

export function isEvmAddress(a: string): boolean {
    return /^0x[0-9a-fA-F]{40}$/.test(a);
}

export function evmToBytes32(addr: string): string {
    if (!isEvmAddress(addr)) throw new Error(`not an EVM address: ${addr}`);
    return ('0x' + '00'.repeat(12) + addr.slice(2)).toLowerCase();
}

export function bytes32ToEvm(b32: string): string {
    const h = strip0x(b32).padStart(64, '0');
    return '0x' + h.slice(24);
}

export function solanaToBytes32(pubkeyBase58: string): string {
    const raw = bs58.decode(pubkeyBase58);
    if (raw.length !== 32) throw new Error(`not a 32-byte Solana key: ${pubkeyBase58}`);
    return '0x' + Buffer.from(raw).toString('hex');
}

export function bytes32ToSolana(b32: string): string {
    return bs58.encode(Buffer.from(strip0x(b32).padStart(64, '0'), 'hex'));
}

export function strip0x(h: string): string {
    return h.startsWith('0x') ? h.slice(2) : h;
}

export function hexToBuf(h: string): Buffer {
    if (!HEX_RE.test(h.startsWith('0x') ? h : '0x' + h)) throw new Error('invalid hex');
    return Buffer.from(strip0x(h), 'hex');
}

const u32 = (b: Buffer, o: number) => b.readUInt32BE(o);
const b32 = (b: Buffer, o: number) => '0x' + b.subarray(o, o + 32).toString('hex');
const u256 = (b: Buffer, o: number) => BigInt('0x' + b.subarray(o, o + 32).toString('hex'));

export interface ParsedMessage {
    version: number;
    sourceDomain: number;
    destinationDomain: number;
    nonce: string;
    sender: string;
    recipient: string;
    destinationCaller: string;
    minFinalityThreshold: number;
    finalityThresholdExecuted: number;
    body: Buffer;
}

export function parseMessage(hex: string): ParsedMessage {
    const b = hexToBuf(hex);
    if (b.length < 148) throw new Error(`message too short (${b.length} bytes)`);
    return {
        version: u32(b, 0),
        sourceDomain: u32(b, 4),
        destinationDomain: u32(b, 8),
        nonce: b32(b, 12),
        sender: b32(b, 44),
        recipient: b32(b, 76),
        destinationCaller: b32(b, 108),
        minFinalityThreshold: u32(b, 140),
        finalityThresholdExecuted: u32(b, 144),
        body: b.subarray(148),
    };
}

export interface ParsedBurnBody {
    version: number;
    burnToken: string;
    mintRecipient: string;
    amount: bigint;
    messageSender: string;
    maxFee: bigint;
    feeExecuted: bigint;
    expirationBlock: bigint;
    hookData: string;
}

export function parseBurnBody(body: Buffer): ParsedBurnBody {
    if (body.length < 228) throw new Error(`burn body too short (${body.length} bytes)`);
    return {
        version: u32(body, 0),
        burnToken: b32(body, 4),
        mintRecipient: b32(body, 36),
        amount: u256(body, 68),
        messageSender: b32(body, 100),
        maxFee: u256(body, 132),
        feeExecuted: u256(body, 164),
        expirationBlock: u256(body, 196),
        hookData: '0x' + body.subarray(228).toString('hex'),
    };
}

// ── USDC units (6 decimals on every chain we support) ─────────────────────────

export const USDC_DECIMALS = 6;

export function parseUsdc(v: string | number): bigint {
    const s = String(v).trim();
    if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid USDC amount: ${v}`);
    const [whole, frac = ''] = s.split('.');
    if (frac.length > USDC_DECIMALS) throw new Error(`USDC supports at most ${USDC_DECIMALS} decimals`);
    return BigInt(whole) * 10n ** 6n + BigInt(frac.padEnd(USDC_DECIMALS, '0') || '0');
}

export function formatUsdc(units: bigint | string): string {
    const n = BigInt(units);
    const neg = n < 0n;
    const a = neg ? -n : n;
    const whole = a / 1_000_000n;
    const frac = (a % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
    return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

export function ceilDiv(a: bigint, b: bigint): bigint {
    return (a + b - 1n) / b;
}
