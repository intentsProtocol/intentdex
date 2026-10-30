/**
 * /admin/* — the operator API behind the admin console. Every route needs x-admin-key.
 *
 * Three groups: shared (overview, events, settings, system), /admin/cctp/* for cross-chain USDC transfers and
 * /admin/solana/* for Jupiter swaps. Each action writes an event, so the console shows who-did-what in order.
 */
import type { FastifyInstance } from 'fastify';
import { PublicKey } from '@solana/web3.js';
import { requireAdmin } from './admin.js';
import { config, enabledChains, getChain } from './config.js';
import { loadedSecretNames } from './secrets.js';
import { formatUsdc } from './cctp/encoding.js';
import type { ChainAdapter } from './chains/adapter.js';
import type { JupiterClient } from './jupiter/JupiterClient.js';
import type { SolanaSwapService } from './jupiter/SolanaSwapService.js';
import type { SwapStore } from './jupiter/SwapStore.js';
import type { TokenCatalog } from './jupiter/TokenCatalog.js';
import { SWAP_TERMINAL } from './jupiter/types.js';
import { errMsg, logger } from './log.js';
import type { EventLog } from './ops/EventLog.js';
import { cctpStats, solanaStats } from './ops/stats.js';
import type { TransferService } from './service/TransferService.js';
import type { Settings } from './settings.js';
import type { TransferStore } from './store/TransferStore.js';
import { HttpError, TERMINAL_STATUSES, type Transfer } from './types.js';
import type { TransferWorker } from './worker/TransferWorker.js';

const log = logger('admin');

/** Native-gas floor per symbol below which a relayer wallet is reported low. */
export const LOW_BALANCE: Record<string, number> = { ETH: 0.005, SOL: 0.05, 'USDC (native gas)': 1 };

export interface RelayerBalance { chain: string; name: string; kind: string; relayer?: string; amount?: string; symbol?: string; usdc?: string; low?: boolean; error?: string; at: number }

/** Relayer gas balances, read from every chain at most once a minute. */
export class RelayerBalances {
    private cache: RelayerBalance[] = [];
    private at = 0;
    private loading?: Promise<RelayerBalance[]>;

    constructor(private adapters: Map<string, ChainAdapter>, private ttlMs = 60_000) {}

    get ageSec(): number | undefined { return this.at ? Math.round((Date.now() - this.at) / 1000) : undefined; }
    peek(): RelayerBalance[] { return this.cache; }

    get(fresh = false): Promise<RelayerBalance[]> {
        if (!fresh && this.at && Date.now() - this.at < this.ttlMs) return Promise.resolve(this.cache);
        this.loading ??= Promise.all([...this.adapters.values()].map(async (a): Promise<RelayerBalance> => {
            const base = { chain: a.chain.key, name: a.chain.name, kind: a.chain.kind, relayer: a.relayerAddress(), at: Date.now() };
            if (!base.relayer) return { ...base, error: 'no relayer key' };
            try {
                const [b, usdc] = await Promise.all([a.relayerBalance(), a.usdcBalance(base.relayer).catch(() => undefined)]);
                const min = LOW_BALANCE[b.symbol];
                return { ...base, ...b, usdc: usdc === undefined ? undefined : formatUsdc(usdc), low: min !== undefined && Number(b.amount) < min };
            } catch (e) { return { ...base, error: errMsg(e) }; }
        })).then(list => { this.cache = list; this.at = Date.now(); return list; }).finally(() => { this.loading = undefined; });
        return this.loading;
    }
}

export interface AdminDeps {
    settings: Settings;
    events: EventLog;
    store: TransferStore;
    service: TransferService;
    worker: TransferWorker;
    adapters: Map<string, ChainAdapter>;
    balances: RelayerBalances;
    transferView: (t: Transfer) => unknown;
    swapStore: SwapStore;
    solanaSwaps: SolanaSwapService;
    catalog: TokenCatalog;
    jupiter: JupiterClient;
    startedAt: number;
}

const int = (v: unknown, def: number, max: number) => Math.min(Math.max(Number(v) || def, 0), max);
const body = (req: { body?: unknown }) => (req.body ?? {}) as Record<string, any>;

