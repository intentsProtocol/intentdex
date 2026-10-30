/**
 * lendbch state decoders — pure functions that read the NFT commitments the Paryon contracts store.
 *
 * Every multi-byte field is little-endian, matching the `.cash` sources. Inputs are hex strings exactly as an
 * Electrum server returns `token.nft.commitment`. These functions never touch the network, so they are unit-tested
 * against the live commitments captured in lendbchdocs/01-research.md.
 */
import type { LoanState, PriceState } from './types.js';

/** Read a little-endian hex field (2 hex chars per byte) as a bigint. */
export function readLeHex(hex: string): bigint {
    if (hex.length % 2 !== 0) throw new Error(`odd-length hex field: ${hex}`);
    let out = 0n;
    for (let i = hex.length - 2; i >= 0; i -= 2) {
        const byte = parseInt(hex.slice(i, i + 2), 16);
        if (Number.isNaN(byte)) throw new Error(`bad hex field: ${hex}`);
        out = (out << 8n) | BigInt(byte);
    }
    return out;
}

const field = (hex: string, byteStart: number, byteLen: number) => hex.slice(byteStart * 2, (byteStart + byteLen) * 2);

/**
 * Decode the 27-byte loan commitment:
 *   0x01 | borrowed(6) | beingRedeemed(6) | status(1) | lastPeriodPaid(4) | currentRate(2) | nextRate(2) |
 *   interestManager(1) | minRate(2) | maxRate(2)   — all little-endian.
 */
export function decodeLoan(commitmentHex: string): LoanState {
    const hex = commitmentHex.toLowerCase();
    if (hex.length !== 54) throw new Error(`loan commitment must be 27 bytes, got ${hex.length / 2}`);
    if (field(hex, 0, 1) !== '01') throw new Error(`loan commitment identifier must be 0x01, got 0x${field(hex, 0, 1)}`);
    return {
        borrowed: readLeHex(field(hex, 1, 6)),
        beingRedeemed: readLeHex(field(hex, 7, 6)),
        status: Number(readLeHex(field(hex, 13, 1))),
        lastPeriodInterestPaid: Number(readLeHex(field(hex, 14, 4))),
        currentRate: Number(readLeHex(field(hex, 18, 2))),
        nextRate: Number(readLeHex(field(hex, 20, 2))),
        interestManager: Number(readLeHex(field(hex, 22, 1))),
        minRateManager: Number(readLeHex(field(hex, 23, 2))),
        maxRateManager: Number(readLeHex(field(hex, 25, 2))),
    };
}

/**
 * Decode the price-contract commitment: 0x00 | sequence(4) | price(4), little-endian. Price is US cents.
 * Guarded migrations may append fields, so only the first 9 bytes are read.
 */
export function decodePrice(commitmentHex: string): PriceState {
    const hex = commitmentHex.toLowerCase();
    if (hex.length < 18) throw new Error(`price commitment must be at least 9 bytes, got ${hex.length / 2}`);
    if (field(hex, 0, 1) !== '00') throw new Error(`price commitment identifier must be 0x00, got 0x${field(hex, 0, 1)}`);
    return {
        sequence: Number(readLeHex(field(hex, 1, 4))),
        priceCents: Number(readLeHex(field(hex, 5, 4))),
    };
}

/** Decode the Borrowing contract's minting-NFT state: just the current period (bytes4, little-endian). */
export function decodeBorrowingPeriod(commitmentHex: string): number {
    const hex = commitmentHex.toLowerCase();
    if (hex.length < 8) throw new Error(`borrowing commitment must be at least 4 bytes, got ${hex.length / 2}`);
    return Number(readLeHex(field(hex, 0, 4)));
}

/** Decode the StabilityPool minting-NFT state: period(4) | totalStakedEpoch(6) | remainingStakedEpoch(rest). */
export function decodeStabilityPool(commitmentHex: string): { period: number; totalStakedEpoch: bigint; remainingStakedEpoch: bigint } {
    const hex = commitmentHex.toLowerCase();
    if (hex.length < 20) throw new Error(`stability-pool commitment too short: ${hex.length / 2} bytes`);
    return {
        period: Number(readLeHex(field(hex, 0, 4))),
        totalStakedEpoch: readLeHex(field(hex, 4, 6)),
        remainingStakedEpoch: readLeHex(hex.slice(20)),
    };
}
