/**
 * transferView — the public shape of a transfer: display amounts, explorer links, the countdown while it waits
 * for the user's signature, and what a user needs to mint it themselves.
 */
import { config, explorerUrl, getChain, SOLANA_PROGRAMS } from '../config.js';
import { formatUsdc } from '../cctp/encoding.js';
import { TERMINAL_STATUSES, type Transfer } from '../types.js';

export function transferView(t: Transfer, now = Date.now()) {
    const src = getChain(t.src);
    const dst = t.dst ? getChain(t.dst) : undefined;
    const canSelfMint = !!(t.message && t.attestation) && !TERMINAL_STATUSES.has(t.status);
    // Only an unsigned transfer expires: once the burn is posted the worker follows it to the end.
    const expiresAt = t.status === 'CREATED' ? t.createdAt + config.limits.createdTtlMin * 60_000 : undefined;
    return {
        ...t,
        expiresAt,
        expiresInSec: expiresAt === undefined ? undefined : Math.max(0, Math.round((expiresAt - now) / 1000)),
        display: {
            amount: formatUsdc(t.amount),
            grossAmount: formatUsdc(t.grossAmount ?? t.amount),
            protocolFee: formatUsdc(t.protocolFee ?? '0'),
            expectedFee: formatUsdc(t.expectedFee),
            expectedReceive: formatUsdc(t.expectedReceive),
            received: t.received ? formatUsdc(t.received) : undefined,
        },
        links: {
            burn: src ? explorerUrl(src, t.burnTxHash) : undefined,
            mint: dst ? explorerUrl(dst, t.mintTxHash) : undefined,
        },
        selfMint: canSelfMint && dst ? {
            chain: dst.key,
            contract: dst.kind === 'evm' ? dst.messageTransmitter : SOLANA_PROGRAMS.messageTransmitter,
            method: dst.kind === 'evm' ? 'receiveMessage(bytes message, bytes attestation)' : 'receive_message',
            message: t.message, attestation: t.attestation,
        } : undefined,
    };
}

export type TransferView = ReturnType<typeof transferView>;
