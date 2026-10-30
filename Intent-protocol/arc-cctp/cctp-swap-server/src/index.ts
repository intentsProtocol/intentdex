/**
 * cctp-swap-server — USDC chain A → USDC chain B via Circle CCTP V2.
 *
 * The user's wallet signs the burn on chain A; this server tracks it, fetches Circle's attestation and
 * submits the mint on chain B (paying gas). It never holds user funds, and every burn uses
 * destinationCaller = 0 so the user can always mint themselves from GET /transfers/:id.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config, enabledChains, getChain } from './config.js';
import { getSecret, loadedSecretNames } from './secrets.js';
import { formatUsdc } from './cctp/encoding.js';
import { IrisClient } from './cctp/iris.js';
import { QuoteService } from './cctp/quote.js';
import type { ChainAdapter } from './chains/adapter.js';
import { EvmAdapter } from './evm/EvmAdapter.js';
import { SolanaAdapter } from './solana/SolanaAdapter.js';
import { TransferStore } from './store/TransferStore.js';
import { TransferService } from './service/TransferService.js';
import { TransferWorker } from './worker/TransferWorker.js';
import { Settings } from './settings.js';
import { EventLog } from './ops/EventLog.js';
import { LOW_BALANCE, RelayerBalances, registerAdminRoutes } from './adminRoutes.js';
import { registerProfitRoutes } from './adminProfitRoutes.js';
import { Treasury } from './treasury/Treasury.js';
import { ReferralManager } from './jupiter/Referral.js';
import { Connection } from '@solana/web3.js';
import { JupiterClient } from './jupiter/JupiterClient.js';
import { TokenCatalog } from './jupiter/TokenCatalog.js';
import { SwapStore } from './jupiter/SwapStore.js';
import { SolanaSwapService, type SignatureCheck } from './jupiter/SolanaSwapService.js';
import { registerSolanaRoutes } from './jupiter/routes.js';
import { registerLend, type LendModule } from './lend/routes.js';
import { registerLendBch, type LendBchModule } from './lendbch/routes.js';
import { registerChainRoutes } from './chainRoutes.js';
import { HttpError, type Transfer, type TransferStatus } from './types.js';
import { transferView } from './service/transferView.js';
import { chainView, publicConfig } from './publicConfig.js';
import { bchItem, parseAddresses, selectActivity, swapItem, transferItem } from './activity.js';
import { errMsg, logger } from './log.js';
import { OneClickClient } from './bch/OneClickClient.js';
import { TokenCatalog as BchTokenCatalog } from './bch/TokenCatalog.js';
import { BchSwapStore } from './bch/BchSwapStore.js';
import { BchSwapService } from './bch/BchSwapService.js';
import { BchSwapWorker } from './bch/BchSwapWorker.js';
import { registerBchRoutes } from './bch/routes.js';

const log = logger('server');

// ── wiring ────────────────────────────────────────────────────────────────────
const evmKey = getSecret('CCTP_RELAYER_EVM_KEY');
const solKey = getSecret('CCTP_RELAYER_SOLANA_KEY');

const adapters = new Map<string, ChainAdapter>();
for (const c of enabledChains()) {
    adapters.set(c.key, c.kind === 'evm' ? new EvmAdapter(c, evmKey || undefined) : new SolanaAdapter(c, solKey || undefined));
}
const iris = new IrisClient(config.irisBaseUrl);
const settings = new Settings(config.dataDir);
const events = new EventLog(config.dataDir);
const store = new TransferStore(config.dataDir);
const quotes = new QuoteService(iris, adapters);
const treasury = new Treasury(config.dataDir);
const service = new TransferService(store, adapters, quotes, settings, treasury);
const worker = new TransferWorker(store, adapters, iris, config.worker, config.limits, () => settings.cctp.relayEnabled, () => settings.cctp.feeEnforced);
const balances = new RelayerBalances(adapters);

// Solana same-chain swaps (Jupiter, mainnet). No relayer key involved: the user signs, Jupiter lands the tx.
const jupKey = getSecret('JUPITER_API_KEY');
const jupiter = new JupiterClient(config.jupiter.baseUrl, jupKey, config.jupiter.rps || (jupKey ? 1 : 0.5));
const catalog = new TokenCatalog(jupiter, config.jupiter.tokenRefreshMin * 60_000);
const swapStore = new SwapStore(config.dataDir);
const mainnet = new Connection(config.jupiter.solanaRpcUrl, 'confirmed');
const checkSignature: SignatureCheck = async (signature) => {
    const s = (await mainnet.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (!s) return 'unknown';
    if (s.err) return 'failed';
    return s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized' ? 'confirmed' : 'unknown';
};
const solanaSwaps = new SolanaSwapService(jupiter, swapStore, catalog, {
    referralAccount: config.jupiter.referralAccount || undefined, referralFeeBps: config.jupiter.referralFeeBps || undefined,
    maxSlippageBps: config.jupiter.maxSlippageBps, orderTtlSec: config.jupiter.orderTtlSec, landTimeoutSec: config.jupiter.landTimeoutSec,
    policy: () => settings.solana,
}, checkSignature);
const referral = new ReferralManager(mainnet, catalog);

// ── Bitcoin Cash cross-chain swaps via NEAR Intents 1Click API ───────────────
const bchClient = new OneClickClient({
    baseUrl: config.bch.oneClickBaseUrl,
    partnerJwt: config.bch.partnerJwt,
});
const bchCatalog = new BchTokenCatalog(bchClient, config.bch.tokenRefreshMin);
const bchStore = new BchSwapStore(config.dataDir);
const bchService = new BchSwapService({
    client: bchClient,
    catalog: bchCatalog,
    store: bchStore,
    settings,
    defaultFeeBps: config.bch.defaultFeeBps,
    feeRecipientNear: config.bch.feeRecipientNear,
    minSwapUsd: config.bch.minSwapUsd,
    maxSwapUsd: config.bch.maxSwapUsd,
});
const bchWorker = new BchSwapWorker({
    client: bchClient,
    store: bchStore,
    service: bchService,
    pollIntervalMs: config.bch.pollIntervalMs,
});

bchStore.onChange = (prev, b) => {
    if (prev?.status === b.status) return;
    const pair = `${b.fromSymbol} (${b.fromChain}) → ${b.toSymbol} (${b.toChain})`;
    const usd = b.amountInUsd ? ` ($${b.amountInUsd.toFixed(2)})` : '';
    events.record({
        section: 'bch',
        type: `bch.${b.status.toLowerCase()}`,
        severity: b.status === 'SUCCESS' ? 'success' : b.status === 'FAILED' ? 'error' : b.status === 'EXPIRED' ? 'warn' : 'info',
        summary: !prev ? `BCH swap initiated: ${pair}${usd}`
            : b.status === 'FAILED' ? `BCH swap failed: ${pair}${usd}: ${b.lastError ?? 'unknown reason'}`
            : `${pair}${usd}: ${prev.status} → ${b.status}`,
        subject: { kind: 'swap', id: b.id },
        data: { depositAddress: b.depositAddress, depositTxHash: b.depositTxHash, settleTxHash: b.settleTxHash, ourFeeUsd: b.ourFeeUsd },
    });
};

// ── event log: every status change of a transfer or a swap ────────────────────
const TRANSFER_SEVERITY: Partial<Record<TransferStatus, 'success' | 'warn' | 'error'>> = { COMPLETED: 'success', COMPLETED_EXTERNAL: 'success', FAILED: 'error', EXPIRED: 'warn' };
store.onChange = (prev, t) => {
    if (prev && prev.feeStatus !== t.feeStatus && t.protocolFee && (t.feeStatus === 'paid' || t.feeStatus === 'unpaid' || t.feeStatus === 'awaiting')) {
        const fee = `${formatUsdc(t.protocolFee)} USDC`;
        events.record({
            section: 'cctp', type: `fee.${t.feeStatus}`, severity: t.feeStatus === 'paid' ? 'success' : 'warn',
            summary: t.feeStatus === 'paid' ? `Fee received: ${fee} on ${t.src} → ${t.dst}`
                : t.feeStatus === 'unpaid' ? `Fee not paid: ${fee} on ${t.src} → ${t.dst} (delivered anyway)`
                : `Waiting for the fee: ${fee} on ${t.src} → ${t.dst}; the mint is on hold`,
            subject: { kind: 'transfer', id: t.id }, data: { protocolFee: t.protocolFee, feeRecipient: t.feeRecipient, feeTxHash: t.feeTxHash },
        });
    }
    if (prev?.status === t.status) return;
    const route = `${t.src} → ${t.dst || '?'}`;
    const amount = t.amount !== '0' ? `${formatUsdc(t.grossAmount ?? t.amount)} USDC ` : '';
    events.record({
        section: 'cctp', type: `transfer.${t.status.toLowerCase()}`, severity: TRANSFER_SEVERITY[t.status] ?? 'info',
        summary: !prev ? `Transfer created: ${amount}${route}${t.origin === 'track' ? ' (tracked burn)' : ''}`
            : t.status === 'FAILED' ? `Transfer failed: ${amount}${route}: ${t.failReason ?? 'unknown reason'}`
            : `${amount}${route}: ${prev.status} → ${t.status}`,
        subject: { kind: 'transfer', id: t.id },
        data: { src: t.src, dst: t.dst, amount: t.amount, burnTxHash: t.burnTxHash, mintTxHash: t.mintTxHash, failReason: t.failReason },
    });
};
swapStore.onChange = (prev, s) => {
    if (s.feeCollected && !prev?.feeCollected) {
        events.record({
            section: 'solana', type: 'fee.collected', severity: 'success',
            summary: `Fee collected: ${s.referralFeeBps} bps on ${s.inSymbol ?? '?'} → ${s.outSymbol ?? '?'} (ours ${s.feeCollected.ours} base units of ${catalog.cached(s.feeCollected.mint)?.symbol ?? s.feeCollected.mint.slice(0, 6)})`,
            subject: { kind: 'swap', id: s.id }, data: { ...s.feeCollected, referralFeeBps: s.referralFeeBps },
        });
    }
    if (prev?.status === s.status) return;
    const pair = `${s.inSymbol ?? s.inputMint.slice(0, 6)} → ${s.outSymbol ?? s.outputMint.slice(0, 6)}`;
    const usd = s.inUsdValue ? ` ($${s.inUsdValue.toFixed(2)})` : '';
    events.record({
        section: 'solana', type: `swap.${s.status.toLowerCase()}`,
        severity: s.status === 'COMPLETED' ? 'success' : s.status === 'FAILED' ? 'error' : s.status === 'EXPIRED' ? 'warn' : 'info',
        summary: !prev ? `Swap created: ${pair}${usd}`
            : s.status === 'FAILED' ? `Swap failed: ${pair}${usd}: ${s.failReason ?? 'unknown reason'}`
            : `${pair}${usd}: ${prev.status} → ${s.status}`,
        subject: { kind: 'swap', id: s.id },
        data: { taker: s.taker, inputMint: s.inputMint, outputMint: s.outputMint, inAmount: s.inAmount, outAmount: s.outAmount, signature: s.signature, router: s.router, jupiterCode: s.jupiterCode },
    });
};

function relayerAddresses() {
    const evm = [...adapters.values()].find(a => a.chain.kind === 'evm')?.relayerAddress();
    const solana = [...adapters.values()].find(a => a.chain.kind === 'solana')?.relayerAddress();
    return { evm, solana };
}

// Wrapped so that Array.map's index never lands in transferView's `now`.
const view = (t: Transfer) => transferView(t);

// ── http ──────────────────────────────────────────────────────────────────────
const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
await app.register(cors, { origin: true, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['content-type', 'x-admin-key'] });

await app.register(rateLimit, { global: false });

// Every non-2xx answer is { error, code }: a sentence for the user and a code for the client to branch on.
app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message, code: err.code });
    if ((err as any).statusCode === 429) return reply.status(429).send({ error: 'rate limited', code: 'RATE_LIMITED' });
    if ((err as any).validation || ((err as any).statusCode >= 400 && (err as any).statusCode < 500)) {
        return reply.status((err as any).statusCode ?? 400).send({ error: err.message, code: 'INVALID_REQUEST' });
    }
    log.error('unhandled', { err: errMsg(err) });
    return reply.status(500).send({ error: errMsg(err), code: 'INTERNAL' });
});
app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'no such route', code: 'NOT_FOUND' }));

app.get('/health', async () => ({
    status: 'ok',
    network: config.network,
    paused: service.paused,
    chains: enabledChains().filter(c => settings.chainOpen(c.key)).map(c => c.key),
    relayer: relayerAddresses(),
    transfers: store.countByStatus(),
    solanaSwaps: {
        enabled: config.jupiter.enabled, network: 'mainnet', paused: settings.solana.paused, stocksEnabled: settings.solana.stocksEnabled, apiKey: !!jupKey,
        tokens: catalog.size, tokensAgeSec: catalog.ageSec, referralFeeBps: settings.solana.referralFeeBps,
        swaps: swapStore.countByStatus(),
    },
    bchSwaps: {
        enabled: config.bch.enabled && settings.bch.enabled,
        network: 'mainnet',
        paused: settings.bch.paused,
        feeBps: settings.bch.feeBps,
        feeRecipientNear: settings.bch.feeRecipientNear,
        tokens: bchCatalog.list().length,
        swaps: bchStore.countByStatus(),
    },
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
}));

app.get('/chains', async () => enabledChains().filter(c => settings.chainOpen(c.key)).map(chainView));

/** Both products in one call: open or paused, limits, fee policy, slippage bounds, networks, chains. */
app.get('/config', async () => ({
    ...publicConfig(settings, treasury),
    lend: lend?.publicConfig() ?? { enabled: false, paused: false, pauseReason: null, provider: 'liquidium' },
    lendbch: lendBch?.publicConfig() ?? { enabled: false, paused: false, pauseReason: null, provider: 'paryon', network: lendBchNetwork },
}));

