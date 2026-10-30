/**
 * chainRoutes.ts — what a browser wallet needs from a chain and cannot always get itself.
 *
 * Solana's public mainnet RPC refuses requests that come from a web page, so a page with no RPC provider of its
 * own cannot read a balance or send a transaction there. These routes carry the three things the cross-chain
 * flow needs. They work for every chain, so the client has one way to ask.
 *
 *   GET  /chains/:key/balance?owner=      USDC and gas balance of a wallet
 *   GET  /chains/:key/tx/:hash            does the chain know this transaction (mined or pending)?
 *   POST /transfers/:id/broadcast         Solana source: send the user's signed burn and register it, in one step
 *
 * The server still never signs for the user: /broadcast forwards a transaction the user's wallet signed.
 */
import type { FastifyInstance } from 'fastify';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { SOLANA_PROGRAMS } from './config.js';
import { formatUsdc } from './cctp/encoding.js';
import type { EvmAdapter } from './evm/EvmAdapter.js';
import type { SolanaAdapter } from './solana/SolanaAdapter.js';
import type { TransferService } from './service/TransferService.js';
import { HttpError, type Transfer } from './types.js';
import { logger } from './log.js';

const log = logger('chains');

export interface ChainRouteDeps {
    service: TransferService;
    view: (t: Transfer) => unknown;
    /** Called after a burn is registered, so the worker picks it up at once. */
    onBurn: () => void;
}

/** The signed burn of this transfer, and nothing else: signed by its sender, for its event account, to CCTP. */
export function checkSignedBurn(t: Pick<Transfer, 'sender' | 'eventAccount'>, signedTx: unknown): { raw: Uint8Array; signature: string } {
    if (typeof signedTx !== 'string' || !signedTx) throw new HttpError(400, 'signedTx (base64) is required', 'INVALID_SIGNED_TX');
    let tx: VersionedTransaction;
    let raw: Uint8Array;
    try { raw = Buffer.from(signedTx, 'base64'); tx = VersionedTransaction.deserialize(raw); }
    catch { throw new HttpError(400, 'signedTx is not a Solana transaction', 'INVALID_SIGNED_TX'); }
    const keys = tx.message.staticAccountKeys.map(k => k.toBase58());
    const signers = keys.slice(0, tx.message.header.numRequiredSignatures);
    const missing = tx.signatures.findIndex(s => s.every(b => b === 0));
    if (missing >= 0) throw new HttpError(400, `signedTx is missing the signature of ${signers[missing]}`, 'INVALID_SIGNED_TX');
    if (!signers.includes(t.sender)) throw new HttpError(400, 'signedTx is not signed by the sender of this transfer', 'TX_MISMATCH');
    if (!keys.includes(SOLANA_PROGRAMS.tokenMessengerMinter)) throw new HttpError(400, 'signedTx is not a CCTP burn', 'TX_MISMATCH');
    if (!t.eventAccount || !keys.includes(t.eventAccount)) throw new HttpError(400, 'signedTx is not the burn built for this transfer', 'TX_MISMATCH');
    return { raw, signature: bs58.encode(tx.signatures[0]) };
}

export function registerChainRoutes(app: FastifyInstance, d: ChainRouteDeps) {
    app.get('/chains/:key/balance', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
        const { chain, adapter } = d.service.chainAndAdapter((req.params as { key: string }).key);
        const owner = (req.query as Record<string, string>).owner;
        if (typeof owner !== 'string' || !adapter.validateAddress(owner)) throw new HttpError(400, `owner is not a valid ${chain.name} address`, 'INVALID_ADDRESS');
        try {
            const [usdc, native] = await Promise.all([
                (adapter as unknown as { usdcBalance(w: string): Promise<bigint> }).usdcBalance(owner),
                chain.kind === 'evm'
                    ? (adapter as unknown as EvmAdapter).provider.getBalance(owner)
                    : (adapter as unknown as SolanaAdapter).connection.getBalance(new PublicKey(owner)).then(BigInt),
            ]);
            // On Arc the gas is the same USDC balance, seen through its 18-decimal native interface.
            const gasIsUsdc = !!chain.minMaxFeePerGasGwei;
            return {
                chain: chain.key, owner,
                usdc: usdc.toString(), display: formatUsdc(usdc),
                native: native.toString(), nativeDecimals: chain.kind === 'evm' ? 18 : 9,
                nativeSymbol: chain.kind === 'solana' ? 'SOL' : gasIsUsdc ? 'USDC' : 'ETH',
            };
        } catch (e) {
            throw new HttpError(502, `could not read the balance on ${chain.name}: ${String((e as Error).message).slice(0, 120)}`, 'UPSTREAM_ERROR');
        }
    });

    app.get('/chains/:key/tx/:hash', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
        const p = req.params as { key: string; hash: string };
        const { chain, adapter } = d.service.chainAndAdapter(p.key);
        if (!adapter.isValidTxHash(p.hash)) throw new HttpError(400, `not a valid ${chain.name} transaction hash`, 'INVALID_TX_HASH');
        try {
            const known = chain.kind === 'evm'
                ? (await (adapter as unknown as EvmAdapter).provider.getTransaction(p.hash)) !== null
                : (await (adapter as unknown as SolanaAdapter).connection.getSignatureStatuses([p.hash], { searchTransactionHistory: true })).value[0] !== null;
            return { chain: chain.key, hash: p.hash, known };
        } catch (e) {
            throw new HttpError(502, `could not look the transaction up on ${chain.name}: ${String((e as Error).message).slice(0, 120)}`, 'UPSTREAM_ERROR');
        }
    });

    app.post('/transfers/:id/broadcast', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
        const { id } = req.params as { id: string };
        const t = d.service.mustGet(id);
        const { chain, adapter } = d.service.chainAndAdapter(t.src);
        if (chain.kind !== 'solana') throw new HttpError(400, `${chain.name} transactions are sent by the wallet itself; report the hash to /transfers/${id}/burn`, 'INVALID_REQUEST');
        const { raw, signature } = checkSignedBurn(t, ((req.body ?? {}) as Record<string, unknown>).signedTx);
        if (t.status !== 'CREATED') {
            if (t.burnTxHash === signature) return d.view(t);   // sent before: the same answer
            throw new HttpError(409, `transfer is already ${t.status}`, 'WRONG_STATE');
        }
        const connection = (adapter as unknown as SolanaAdapter).connection;
        try {
            await connection.sendRawTransaction(raw, { maxRetries: 3 });
        } catch (e) {
            const message = String((e as Error).message);
            // A second send of a transaction that already landed is not a failure.
            if (!/already been processed/i.test(message)) {
                log.warn('broadcast refused', { id, signature, error: message.slice(0, 300) });
                if (/blockhash not found|block height exceeded/i.test(message)) throw new HttpError(409, 'this transaction is too old to send; rebuild the transfer and sign again', 'EXPIRED');
                throw new HttpError(400, `Solana refused the transaction: ${message.slice(0, 200)}`, 'TX_REJECTED');
            }
        }
        const updated = d.service.submitBurn(id, signature);
        d.onBurn();
        return d.view(updated);
    });
}
