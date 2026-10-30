/**
 * /lendbch/* — BCH → PUSD borrowing through ParyonUSD. /admin/lendbch/* — the operator's view.
 *
 * One call wires the module: `registerLendBch(app, { dataDir, params, events })`. Enabled by LENDBCH_ENABLED=true,
 * and the network is chosen with LENDBCH_NETWORK (mainnet | chipnet). P1 exposes the read layer only; prepare/submit
 * and the full admin surface arrive in later phases. Nothing here imports from `src/lend`.
 */
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../admin.js';
import { HttpError } from '../types.js';
import type { EventLog } from '../ops/EventLog.js';
import { LendBchService } from './LendBchService.js';
import { LendBchSettingsStore } from './SettingsStore.js';
import { LendBchLoanStore } from './LoanStore.js';
import { MAINNET_V1 } from './deployment.js';
import type { ChainClient } from './chain.js';
import type { DeploymentParams } from './types.js';

export interface LendBchModule {
    service: LendBchService;
    settings: LendBchSettingsStore;
    loanStore: LendBchLoanStore;
    publicConfig(): { enabled: boolean; paused: boolean; pauseReason: string | null; provider: string; network: string };
    stop(): void;
}

export interface LendBchOptions {
    dataDir: string;
    /** Deployment to read. Defaults to Paryon's mainnet-v1. */
    params?: DeploymentParams;
    events?: EventLog;
    /** Injected chain client (tests). */
    chain?: ChainClient;
    /** Injected loan store (tests). */
    loanStore?: LendBchLoanStore;
    /** Seconds between self-check refreshes. 0 turns the timer off (tests). */
    pollSec?: number;
    /** Index cache window in ms (tests pass 0). */
    cacheMs?: number;
}

const LOAN_ID_RE = /^[0-9a-f]{64}$/i;