app.get('/quote', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const q = req.query as Record<string, string>;
    const quote = await service.quote(q.src, q.dst, q.amount, q.speed);
    return { ...quote, display: { amount: formatUsdc(quote.amount), protocolFee: formatUsdc(quote.protocolFee), burnAmount: formatUsdc(quote.burnAmount), expectedFee: formatUsdc(quote.expectedFee), maxFee: formatUsdc(quote.maxFee), expectedReceive: formatUsdc(quote.expectedReceive) } };
});

app.post('/transfers', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, any>;
    const { transfer, quote, txs } = await service.create({
        src: b.src, dst: b.dst, amount: b.amount, sender: b.sender, recipient: b.recipient, speed: b.speed,
    });
    return reply.status(201).send({ transfer: view(transfer), quote, txs });
});

app.post('/transfers/:id/rebuild', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { id } = req.params as { id: string };
    const { transfer, txs } = await service.rebuild(id);
    return { transfer: view(transfer), txs };
});

app.post('/transfers/:id/burn', async (req) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as Record<string, any>;
    const t = service.submitBurn(id, b.txHash, b.feeTxHash);
    worker.tick();
    return view(t);
});

/** EVM sources with a service fee: the hash of the fee transfer (the third transaction returned by POST /transfers). */
app.post('/transfers/:id/fee', async (req) => {
    const { id } = req.params as { id: string };
    const t = service.submitFee(id, ((req.body ?? {}) as Record<string, any>).txHash);
    worker.tick();
    return view(t);
});

