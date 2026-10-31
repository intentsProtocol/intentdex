/**
 * Ported from frontend/src/swap-server/flows.ts. Two differences: journal writes are awaited, because a host's
 * storage is asynchronous and the hash must be on disk before the transaction is broadcast; and signing goes
 * through two small interfaces (EvmSender, SolanaSender), so the browser extension can sign with ethers and the
 * mobile app inside its WDK worklet.
 *
 * The cross-chain USDC flow, without React: create → sign each transaction → report the hashes.
 *
 * After the burn hash is reported the server does the rest (attestation, delivery), so this module's job ends
 * there; the UI follows the record through /activity and /transfers/:id.
 *
 * Two rules protect the user's money:
 *   - every hash is written to the journal before its transaction is broadcast, and the burn is reported the
 *     moment it is broadcast, not after it confirms. A page that dies mid-flow never leads to a second burn.
 *   - the service fee goes last. A user who stops halfway has not paid for a transfer that did not happen.
 */
import type { SwapServerApi } from './api';
import { SwapServerError } from './api';
import type { Journal } from './journal';
import { feeTx, mintTx } from './evm-calls';
import type { BuiltTx, CctpChain, CctpQuote, EvmBuiltTx, SolanaBuiltTx, Transfer } from './types';

export type BridgeStep = 'create' | 'approve' | 'burn' | 'fee';

export interface BridgeProgress {
    /** The steps this transfer needs, in order. Known once the server has built the transactions. */
    steps: BridgeStep[];
    step: BridgeStep;
    state: 'active' | 'done';
    hash?: string;
    transfer?: Transfer;
}

/** What a transaction on an EVM chain needs from the caller; the sender fills in nonce, gas and fees. */
export type EvmTxRequest = Pick<EvmBuiltTx, 'to' | 'data' | 'chainId' | 'minMaxFeePerGasGwei'>;
export interface SentEvmTx {
    hash: string;
    /** Resolves when the transaction is mined; rejects if it reverted or was not mined in time. */
    wait(): Promise<void>;
}
/** The wallet's EVM account on one chain. */
export interface EvmSender {
    /**
     * Sign, hand the hash to `onHash`, then broadcast. `onHash` runs before the broadcast and is awaited.
     * A transaction that would revert is refused before it costs anything.
     */
    send(tx: EvmTxRequest, opts?: { onHash?: (hash: string) => void | Promise<void>; waitTimeoutMs?: number }): Promise<SentEvmTx>;
}
export interface SignedSolanaTx {
    raw: Uint8Array;        // send this (CCTP burn), or base64 it for the server (Jupiter swap)
    signature: string;      // the transaction id: the fee payer's signature
    blockhash: string;
}
export interface SolanaSender {
    /** Add the wallet's signature to a transaction the server built. Signatures already on it are kept. */
    sign(base64Tx: string): SignedSolanaTx | Promise<SignedSolanaTx>;
    /** Broadcast the signed burn of this transfer and return its signature. */
    send(raw: Uint8Array, transferId: string): Promise<string>;
}

export interface BridgeDeps {
    api: Pick<SwapServerApi, 'createTransfer' | 'rebuildTransfer' | 'submitBurn' | 'submitFee' | 'getTransfer' | 'trackBurn'>;
    journal: Journal;
    /** The in-app EVM wallet on the given chain. */
    evm?: (chain: CctpChain) => EvmSender | Promise<EvmSender>;
    solana?: SolanaSender;
    onProgress?: (p: BridgeProgress) => void;
    /**
     * Does the source chain know this transaction, mined or pending? Used before a journaled hash is reported or
     * given up on. Without it every journaled hash is taken as known, which is the side that cannot burn twice.
     */
    chainKnows?: (src: CctpChain, hash: string) => Promise<boolean>;
    /** Pause between attempts to report a hash; tests set 0. */
    retryDelayMs?: number;
    now?: () => number;
}

/** A Solana transaction can land for about 90 s after it is signed. After this long it never will. */
const SOLANA_TX_DEAD_AFTER_MS = 3 * 60_000;

/** The burn is on chain but the server could not be told. The journal has the hash; it is reported on the next try. */
export class BurnNotReported extends Error {
    constructor(public transferId: string, public txHash: string, cause: unknown) {
        super('Your transfer was sent, but the bridge could not be told yet. It will be picked up automatically; keep this page open or come back later.');
        this.name = 'BurnNotReported';
        this.cause = cause;
    }
}

