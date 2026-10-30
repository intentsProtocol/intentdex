/** Builds CCTP V2 messages (header + burn body) with the byte layout from MessageV2.sol / BurnMessageV2.sol. */
import { strip0x } from '../../src/cctp/encoding.js';
import type { Transfer } from '../../src/types.js';

export function sampleTransfer(over: Partial<Transfer> = {}): Transfer {
    const now = Date.now();
    return {
        id: 't-' + Math.random().toString(36).slice(2), origin: 'api',
        src: 'base-sepolia', dst: 'arc-testnet', srcDomain: 6, dstDomain: 26,
        sender: '0x1111111111111111111111111111111111111111', recipient: '0x2222222222222222222222222222222222222222',
        mintRecipient: '0x0000000000000000000000002222222222222222222222222222222222222222',
        amount: '1000000', speed: 'fast', minFinalityThreshold: 1000, maxFee: '156', feeBps: 1.3,
        expectedFee: '130', expectedReceive: '999870', status: 'CREATED', failCount: 0, createdAt: now, updatedAt: now,
        ...over,
    };
}

const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u256 = (n: bigint) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
const b32 = (h: string) => Buffer.from(strip0x(h).padStart(64, '0'), 'hex');

export interface MessageFixture {
    sourceDomain: number;
    destinationDomain: number;
    nonce?: string;
    burnToken: string;
    mintRecipient: string;
    amount: bigint;
    messageSender: string;
    maxFee?: bigint;
    feeExecuted?: bigint;
    destinationCaller?: string;
    minFinalityThreshold?: number;
    finalityThresholdExecuted?: number;
}

export function buildMessage(p: MessageFixture): string {
    const body = Buffer.concat([
        u32(1), b32(p.burnToken), b32(p.mintRecipient), u256(p.amount), b32(p.messageSender),
        u256(p.maxFee ?? 0n), u256(p.feeExecuted ?? 0n), u256(0n),
    ]);
    const header = Buffer.concat([
        u32(1), u32(p.sourceDomain), u32(p.destinationDomain),
        b32(p.nonce ?? '0x' + 'cd'.repeat(32)),
        b32('0x' + '11'.repeat(20)),                 // sender: source TokenMessenger
        b32('0x' + '22'.repeat(20)),                 // recipient: destination TokenMessenger
        b32(p.destinationCaller ?? '0x00'),
        u32(p.minFinalityThreshold ?? 1000), u32(p.finalityThresholdExecuted ?? 1000),
    ]);
    return '0x' + Buffer.concat([header, body]).toString('hex');
}
