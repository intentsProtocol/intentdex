/** /solana/* — same-chain Solana swaps through Jupiter, token catalog, tokenized stocks, prices. */
import type { FastifyInstance } from 'fastify';
import { PublicKey, type Connection } from '@solana/web3.js';
import { formatUnits } from 'ethers';
import { WSOL_MINT } from './TokenCatalog.js';
import { HttpError } from '../types.js';
import type { SolanaSwapService } from './SolanaSwapService.js';
import type { TokenCatalog, TokenView } from './TokenCatalog.js';
import type { SolanaSettings } from '../settings.js';
import { JupiterError, type JupiterApi } from './types.js';

function page(list: TokenView[], q: Record<string, string>) {
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    const offset = Math.max(Number(q.offset) || 0, 0);
    return { total: list.length, offset, limit, tokens: list.slice(offset, offset + limit) };
}

function upstream(e: unknown): never {
    if (e instanceof JupiterError) throw new HttpError(e.status === 429 ? 429 : e.status === 400 ? 400 : 502, e.status === 429 ? 'rate limited, retry in a few seconds' : `Jupiter error: ${e.message}`);
    throw e;
}

export function registerSolanaRoutes(app: FastifyInstance, deps: { api: JupiterApi; catalog: TokenCatalog; swaps: SolanaSwapService; settings?: () => SolanaSettings; mainnet?: Connection }) {
    const { api, catalog, swaps } = deps;
    /** Drop what the admin has closed: blocked mints, stocks when off, unverified tokens when off. */
    const allowed = (list: TokenView[]): TokenView[] => {
        const s = deps.settings?.();
        if (!s) return list;
        return list.filter(t => !s.blockedMints.includes(t.mint) && (s.stocksEnabled || !t.isStock) && (s.allowUnverified || t.verified));
    };
    const perMin = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

    // ── tokens ────────────────────────────────────────────────────────────────
    /** Jupiter's verified list (the default token picker). Filters: q, tag, sort=liquidity|volume|mcap. */
    app.get('/solana/tokens', async (req) => {
        const q = req.query as Record<string, string>;
        return page(allowed(await catalog.filter({ q: q.q, tag: q.tag, sort: q.sort })), q);
    });

    /** Every token Jupiter indexes, verified or not. Use for pasted mints and long-tail tokens. */
    app.get('/solana/tokens/search', perMin(60), async (req) => {
        const q = ((req.query as Record<string, string>).q ?? '').trim();
        if (q.length < 2 || q.length > 64) throw new HttpError(400, 'q must be 2-64 characters (symbol, name or mint)');
        try { return { tokens: allowed(await catalog.search(q)) }; } catch (e) { upstream(e); }
    });

    app.get('/solana/tokens/:mint', perMin(60), async (req) => {
        const { mint } = req.params as { mint: string };
        try { new PublicKey(mint); } catch { throw new HttpError(400, 'not a valid Solana mint address', 'INVALID_MINT'); }
        const t = await catalog.get(mint).catch(upstream);
        if (!t || allowed([t]).length === 0) throw new HttpError(404, 'token not found');
        return t;
    });

    /** Tokenized stocks: verified tokens tagged `stocks`, most liquid first. Filters: issuer, q, minLiquidity. */
    app.get('/solana/stocks', async (req) => {
        const q = req.query as Record<string, string>;
        const s = deps.settings?.();
        if (s && !s.stocksEnabled) throw new HttpError(403, 'Tokenized stocks are not available', 'STOCKS_DISABLED');
        const asked = q.minLiquidity === undefined ? undefined : Number(q.minLiquidity);
        if (asked !== undefined && !Number.isFinite(asked)) throw new HttpError(400, 'minLiquidity must be a number (USD)');
        const minLiquidity = Math.max(asked ?? 0, s?.minStockLiquidityUsd ?? 0) || undefined;
        const list = allowed(await catalog.filter({ stocksOnly: true, issuer: q.issuer, q: q.q, minLiquidity, sort: q.sort || 'liquidity' }));
        return { issuers: catalog.stockIssuers(), ...page(list, q) };
    });

    app.get('/solana/prices', perMin(60), async (req) => {
        const ids = ((req.query as Record<string, string>).ids ?? '').split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length === 0 || ids.length > 50) throw new HttpError(400, 'ids is required: 1-50 comma-separated mint addresses');
        for (const id of ids) { try { new PublicKey(id); } catch { throw new HttpError(400, `not a valid mint address: ${id}`, 'INVALID_MINT'); } }
        try { return await api.prices(ids); } catch (e) { upstream(e); }
    });

    /**
     * What a wallet holds on Solana mainnet: SOL and every token account with a balance (both token programs),
     * with the token facts and USD price where Jupiter has them. Keeps a mainnet RPC key out of the browser.
     */
    app.get('/solana/balances', perMin(30), async (req) => {
        const owner = ((req.query as Record<string, string>).owner ?? '').trim();
        let key: PublicKey;
        try { key = new PublicKey(owner); if (key.toBase58() !== owner) throw new Error(); } catch { throw new HttpError(400, 'owner is not a valid Solana address', 'INVALID_ADDRESS'); }
        if (!deps.mainnet) throw new HttpError(503, 'balances are not available');
        const conn = deps.mainnet;
        const programs = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
        let lamports: number, accounts: { mint: string; amount: string; decimals: number }[];
        try {
            const [l, ...parsed] = await Promise.all([conn.getBalance(key), ...programs.map(p => conn.getParsedTokenAccountsByOwner(key, { programId: new PublicKey(p) }))]);
            lamports = l;
            const byMint = new Map<string, { mint: string; amount: bigint; decimals: number }>();
            for (const res of parsed) for (const a of res.value) {
                const info = a.account.data.parsed.info;
                const amount = BigInt(info.tokenAmount.amount);
                if (amount === 0n) continue;
                const cur = byMint.get(info.mint);
                byMint.set(info.mint, { mint: info.mint, amount: (cur?.amount ?? 0n) + amount, decimals: info.tokenAmount.decimals });
            }
            accounts = [...byMint.values()].map(a => ({ ...a, amount: a.amount.toString() }));
        } catch (e) { throw new HttpError(502, `Solana RPC error: ${(e as Error).message}`.slice(0, 200)); }
        const mints = [WSOL_MINT, ...accounts.map(a => a.mint)].slice(0, 50);
        const prices = await api.prices(mints).catch(() => ({} as Record<string, { usdPrice: number }>));
        const row = (mint: string, amount: string, decimals: number, native = false) => {
            const t = catalog.cached(mint);
            const display = formatUnits(amount, decimals);
            const usdPrice = prices[mint]?.usdPrice ?? t?.usdPrice;
            return { mint, native, amount, decimals, display, symbol: t?.symbol, name: t?.name, icon: t?.icon, verified: !!t?.verified, isStock: !!t?.isStock,
                usdPrice, usdValue: usdPrice === undefined ? undefined : Number(display) * usdPrice };
        };
        return { owner, balances: [row(WSOL_MINT, String(lamports), 9, true), ...accounts.map(a => row(a.mint, a.amount, a.decimals))] };
    });

    // ── swaps ─────────────────────────────────────────────────────────────────
    app.get('/solana/quote', perMin(60), async (req) => {
        const q = req.query as Record<string, string>;
        return swaps.quote({ inputMint: q.inputMint, outputMint: q.outputMint, amount: q.amount, slippageBps: q.slippageBps, taker: q.taker });
    });

    app.post('/solana/swaps', perMin(20), async (req, reply) => {
        const b = (req.body ?? {}) as Record<string, unknown>;
        const out = await swaps.create({ inputMint: b.inputMint, outputMint: b.outputMint, amount: b.amount, slippageBps: b.slippageBps, taker: b.taker, receiver: b.receiver });
        return reply.status(201).send(out);
    });

    app.post('/solana/swaps/:id/execute', perMin(30), async (req) => {
        const { id } = req.params as { id: string };
        return swaps.execute(id, ((req.body ?? {}) as Record<string, unknown>).signedTransaction);
    });

    app.get('/solana/swaps/:id', async (req) => swaps.get((req.params as { id: string }).id));

    app.get('/solana/swaps', async (req) => {
        const q = req.query as Record<string, string>;
        return swaps.list(q.address, q.limit ? Math.min(Number(q.limit) || 50, 200) : 50);
    });
}