/** The transfer is on its way; only the service fee is missing. The mint waits until it is paid. */
export class FeeNotSent extends Error {
    constructor(public transferId: string, cause: unknown) {
        super('Your transfer is on its way, but the service fee was not sent. Send it from the history panel to finish the delivery.');
        this.name = 'FeeNotSent';
        this.cause = cause;
    }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Report a hash, trying a few times: the transaction is already out, so giving up early helps nobody. */
async function report<T>(fn: () => Promise<T>, delayMs: number): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
        try { return await fn(); } catch (e) {
            last = e;
            // A refusal is final; only "no answer" and "busy" are worth another try.
            if (e instanceof SwapServerError && e.status !== 0 && e.status !== 429 && e.status < 500) throw e;
            await sleep(delayMs * (attempt + 1));
        }
    }
    throw last;
}

const isBlockhashExpired = (e: unknown) => (e instanceof SwapServerError && e.code === 'EXPIRED') || /blockhash not found|block height exceeded|expired/i.test(String((e as Error)?.message ?? e));
/** The server answered that it did not send the transaction (a 409 other than EXPIRED means an earlier one is out). */
const refusedByServer = (e: unknown) => e instanceof SwapServerError && e.status >= 400 && e.status < 500 && e.status !== 409;
/** The node refused the transaction before sending it anywhere, so it is certain that nothing was broadcast. */
const wasNotBroadcast = (e: unknown) => isBlockhashExpired(e) || refusedByServer(e) || /simulation failed|insufficient (funds|lamports)|custom program error/i.test(String((e as Error)?.message ?? e));

/** Sign the server's transactions for `transfer` in order and report the hashes. */
export async function signTransfer(transfer: Transfer, txs: BuiltTx[], src: CctpChain, deps: BridgeDeps, alreadyRebuilt = false): Promise<Transfer> {
    const delay = deps.retryDelayMs ?? 1500;
    const steps: BridgeStep[] = txs.map(t => t.kind);
    const progress = (step: BridgeStep, state: 'active' | 'done', hash?: string) => deps.onProgress?.({ steps, step, state, hash, transfer });

    if (src.kind === 'solana') {
        if (!deps.solana) throw new Error('No Solana wallet is connected');
        const tx = txs[0] as SolanaBuiltTx;
        progress('burn', 'active');
        const signed = await deps.solana.sign(tx.serializedTx);
        await deps.journal.set(transfer.id, { burn: signed.signature });
        let signature: string;
        try {
            signature = await deps.solana.send(signed.raw, transfer.id);
        } catch (e) {
            // Keep the journal entry unless it is certain nothing went out: an error from the network can hide a
            // transaction that did reach it, and resumeBridge must then not sign a second burn.
            if (wasNotBroadcast(e)) deps.journal.delete(transfer.id);
            if (alreadyRebuilt || !isBlockhashExpired(e)) throw e;
            const fresh = await deps.api.rebuildTransfer(transfer.id);
            return signTransfer(fresh.transfer, fresh.txs, src, deps, true);
        }
        try { transfer = await report(() => deps.api.submitBurn(transfer.id, signature), delay); }
        catch (e) { throw new BurnNotReported(transfer.id, signature, e); }
        deps.journal.delete(transfer.id);
        progress('burn', 'done', signature);
        return transfer;
    }

    if (!deps.evm) throw new Error('No EVM wallet is connected');
    const sender = await deps.evm(src);
    let burned = false;
    for (const tx of txs as EvmBuiltTx[]) {
        progress(tx.kind, 'active');
        try {
            const sent = await sender.send(tx, {
                onHash: hash => (tx.kind !== 'approve' ? deps.journal.set(transfer.id, { [tx.kind]: hash }) : undefined),
            });
            if (tx.kind === 'burn') {
                burned = true;
                try { transfer = await report(() => deps.api.submitBurn(transfer.id, sent.hash), delay); }
                catch (e) { throw new BurnNotReported(transfer.id, sent.hash, e); }
            }
            if (tx.kind === 'fee') transfer = await report(() => deps.api.submitFee(transfer.id, sent.hash), delay);
            await sent.wait();
            progress(tx.kind, 'done', sent.hash);
        } catch (e) {
            if (e instanceof BurnNotReported) throw e;
            if (tx.kind === 'fee' && burned) throw new FeeNotSent(transfer.id, e);
            throw e;
        }
    }
    deps.journal.delete(transfer.id);
    return transfer;
}