app.get('/transfers/:id', async (req) => view(service.mustGet((req.params as { id: string }).id)));

app.get('/transfers', async (req) => {
    const q = req.query as Record<string, string>;
    return store.list({ address: q.address, limit: q.limit ? Math.min(Number(q.limit) || 50, 200) : 50 }).map(view);
});

app.post('/track', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, any>;
    const t = service.track(b.src, b.txHash);
    worker.tick();
    return reply.status(201).send(view(t));
});

/**
 * Transfers and swaps as one list, newest first. With `address` (1-5, repeated or comma-separated): that
 * wallet's history. Without: the public feed, which leaves out records that never reached a chain.
 */
app.get('/activity', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const q = req.query as Record<string, string | string[]>;
    const addresses = parseAddresses(q.address);
    const limit = Math.min(Math.max(Math.floor(Number(q.limit)) || 50, 1), 200);
    const before = q.before === undefined || q.before === '' ? undefined : Number(q.before);
    if (before !== undefined && !(before > 0)) throw new HttpError(400, 'before must be a createdAt timestamp in milliseconds');
    // A wallet asking for its own history gets its open swaps settled first; the sweep below covers the rest.
    if (addresses.length && config.jupiter.enabled) await solanaSwaps.settleOpen(addresses);
    const items = selectActivity(store.all(), config.jupiter.enabled ? swapStore.all() : [], { addresses, limit, before }, {
        transfer: t => transferItem(view(t), getChain, config.network),
        swap: s => swapItem(solanaSwaps.view(s)),
        bch: b => bchItem(b),
    }, config.bch.enabled ? bchStore.all() : []);
    return { serverTime: Date.now(), items };
});

