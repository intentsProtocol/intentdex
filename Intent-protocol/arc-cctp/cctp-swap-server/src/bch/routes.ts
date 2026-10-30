/** /bch/* — Cross-chain Bitcoin Cash (BCH) swap endpoints via NEAR Intents 1Click. */
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../types.js';
import type { BchSwapService } from './BchSwapService.js';
import type { TokenCatalog } from './TokenCatalog.js';
import type { CreateBchSwapDto, SubmitDepositTxDto } from './types.js';

export function registerBchRoutes(app: FastifyInstance, deps: { service: BchSwapService; catalog: TokenCatalog }) {
    const { service, catalog } = deps;
    const perMin = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

    // ── tokens ────────────────────────────────────────────────────────────────
    /** GET /bch/tokens — List tokens compatible with BCH swaps (optionally filtered by chain) */
    app.get('/bch/tokens', perMin(120), async (req) => {
        const q = req.query as { chain?: string };
        const tokens = catalog.list(q.chain);
        return {
            tokens,
            count: tokens.length,
        };
    });

    // ── quote ─────────────────────────────────────────────────────────────────
    /** GET /bch/quote — Get guaranteed or dry-run quote with fees calculated */
    app.get('/bch/quote', perMin(60), async (req) => {
        const q = req.query as {
            fromAsset?: string;
            toAsset?: string;
            fromChain?: string;
            toChain?: string;
            amount?: string;
            slippageBps?: string;
        };

        if (!q.fromAsset || !q.toAsset || !q.amount) {
            throw new HttpError(400, 'Missing required query parameters: fromAsset, toAsset, amount', 'INVALID_REQUEST');
        }

        try {
            const slippageBps = q.slippageBps ? Number(q.slippageBps) : undefined;
            return await service.getQuote({
                fromAsset: q.fromAsset,
                toAsset: q.toAsset,
                fromChain: q.fromChain,
                toChain: q.toChain,
                amount: q.amount,
                slippageBps,
            });
        } catch (err: any) {
            throw new HttpError(400, err.message, 'INVALID_REQUEST');
        }
    });

    // ── create swap ───────────────────────────────────────────────────────────
    /** POST /bch/swaps — Initiate a cross-chain BCH swap and get deposit address */
    app.post('/bch/swaps', perMin(30), async (req, reply) => {
        const body = req.body as CreateBchSwapDto;
        if (!body || !body.fromAsset || !body.toAsset || !body.amount || !body.recipient || !body.refundTo) {
            throw new HttpError(
                400,
                'Missing required fields: fromAsset, toAsset, amount, recipient, refundTo',
                'INVALID_REQUEST'
            );
        }

        try {
            const record = await service.createSwap(body);
            reply.code(201);
            return record;
        } catch (err: any) {
            throw new HttpError(400, err.message, 'INVALID_REQUEST');
        }
    });

    // ── get swap by id ────────────────────────────────────────────────────────
    /** GET /bch/swaps/:id — Query status and details of an existing swap */
    app.get('/bch/swaps/:id', perMin(120), async (req) => {
        const { id } = req.params as { id: string };
        const swap = service.getSwap(id);
        if (!swap) {
            throw new HttpError(404, `Swap not found: ${id}`, 'NOT_FOUND');
        }
        return swap;
    });

    // ── submit deposit transaction ────────────────────────────────────────────
    /** POST /bch/swaps/:id/deposit-tx — Register origin deposit tx hash */
    app.post('/bch/swaps/:id/deposit-tx', perMin(60), async (req) => {
        const { id } = req.params as { id: string };
        const body = req.body as SubmitDepositTxDto;
        if (!body || !body.txHash) {
            throw new HttpError(400, 'Missing txHash in request body', 'INVALID_TX_HASH');
        }

        try {
            return await service.registerDepositTx(id, body.txHash);
        } catch (err: any) {
            throw new HttpError(400, err.message, 'INVALID_REQUEST');
        }
    });

    // ── list swaps ────────────────────────────────────────────────────────────
    /** GET /bch/swaps — Query swap history, optionally filtered by user address */
    app.get('/bch/swaps', perMin(60), async (req) => {
        const q = req.query as { address?: string; limit?: string };
        const limit = q.limit ? Math.min(Math.max(Number(q.limit) || 20, 1), 100) : 20;
        const swaps = service.listSwaps({
            address: q.address,
            limit,
        });
        return {
            swaps,
            count: swaps.length,
        };
    });
}