export interface BridgeInput { src: CctpChain; dst: CctpChain; amount: string; sender: string; recipient: string }

/** Create a transfer and sign it. `amount` is decimal USDC. */
export async function startBridge(input: BridgeInput, deps: BridgeDeps): Promise<{ transfer: Transfer; quote: CctpQuote }> {
    deps.onProgress?.({ steps: ['create'], step: 'create', state: 'active' });
    const created = await deps.api.createTransfer({ src: input.src.key, dst: input.dst.key, amount: input.amount, sender: input.sender, recipient: input.recipient });
    deps.onProgress?.({ steps: ['create', ...created.txs.map(t => t.kind)], step: 'create', state: 'done', transfer: created.transfer });
    return { transfer: await signTransfer(created.transfer, created.txs, input.src, deps), quote: created.quote };
}

/**
 * Carry on with a transfer that still waits for its burn, for instance after a reload. If this device already
 * broadcast the burn, the journal's hash is reported and nothing is signed again.
 */
export async function resumeBridge(transferId: string, src: CctpChain, deps: BridgeDeps): Promise<Transfer> {
    const current = await deps.api.getTransfer(transferId);
    if (current.status !== 'CREATED') return current;
    const noted = deps.journal.get(transferId);
    if (noted?.burn) {
        const known = deps.chainKnows ? await deps.chainKnows(src, noted.burn).catch(() => true) : true;
        if (known) {
            const t = await deps.api.submitBurn(transferId, noted.burn, src.kind === 'evm' ? noted.fee : undefined);
            deps.journal.delete(transferId);
            return t;
        }
        // Signed here, but the chain has never heard of it. On an EVM chain the nonce it used is still free, so a
        // new burn replaces it and cannot land next to it. A Solana transaction has no nonce: wait until the old
        // one can no longer land.
        if (src.kind === 'solana' && (deps.now ?? Date.now)() - noted.at < SOLANA_TX_DEAD_AFTER_MS) {
            throw new Error('The previous attempt may still confirm. Try again in a couple of minutes.');
        }
        deps.journal.delete(transferId);
    }
    const fresh = await deps.api.rebuildTransfer(transferId);
    return signTransfer(fresh.transfer, fresh.txs, src, deps);
}

/**
 * True when the user can send the service fee of a transfer whose burn is out: the server is holding the mint
 * for it, or no fee transaction was ever reported. EVM sources only; on Solana the fee is inside the burn.
 */
export function feeIsDue(t: Pick<Transfer, 'protocolFee' | 'feeStatus' | 'feeRecipient' | 'feeTxHash' | 'status' | 'burnTxHash'>, src: CctpChain): boolean {
    return src.kind === 'evm' && !!t.burnTxHash && !!t.feeRecipient && !!t.protocolFee && t.protocolFee !== '0'
        && (t.feeStatus === 'awaiting' || (t.feeStatus === 'pending' && !t.feeTxHash))
        && t.status !== 'COMPLETED' && t.status !== 'COMPLETED_EXTERNAL' && t.status !== 'FAILED' && t.status !== 'EXPIRED';
}

/** How long the bridge is given to deliver an attested transfer before the user is offered to do it. */
export const SELF_MINT_AFTER_MS = 2 * 60_000;

/**
 * True when the user can deliver the transfer themselves: Circle has attested it, nobody has minted it, and the
 * destination is an EVM chain (a Solana delivery needs accounts only the bridge prepares). Offered when the
 * bridge's own delivery is switched off or has not happened for a while; never while it is simply on its way.
 */
export function canSelfMint(t: Pick<Transfer, 'selfMint' | 'status' | 'updatedAt'>, dst: CctpChain | undefined, ctx: { relayEnabled: boolean; now: number }): boolean {
    if (!t.selfMint || !dst || dst.kind !== 'evm' || t.status !== 'ATTESTED') return false;
    return !ctx.relayEnabled || ctx.now - t.updatedAt > SELF_MINT_AFTER_MS;
}

/**
 * Deliver an attested transfer from the user's own wallet. The destination contract accepts each attestation
 * once, so this cannot mint twice: if the bridge got there first the gas estimate fails and nothing is sent.
 */