registerChainRoutes(app, { service, view, onBurn: () => worker.tick() });

if (config.jupiter.enabled) registerSolanaRoutes(app, { api: jupiter, catalog, swaps: solanaSwaps, settings: () => settings.solana, mainnet });

if (config.bch.enabled) registerBchRoutes(app, { service: bchService, catalog: bchCatalog });

// ── lending (mainnet only: the protocol has no testnet) ──
const lend: LendModule | undefined = process.env.LEND_ENABLED === 'true'
    ? await registerLend(app, { dataDir: config.dataDir, events, pollSec: Number(process.env.LEND_POLL_SEC) || 45 })
    : undefined;
if (lend && config.network !== 'mainnet') app.log.warn('LEND_ENABLED is set on a testnet instance: the lending protocol is mainnet only, loans made here are real');

// ── lendbch: BCH → PUSD borrowing through ParyonUSD (its own network flag, independent of CCTP_NETWORK) ──
const lendBchNetwork = process.env.LENDBCH_NETWORK === 'chipnet' ? 'chipnet' : 'mainnet';
let lendBch: LendBchModule | undefined;
if (process.env.LENDBCH_ENABLED === 'true') {
    const pollSec = Number(process.env.LENDBCH_POLL_SEC) || 60;
    // Index cache TTL. Kept above the poll interval so reads between polls always hit the warm cache; the poller
    // force-refreshes it on its own timer. Chipnet Electrum cold scans are slow (~70s), so a short TTL here would
    // otherwise make every expiry a cold read that outlives the client timeout.
    const cacheMs = Number(process.env.LENDBCH_CACHE_MS) || 120_000;
    if (lendBchNetwork === 'chipnet') {
        // Our own Paryon copy on chipnet; its token IDs come from the deploy script's data file.
        const { loadChipnetDeployment } = await import('./lendbch/chipnetConfig.js');
        const chipnet = loadChipnetDeployment(config.dataDir);
        if (!chipnet) app.log.warn('LENDBCH_NETWORK=chipnet but data/lendbch-chipnet.json is missing; run scripts/lendbch/deploy-chipnet.ts first — lendbch not started');
        else lendBch = await registerLendBch(app, { dataDir: config.dataDir, params: chipnet.params, events, pollSec, cacheMs });
    } else {
        lendBch = await registerLendBch(app, { dataDir: config.dataDir, events, pollSec, cacheMs });
        if (config.network !== 'mainnet') app.log.warn('LENDBCH mainnet is running on a testnet instance: it reads Paryon mainnet, keep this to the :3013 mainnet server');
    }
}