export function registerAdminRoutes(app: FastifyInstance, d: AdminDeps) {
    const { settings, events, store, service, worker, swapStore, solanaSwaps, catalog, jupiter, balances } = d;

    const chainRows = (bal: RelayerBalance[]) => enabledChains().map(c => ({
        key: c.key, name: c.name, kind: c.kind, domain: c.domain, chainId: c.chainId, usdc: c.usdc,
        fastSource: c.fastSource, standardEtaSec: c.standardEtaSec, fastEtaSec: c.fastEtaSec,
        open: settings.chainOpen(c.key), rpcHost: safeHost(c.rpcUrl),
        relayer: bal.find(b => b.chain === c.key),
    }));

    /** Everything that needs an operator's attention, worst first. */
    function alerts(bal: RelayerBalance[]) {
        const out: { severity: 'error' | 'warn'; section: 'cctp' | 'solana' | 'system'; text: string }[] = [];
        const c = cctpStats(store.all(), Date.now(), config.watchdog.stuckMin);
        if (settings.cctp.paused) out.push({ severity: 'warn', section: 'cctp', text: `New cross-chain transfers are paused${settings.cctp.pauseReason ? `: ${settings.cctp.pauseReason}` : ''}` });
        if (!settings.cctp.relayEnabled) out.push({ severity: 'warn', section: 'cctp', text: 'Relaying is switched off: attested transfers wait for the user to mint' });
        if (c.stuck.length) out.push({ severity: 'error', section: 'cctp', text: `${c.stuck.length} transfer(s) have not moved for ${config.watchdog.stuckMin} min` });
        for (const b of bal) {
            if (b.error) out.push({ severity: b.error === 'no relayer key' ? 'error' : 'warn', section: 'cctp', text: `${b.name}: ${b.error}` });
            else if (b.low) out.push({ severity: 'error', section: 'cctp', text: `${b.name}: relayer gas is low (${b.amount} ${b.symbol})` });
        }
        for (const k of settings.cctp.disabledChains) out.push({ severity: 'warn', section: 'cctp', text: `${getChain(k)?.name ?? k} is closed` });
        if (config.jupiter.enabled) {
            const j = jupiter.stats();
            if (settings.solana.paused) out.push({ severity: 'warn', section: 'solana', text: `New Solana swaps are paused${settings.solana.pauseReason ? `: ${settings.solana.pauseReason}` : ''}` });
            if (!j.apiKey) out.push({ severity: 'warn', section: 'solana', text: 'No Jupiter API key: limited to one request every 2 s' });
            if (!catalog.ready) out.push({ severity: 'error', section: 'solana', text: 'The token list has not loaded' });
            else if ((catalog.ageSec ?? 0) > config.jupiter.tokenRefreshMin * 60 * 3) out.push({ severity: 'warn', section: 'solana', text: `The token list is ${Math.round((catalog.ageSec ?? 0) / 60)} min old: refreshes are failing` });
            if (j.lastErrorAt && Date.now() - j.lastErrorAt < 10 * 60_000) out.push({ severity: 'warn', section: 'solana', text: `Jupiter error ${Math.round((Date.now() - j.lastErrorAt) / 1000)} s ago: ${j.lastError}` });
            const sub = swapStore.all().filter(s => s.status === 'SUBMITTED' && Date.now() - (s.submittedAt ?? s.createdAt) > 60_000).length;
            if (sub) out.push({ severity: 'warn', section: 'solana', text: `${sub} swap(s) submitted over a minute ago with no result` });
        } else {
            out.push({ severity: 'warn', section: 'solana', text: 'Solana swaps are disabled in env (JUPITER_ENABLED=false)' });
        }
        return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
    }

    const solanaStatus = () => ({
        enabled: config.jupiter.enabled, network: 'mainnet' as const,
        jupiter: { ...jupiter.stats(), baseUrl: config.jupiter.baseUrl, referralAccount: config.jupiter.referralAccount || null },
        catalog: { ready: catalog.ready, tokens: catalog.size, ageSec: catalog.ageSec, stocks: Object.values(catalog.stockIssuers()).reduce((a, b) => a + b, 0), issuers: catalog.stockIssuers() },
        rpcHost: safeHost(config.jupiter.solanaRpcUrl),
    });

    const act = (section: 'cctp' | 'solana' | 'system', type: string, summary: string, extra: Partial<Parameters<EventLog['record']>[0]> = {}) => {
        log.info(summary, { type });
        return events.record({ section, type, severity: 'info', summary, ...extra });
    };

    app.register(async (admin) => {
        admin.addHook('onRequest', requireAdmin);

        // ── shared ────────────────────────────────────────────────────────────
        admin.get('/admin/auth/check', async () => ({ ok: true }));

        admin.get('/admin/overview', async () => {
            const now = Date.now();
            const bal = await balances.get();
            return {
                network: { cctp: config.network, solana: 'mainnet' },
                uptimeSec: Math.round((now - d.startedAt) / 1000),
                alerts: alerts(bal),
                cctp: { settings: settings.cctp, stats: cctpStats(store.all(), now, config.watchdog.stuckMin), chains: chainRows(bal), balancesAgeSec: balances.ageSec },
                solana: { settings: settings.solana, stats: solanaStats(swapStore.all(), now), ...solanaStatus() },
                events: { h24: events.countSince(now - 24 * 3600_000), recent: events.query({ limit: 15 }).events },
            };
        });

        admin.get('/admin/events', async (req) => {
            const q = req.query as Record<string, string>;
            return events.query({ section: q.section, severity: q.severity, type: q.type, subject: q.subject, limit: int(q.limit, 100, 500), offset: int(q.offset, 0, 100_000) });
        });

        admin.post('/admin/events/note', async (req) => {
            const b = body(req);
            if (typeof b.text !== 'string' || !b.text.trim()) throw new HttpError(400, 'text is required');
            const section = b.section === 'cctp' || b.section === 'solana' ? b.section : 'system';
            return { event: events.record({ section, type: 'admin.note', severity: 'info', summary: b.text.trim().slice(0, 500) }) };
        });

        admin.get('/admin/settings', async () => ({
            settings: settings.all(),
            env: {
                referralAccount: config.jupiter.referralAccount || null,
                chains: enabledChains().map(c => ({ key: c.key, name: c.name })),
                defaults: { minTransferUsdc: config.limits.minTransferUsdc, maxTransferUsdc: config.limits.maxTransferUsdc, feeBufferPct: config.quote.feeBufferPct, maxSlippageBps: config.jupiter.maxSlippageBps },
            },
            history: events.query({ type: 'admin.settings', limit: 30 }).events,
        }));

        admin.post('/admin/settings', async (req) => {
            const b = body(req);
            const changed = settings.patch({ cctp: b.cctp, solana: b.solana });
            if (changed.length) {
                const sections = new Set(changed.map(c => c.split('.')[0]));
                act(sections.size === 1 ? ([...sections][0] as 'cctp' | 'solana') : 'system', 'admin.settings', `Settings changed: ${changed.join(', ')}`,
                    { subject: { kind: 'settings', id: 'settings' }, data: { changed, cctp: b.cctp, solana: b.solana, note: typeof b.note === 'string' ? b.note.slice(0, 200) : undefined } });
            }
            return { settings: settings.all(), changed };
        });

        admin.post('/admin/settings/reset', async (req) => {
            const section = body(req).section;
            if (section !== 'cctp' && section !== 'solana') throw new HttpError(400, "section must be 'cctp' or 'solana'");
            settings.reset(section);
            act(section, 'admin.settings.reset', `${section === 'cctp' ? 'Cross-chain' : 'Solana'} settings reset to the env defaults`, { severity: 'warn', subject: { kind: 'settings', id: 'settings' } });
            return { settings: settings.all() };
        });

        admin.get('/admin/system', async () => ({
            uptimeSec: Math.round((Date.now() - d.startedAt) / 1000), node: process.version,
            memoryMb: Math.round(process.memoryUsage().rss / 1048576),
            port: config.port, dataDir: config.dataDir, secrets: loadedSecretNames(),
            cctp: { network: config.network, irisBaseUrl: config.irisBaseUrl, worker: config.worker, limits: config.limits, watchdog: config.watchdog },
            solana: { ...solanaStatus(), orderTtlSec: config.jupiter.orderTtlSec, landTimeoutSec: config.jupiter.landTimeoutSec, tokenRefreshMin: config.jupiter.tokenRefreshMin },
        }));

        // ── cross-chain USDC ──────────────────────────────────────────────────
        admin.get('/admin/cctp/balances', async (req) => ({ balances: await balances.get((req.query as Record<string, string>).fresh === '1'), ageSec: balances.ageSec }));
        // older name, kept for scripts
        admin.get('/admin/balances', async () => Object.fromEntries((await balances.get(true)).map(b => [b.chain, b.error ? { error: b.error } : { relayer: b.relayer, amount: b.amount, symbol: b.symbol }])));

        admin.get('/admin/cctp/transfers', async (req) => {
            const q = req.query as Record<string, string>;
            let list = store.all();
            if (q.status === 'active') list = list.filter(t => !TERMINAL_STATUSES.has(t.status));
            else if (q.status === 'problem') list = list.filter(t => t.status === 'FAILED' || (!TERMINAL_STATUSES.has(t.status) && t.failCount > 0));
            else if (q.status) list = list.filter(t => t.status === q.status);
            if (q.src) list = list.filter(t => t.src === q.src);
            if (q.dst) list = list.filter(t => t.dst === q.dst);
            if (q.q) {
                const s = q.q.toLowerCase();
                list = list.filter(t => [t.id, t.sender, t.recipient, t.burnTxHash, t.mintTxHash].some(x => x?.toLowerCase().includes(s)));
            }
            list.sort((a, b) => b.createdAt - a.createdAt);
            const offset = int(q.offset, 0, 1_000_000), limit = int(q.limit, 50, 200);
            return { total: list.length, offset, limit, byStatus: store.countByStatus(), transfers: list.slice(offset, offset + limit).map(d.transferView) };
        });

        admin.get('/admin/cctp/transfers/:id', async (req) => {
            const t = service.mustGet((req.params as { id: string }).id);
            return { transfer: d.transferView(t), events: events.query({ subject: t.id, limit: 100 }).events };
        });

        const setCctpPause = (paused: boolean, why?: unknown) => {
            settings.patch({ cctp: { paused, pauseReason: paused ? why : undefined } });
            act('cctp', paused ? 'admin.pause' : 'admin.resume', paused ? `New cross-chain transfers paused${typeof why === 'string' && why ? `: ${why}` : ''}` : 'New cross-chain transfers resumed', { severity: paused ? 'warn' : 'success' });
            return { paused, settings: settings.cctp };
        };
        admin.post('/admin/cctp/pause', async (req) => setCctpPause(true, body(req).reason));
        admin.post('/admin/cctp/resume', async () => setCctpPause(false));
        // older names, kept for scripts
        admin.post('/admin/pause', async () => ({ paused: setCctpPause(true).paused }));
        admin.post('/admin/resume', async () => ({ paused: setCctpPause(false).paused }));

        admin.post('/admin/cctp/chains/:key', async (req) => {
            const { key } = req.params as { key: string };
            const chain = getChain(key);
            if (!chain) throw new HttpError(404, 'unknown chain');
            const open = body(req).open;
            if (typeof open !== 'boolean') throw new HttpError(400, 'open must be true or false');
            const cur = settings.cctp.disabledChains.filter(k => k !== key);
            settings.patch({ cctp: { disabledChains: open ? cur : [...cur, key] } });
            act('cctp', open ? 'admin.chain.open' : 'admin.chain.close', `${chain.name} ${open ? 'opened' : 'closed'} for new transfers`, { severity: open ? 'success' : 'warn', subject: { kind: 'chain', id: key } });
            return { chain: key, open, disabledChains: settings.cctp.disabledChains };
        });

        admin.post('/admin/cctp/routes', async (req) => {
            const b = body(req);
            const src = getChain(b.src), dst = getChain(b.dst);
            if (!src || !dst || src.key === dst.key) throw new HttpError(400, 'src and dst must be two different enabled chains');
            if (typeof b.open !== 'boolean') throw new HttpError(400, 'open must be true or false');
            const k = `${src.key}>${dst.key}`;
            const cur = settings.cctp.disabledRoutes.filter(r => r !== k);
            settings.patch({ cctp: { disabledRoutes: b.open ? cur : [...cur, k] } });
            act('cctp', b.open ? 'admin.route.open' : 'admin.route.close', `${src.name} → ${dst.name} ${b.open ? 'opened' : 'closed'}`, { severity: b.open ? 'success' : 'warn' });
            return { route: k, open: b.open, disabledRoutes: settings.cctp.disabledRoutes };
        });

        const retry = async (req: { params: unknown }) => {
            const t = service.mustGet((req.params as { id: string }).id);
            if (TERMINAL_STATUSES.has(t.status)) throw new HttpError(409, `transfer is ${t.status}`);
            store.update(t.id, { retryAfter: undefined, failCount: 0 });
            act('cctp', 'admin.transfer.retry', `Retry requested for transfer ${t.id.slice(0, 8)} (${t.status})`, { subject: { kind: 'transfer', id: t.id } });
            worker.tick();
            return d.transferView(store.get(t.id)!);
        };
        admin.post('/admin/cctp/transfers/:id/retry', retry);
        admin.post('/admin/transfers/:id/retry', retry);

        /** Stop relaying a transfer. Funds are never lost: an attested burn can still be minted by the user. */
        admin.post('/admin/cctp/transfers/:id/fail', async (req) => {
            const t = service.mustGet((req.params as { id: string }).id);
            if (TERMINAL_STATUSES.has(t.status)) throw new HttpError(409, `transfer is already ${t.status}`);
            if (t.status === 'MINT_SUBMITTED') throw new HttpError(409, 'a mint is in flight; wait for it to settle');
            const why = typeof body(req).reason === 'string' && body(req).reason.trim() ? body(req).reason.trim().slice(0, 200) : 'stopped by an admin';
            store.update(t.id, { status: t.status === 'CREATED' ? 'EXPIRED' : 'FAILED', failReason: why, retryAfter: undefined });
            act('cctp', 'admin.transfer.fail', `Transfer ${t.id.slice(0, 8)} stopped: ${why}`, { severity: 'warn', subject: { kind: 'transfer', id: t.id } });
            return d.transferView(store.get(t.id)!);
        });

        /** Put a FAILED transfer back in the queue, from the furthest step its record supports. */
        admin.post('/admin/cctp/transfers/:id/reopen', async (req) => {
            const t = service.mustGet((req.params as { id: string }).id);
            if (t.status !== 'FAILED') throw new HttpError(409, `only FAILED transfers can be reopened (this one is ${t.status})`);
            if (!t.burnTxHash) throw new HttpError(409, 'no burn was recorded for this transfer');
            const status = t.message && t.attestation && t.nonce ? 'ATTESTED' as const : 'BURN_SUBMITTED' as const;
            store.update(t.id, { status, failReason: undefined, lastError: undefined, failCount: 0, retryAfter: undefined, burnSubmittedAt: status === 'BURN_SUBMITTED' ? Date.now() : t.burnSubmittedAt });
            act('cctp', 'admin.transfer.reopen', `Transfer ${t.id.slice(0, 8)} reopened at ${status}`, { subject: { kind: 'transfer', id: t.id } });
            worker.tick();
            return d.transferView(store.get(t.id)!);
        });

        admin.post('/admin/cctp/track', async (req) => {
            const b = body(req);
            const t = service.track(b.src, b.txHash);
            act('cctp', 'admin.transfer.track', `Burn ${String(b.txHash).slice(0, 12)}… on ${b.src} adopted as transfer ${t.id.slice(0, 8)}`, { subject: { kind: 'transfer', id: t.id } });
            worker.tick();
            return d.transferView(t);
        });

        // ── Solana swaps ──────────────────────────────────────────────────────
        admin.get('/admin/solana/swaps', async (req) => {
            const q = req.query as Record<string, string>;
            let list = swapStore.all();
            if (q.status === 'active') list = list.filter(s => !SWAP_TERMINAL.has(s.status));
            else if (q.status) list = list.filter(s => s.status === q.status);
            if (q.mint) list = list.filter(s => s.inputMint === q.mint || s.outputMint === q.mint);
            if (q.stocks === '1') list = list.filter(s => catalog.cached(s.inputMint)?.isStock || catalog.cached(s.outputMint)?.isStock);
            if (q.q) {
                const s = q.q.toLowerCase();
                list = list.filter(x => [x.id, x.taker, x.receiver, x.signature, x.inSymbol, x.outSymbol, x.inputMint, x.outputMint].some(v => v?.toLowerCase().includes(s)));
            }
            list.sort((a, b) => b.createdAt - a.createdAt);
            const offset = int(q.offset, 0, 1_000_000), limit = int(q.limit, 50, 200);
            return { total: list.length, offset, limit, byStatus: swapStore.countByStatus(), swaps: list.slice(offset, offset + limit).map(s => solanaSwaps.view(s)) };
        });

        admin.get('/admin/solana/swaps/:id', async (req) => {
            const s = swapStore.get((req.params as { id: string }).id);
            if (!s) throw new HttpError(404, 'swap not found');
            return {
                swap: solanaSwaps.view(s),
                tokens: { input: catalog.cached(s.inputMint) ?? null, output: catalog.cached(s.outputMint) ?? null },
                events: events.query({ subject: s.id, limit: 100 }).events,
            };
        });

        /** Settle a swap from the chain now (the same check a client poll triggers). */
        admin.post('/admin/solana/swaps/:id/recheck', async (req) => {
            const id = (req.params as { id: string }).id;
            const before = swapStore.get(id)?.status;
            const swap = await solanaSwaps.get(id);
            act('solana', 'admin.swap.recheck', `Swap ${id.slice(0, 8)} rechecked: ${before} → ${swap.status}`, { subject: { kind: 'swap', id } });
            return swap;
        });

        const setSolPause = (paused: boolean, why?: unknown) => {
            settings.patch({ solana: { paused, pauseReason: paused ? why : undefined } });
            act('solana', paused ? 'admin.pause' : 'admin.resume', paused ? `New Solana swaps paused${typeof why === 'string' && why ? `: ${why}` : ''}` : 'New Solana swaps resumed', { severity: paused ? 'warn' : 'success' });
            return { paused, settings: settings.solana };
        };
        admin.post('/admin/solana/pause', async (req) => setSolPause(true, body(req).reason));
        admin.post('/admin/solana/resume', async () => setSolPause(false));

        admin.post('/admin/solana/tokens/refresh', async () => {
            await catalog.refresh();
            act('solana', 'admin.tokens.refresh', `Token list refreshed: ${catalog.size} tokens`);
            return solanaStatus().catalog;
        });

        admin.post('/admin/solana/tokens/block', async (req) => {
            const b = body(req);
            try { if (new PublicKey(b.mint).toBase58() !== b.mint) throw new Error(); } catch { throw new HttpError(400, 'mint is not a valid Solana mint address'); }
            if (typeof b.blocked !== 'boolean') throw new HttpError(400, 'blocked must be true or false');
            const cur = settings.solana.blockedMints.filter(m => m !== b.mint);
            settings.patch({ solana: { blockedMints: b.blocked ? [...cur, b.mint] : cur } });
            const sym = catalog.cached(b.mint)?.symbol ?? `${String(b.mint).slice(0, 6)}…`;
            act('solana', b.blocked ? 'admin.token.block' : 'admin.token.unblock', `${sym} ${b.blocked ? 'blocked' : 'unblocked'}`, { severity: b.blocked ? 'warn' : 'success', subject: { kind: 'token', id: b.mint } });
            return { blockedMints: settings.solana.blockedMints.map(m => ({ mint: m, symbol: catalog.cached(m)?.symbol, name: catalog.cached(m)?.name })) };
        });

        admin.get('/admin/solana/tokens/blocked', async () => ({
            blockedMints: settings.solana.blockedMints.map(m => ({ mint: m, symbol: catalog.cached(m)?.symbol, name: catalog.cached(m)?.name })),
        }));
    });
}

function safeHost(url: string): string {
    try { return new URL(url).host; } catch { return '?'; }
}