export async function selfMint(transferId: string, dst: CctpChain, deps: Pick<BridgeDeps, 'api' | 'evm'>): Promise<{ transfer: Transfer; hash: string }> {
    const t = await deps.api.getTransfer(transferId);
    if (!t.selfMint || dst.kind !== 'evm') throw new Error('This transfer cannot be delivered from the wallet right now.');
    if (!deps.evm) throw new Error('No EVM wallet is connected');
    const sender = await deps.evm(dst);
    let sent;
    try { sent = await sender.send(mintTx(dst, t.selfMint)); }
    catch (e) {
        const now = await deps.api.getTransfer(transferId).catch(() => t);
        if (now.status === 'COMPLETED' || now.status === 'COMPLETED_EXTERNAL' || now.status === 'MINT_SUBMITTED') return { transfer: now, hash: now.mintTxHash ?? '' };
        throw e;
    }
    await sent.wait();
    return { transfer: await deps.api.getTransfer(transferId).catch(() => t), hash: sent.hash };
}

/** Send the service fee of a transfer whose burn is already out. The transaction is rebuilt from the record. */
export async function payFee(transferId: string, src: CctpChain, deps: BridgeDeps): Promise<Transfer> {
    const t = await deps.api.getTransfer(transferId);
    if (!feeIsDue(t, src)) return t;
    if (!deps.evm) throw new Error('No EVM wallet is connected');
    const sender = await deps.evm(src);
    const tx = feeTx(src, t.feeRecipient!, t.protocolFee!);
    deps.onProgress?.({ steps: ['fee'], step: 'fee', state: 'active', transfer: t });
    const sent = await sender.send(tx, { onHash: hash => deps.journal.set(transferId, { fee: hash }) });
    const after = await report(() => deps.api.submitFee(transferId, sent.hash), deps.retryDelayMs ?? 1500);
    await sent.wait();
    deps.journal.delete(transferId);
    deps.onProgress?.({ steps: ['fee'], step: 'fee', state: 'done', hash: sent.hash, transfer: after });
    return after;
}

/**
 * Report every hash the journal still holds. Run on load and while entries exist. An entry is dropped once the
 * server has what it holds, or the transfer is over.
 */
export async function flushJournal(
    deps: { api: Pick<SwapServerApi, 'getTransfer' | 'submitBurn' | 'submitFee' | 'trackBurn'>; journal: Journal; chainKnows?: BridgeDeps['chainKnows'] },
    chainOf?: (key: string) => CctpChain | undefined,
): Promise<number> {
    let reported = 0;
    for (const [id, entry] of Object.entries(deps.journal.all())) {
        try {
            const t = await deps.api.getTransfer(id);
            const src = chainOf?.(t.src);
            const knows = async (hash: string) => (deps.chainKnows && src ? deps.chainKnows(src, hash).catch(() => false) : !deps.chainKnows);
            const over = t.status === 'COMPLETED' || t.status === 'COMPLETED_EXTERNAL' || t.status === 'FAILED' || t.status === 'EXPIRED';

            if (entry.burn && !t.burnTxHash) {
                // A burn this device signed that the server never heard of. One the chain has not seen either is
                // left for the user's "resume", which can still sign a fresh one.
                if (!(await knows(entry.burn))) { if (over) deps.journal.delete(id); continue; }
                if (t.status === 'CREATED') await deps.api.submitBurn(id, entry.burn);
                // The record expired in the meantime, but the USDC is burned: have the server adopt the burn so it
                // is still delivered.
                else await deps.api.trackBurn(t.src, entry.burn);
                reported++;
                if (!entry.fee || t.status !== 'CREATED') deps.journal.delete(id);
                continue;
            }
            const feeOpen = !!entry.fee && !over && t.feeStatus !== 'paid' && t.feeStatus !== 'none' && t.feeTxHash?.toLowerCase() !== entry.fee.toLowerCase();
            if (feeOpen && await knows(entry.fee!)) {
                await deps.api.submitFee(id, entry.fee!);
                reported++;
            }
            deps.journal.delete(id);
        } catch (e) {
            // Unknown transfer, or a refusal: the entry can never be used. No answer: keep it for the next round.
            if (e instanceof SwapServerError && e.status !== 0 && e.status !== 429 && e.status < 500) deps.journal.delete(id);
        }
    }
    return reported;
}