// ── admin ─────────────────────────────────────────────────────────────────────
const startedAt = Date.now();
registerAdminRoutes(app, {
    settings, events, store, service, worker, adapters, balances, transferView: view,
    swapStore, solanaSwaps, catalog, jupiter, startedAt,
});
registerProfitRoutes(app, { settings, events, store, swapStore, bchStore, adapters, treasury, referral, catalog, mainnet });

// ── watchdog: stuck transfers + low relayer balances (no RPC calls in /health) ───
const warnedAt = new Map<string, number>();   // at most one warning per subject per 30 min
const warnOnce = (key: string) => {
    if (Date.now() - (warnedAt.get(key) ?? 0) < 30 * 60_000) return false;
    warnedAt.set(key, Date.now());
    return true;
};
const watchdog = setInterval(async () => {
    const cutoff = Date.now() - config.watchdog.stuckMin * 60_000;
    for (const t of store.active()) {
        if (t.status !== 'CREATED' && t.updatedAt < cutoff) {
            const minutes = Math.round((Date.now() - t.updatedAt) / 60_000);
            log.warn('stuck transfer', { id: t.id, status: t.status, lastError: t.lastError, minutes });
            if (warnOnce(`stuck:${t.id}`)) {
                events.record({ section: 'cctp', type: 'watchdog.stuck', severity: 'warn', summary: `Transfer ${t.id.slice(0, 8)} has been ${t.status} for ${minutes} min${t.lastError ? `: ${t.lastError}` : ''}`, subject: { kind: 'transfer', id: t.id } });
            }
        }
    }
    for (const b of await balances.get(true).catch(() => [])) {
        if (b.low && warnOnce(`low:${b.chain}`)) {
            log.warn('relayer balance low', { chain: b.chain, relayer: b.relayer, amount: b.amount, symbol: b.symbol, min: LOW_BALANCE[b.symbol ?? ''] });
            events.record({ section: 'cctp', type: 'watchdog.low_balance', severity: 'warn', summary: `${b.name}: relayer gas is low (${b.amount} ${b.symbol})`, subject: { kind: 'chain', id: b.chain } });
        }
    }
}, config.watchdog.intervalMs);
watchdog.unref();