export async function registerLendBch(app: FastifyInstance, opts: LendBchOptions): Promise<LendBchModule> {
    const params = opts.params ?? MAINNET_V1;
    const settings = new LendBchSettingsStore(opts.dataDir);
    const loanStore = opts.loanStore ?? new LendBchLoanStore(opts.dataDir);
    const service = new LendBchService({ params, settings, loanStore, chain: opts.chain, events: opts.events, cacheMs: opts.cacheMs });
    const perMin = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

    app.get('/lendbch/market', perMin(120), async () => service.market());

    /** Loans of one or more addresses (repeated or comma-separated `address`). */
    app.get('/lendbch/loans', perMin(60), async (req) => {
        const q = req.query as Record<string, string | string[]>;
        const raw = q.address ?? q.q ?? [];
        const list = (Array.isArray(raw) ? raw : [raw]).flatMap(v => String(v).split(','));
        return { loans: await service.loansByAddress(list) };
    });

    app.get('/lendbch/loans/:loanTokenId', perMin(120), async (req) => {
        const { loanTokenId } = req.params as { loanTokenId: string };
        if (!LOAN_ID_RE.test(loanTokenId)) throw new HttpError(400, 'loanTokenId must be 32 bytes of hex');
        const loan = await service.loanById(loanTokenId);
        if (!loan) throw new HttpError(404, 'loan not found');
        return loan;
    });

    // ── quote & builders ──

    function jsonSafe(val: any): any {
        if (typeof val === 'bigint') return val.toString();
        if (Array.isArray(val)) return val.map(jsonSafe);
        if (val !== null && typeof val === 'object') {
            const out: any = {};
            for (const [k, v] of Object.entries(val)) {
                out[k] = jsonSafe(v);
            }
            return out;
        }
        return val;
    }

    app.post('/lendbch/borrow/quote', perMin(120), async (req) => {
        return jsonSafe(await service.quoteBorrow((req.body ?? {}) as any));
    });

    app.post('/lendbch/quote', perMin(120), async (req) => {
        return jsonSafe(await service.quoteBorrow((req.body ?? {}) as any));
    });

    app.post('/lendbch/prepare/borrow', perMin(60), async (req) => {
        return jsonSafe(await service.prepareBorrow((req.body ?? {}) as any));
    });

    app.post('/lendbch/prepare/manage', perMin(60), async (req) => {
        return jsonSafe(await service.prepareManage((req.body ?? {}) as any));
    });

    app.post('/lendbch/prepare/rate', perMin(60), async (req) => {
        return jsonSafe(await service.prepareRate((req.body ?? {}) as any));
    });

    app.post('/lendbch/submit', perMin(30), async (req) => {
        return jsonSafe(await service.submit((req.body ?? {}) as any));
    });

    app.post('/lendbch/loan-key/build', perMin(60), async (req) => {
        const b = (req.body ?? {}) as any;
        if (!b.userAddress || !b.genesisUtxo || !b.feeUtxos) {
            throw new HttpError(400, 'Missing userAddress, genesisUtxo, or feeUtxos');
        }
        return jsonSafe(await service.buildCreateLoanKey(b));
    });

    app.post('/lendbch/borrow/build', perMin(60), async (req) => {
        const b = (req.body ?? {}) as any;
        if (!b.userAddress || !b.userTokenAddress || !b.borrowCents || !b.collateralSats || !b.enforcerUtxo || !b.proofUtxo || !b.userBchUtxos) {
            throw new HttpError(400, 'Missing required borrow build parameters');
        }
        return jsonSafe(await service.buildBorrow(b));
    });

    app.post('/lendbch/manage/build', perMin(60), async (req) => {
        const b = (req.body ?? {}) as any;
        if (!b.userAddress || !b.userTokenAddress || !b.loanTokenId || !b.actionType || !b.loanKeyUtxo || !b.userBchUtxos) {
            throw new HttpError(400, 'Missing required manage build parameters');
        }
        return jsonSafe(await service.buildManage(b));
    });

    app.post('/lendbch/rate/build', perMin(60), async (req) => {
        const b = (req.body ?? {}) as any;
        if (!b.userAddress || !b.userTokenAddress || !b.loanTokenId || b.nextRate == null || !b.loanKeyUtxo || !b.userBchUtxos) {
            throw new HttpError(400, 'Missing required changeRate build parameters');
        }
        return jsonSafe(await service.buildChangeRate(b));
    });

    app.post('/lendbch/broadcast', perMin(30), async (req) => {
        const b = (req.body ?? {}) as any;
        if (!b.txHex || typeof b.txHex !== 'string') {
            throw new HttpError(400, 'Missing or invalid txHex string');
        }
        return service.broadcast(b.txHex);
    });

    // ── admin ──
    app.register(async (admin) => {
        admin.addHook('onRequest', requireAdmin);

        admin.get('/admin/lendbch/overview', async () => {
            const market = await service.market();
            return {
                market,
                selfCheck: service.getSelfCheck(),
                trackedLoanCount: service.getTrackedLoans().length,
                deployment: {
                    id: params.id,
                    network: params.network,
                    contracts: service.deployment.contracts,
                    priceVariants: service.deployment.priceVariants.map(v => ({ name: v.name, address: v.address })),
                },
            };
        });

        admin.get('/admin/lendbch/loans', async () => service.getTrackedLoans());

        admin.get('/admin/lendbch/loans/:id', async (req) => {
            const p = req.params as { id: string };
            const loan = service.getTrackedLoan(p.id);
            if (!loan) throw new HttpError(404, 'Tracked loan not found');
            return loan;
        });

        admin.post('/admin/lendbch/selfcheck', async () => service.selfCheck());

        admin.get('/admin/lendbch/settings', async () => settings.get());

        admin.post('/admin/lendbch/settings', async (req) => {
            let changed: string[];
            try { changed = settings.patch((req.body ?? {}) as Record<string, unknown>); } catch (e) { throw new HttpError(400, (e as Error).message); }
            if (changed.length) opts.events?.record({ section: 'lendbch', type: 'admin.settings', severity: 'info', summary: `lendbch settings changed: ${changed.join(', ')}`, subject: { kind: 'settings', id: 'lendbch' }, data: settings.get() as unknown as Record<string, unknown> });
            return { changed, settings: settings.get() };
        });
    });

    const pollSec = opts.pollSec ?? 60;
    const timer = pollSec > 0 ? setInterval(() => {
        service.selfCheck().catch(() => {});
        service.pollHealth().catch(() => {});
    }, pollSec * 1000) : null;
    timer?.unref?.();

    return {
        service, settings, loanStore,
        publicConfig: () => service.publicConfig(),
        stop: () => { if (timer) clearInterval(timer); },
    };
}