// ── swap sweep: expire unsigned swaps and settle lost execute replies, so lists and /activity read true states ──
const swapSweep = setInterval(() => { if (config.jupiter.enabled) void solanaSwaps.settleOpen().catch(() => undefined); }, config.jupiter.sweepIntervalMs);
swapSweep.unref();

// ── start / stop ──────────────────────────────────────────────────────────────
async function shutdown(signal: string) {
    log.info('shutting down', { signal });
    clearInterval(watchdog);
    clearInterval(swapSweep);
    catalog.stop();
    bchCatalog.stop();
    bchWorker.stop();
    await app.close().catch(() => undefined);
    await worker.stop();
    process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: '0.0.0.0' });
worker.start();
if (config.jupiter.enabled) {
    catalog.start();
    if (!jupKey) log.warn('JUPITER_API_KEY not set: Solana swaps run on the keyless limit (0.5 req/s); set a key before real traffic');
}
if (config.bch.enabled) {
    bchCatalog.init().catch(err => log.warn('bch token catalog init error', { err: errMsg(err) }));
    bchWorker.start();
}
events.record({ section: 'system', type: 'server.start', severity: 'info', summary: `Server started on port ${config.port}` });
log.info('listening', {
    port: config.port, network: config.network, chains: enabledChains().map(c => c.key),
    relayer: relayerAddresses(), secrets: loadedSecretNames(),
});
if (!evmKey || !solKey) log.warn('relayer key(s) missing: quotes and burns work, but mints on those chains will not be relayed', { evm: !!evmKey, solana: !!solKey });
