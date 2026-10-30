/**
 * /lend/* — borrowing against collateral, through the lending protocol. /admin/lend/* — the operator's view.
 *
 * One call wires the module: `registerLend(app, { dataDir, events })`. It is enabled by LEND_ENABLED=true and
 * only makes sense on the mainnet instance, because the protocol has no testnet.
 */
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../admin.js';
import { HttpError } from '../types.js';
import type { EventLog } from '../ops/EventLog.js';
import { LendService } from './LendService.js';
import { LendSettingsStore, LoanStore } from './LoanStore.js';
import { ProfileStore } from './ProfileStore.js';
import { OPEN_PHASES, type CreateLoanBody, type LendProtocol } from './types.js';

export interface LendModule {
    service: LendService;
    store: LoanStore;
    profileStore: ProfileStore;
    settings: LendSettingsStore;
    /** What /config says about lending. */
    publicConfig(): { enabled: boolean; paused: boolean; pauseReason: string | null; provider: string };
    stop(): void;
}

export interface LendOptions {
    dataDir: string;
    events?: EventLog;
    /** The protocol client. Left out, the real one is loaded. */
    protocol?: LendProtocol;
    profileStore?: ProfileStore;
    /** Seconds between refreshes of open loans. 0 turns the timer off (tests). */
    pollSec?: number;
}

export async function registerLend(app: FastifyInstance, opts: LendOptions): Promise<LendModule> {
    // Loaded here, not at the top: a server with lending off never loads the protocol's SDK.
    const protocol = opts.protocol ?? new (await import('./LiquidiumClient.js')).LiquidiumClient();
    const store = new LoanStore(opts.dataDir);
    const profileStore = opts.profileStore ?? new ProfileStore(opts.dataDir);
    const settings = new LendSettingsStore(opts.dataDir);
    const service = new LendService({ protocol, store, profileStore, settings, events: opts.events });
    const perMin = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

    app.get('/lend/markets', perMin(120), async () => service.markets());

    app.post('/lend/quote', perMin(120), async (req) => service.quote((req.body ?? {}) as CreateLoanBody));

    app.post('/lend/loans', perMin(10), async (req, reply) => {
        const loan = await service.create((req.body ?? {}) as CreateLoanBody);
        reply.status(201);
        return loan;
    });

    app.get('/lend/loans/:ref', perMin(120), async (req) => service.get((req.params as { ref: string }).ref));

    /** Ask the protocol now, instead of waiting for the next refresh. */
    app.post('/lend/loans/:ref/refresh', perMin(30), async (req) => service.get((req.params as { ref: string }).ref, true));

    /** Loans of an address, or the loan with this ID. */
    app.get('/lend/loans', perMin(30), async (req) => {
        const q = req.query as Record<string, string>;
        return { loans: await service.find(q.address ?? q.q ?? '') };
    });

    // ── Advanced Mode: Account, Portfolio, Borrow, Withdraw, Supply ──

    app.get('/lend/account/resolve/:address', perMin(60), async (req) => {
        return service.resolveProfile((req.params as { address: string }).address);
    });

    app.post('/lend/account/prepare-create', perMin(30), async (req) => {
        return service.prepareCreateProfile((req.body ?? {}) as any);
    });

    app.post('/lend/account/create', perMin(10), async (req, reply) => {
        const out = await service.createProfile((req.body ?? {}) as any);
        reply.status(201);
        return out;
    });

    app.get('/lend/account/:profileId/portfolio', perMin(120), async (req) => {
        return service.portfolio((req.params as { profileId: string }).profileId);
    });

    app.post('/lend/account/prepare-borrow', perMin(30), async (req) => {
        return service.prepareBorrow((req.body ?? {}) as any);
    });

    app.post('/lend/account/submit-borrow', perMin(15), async (req) => {
        return service.submitBorrow((req.body ?? {}) as any);
    });

    app.post('/lend/account/prepare-withdraw', perMin(30), async (req) => {
        return service.prepareWithdraw((req.body ?? {}) as any);
    });

    app.post('/lend/account/submit-withdraw', perMin(15), async (req) => {
        return service.submitWithdraw((req.body ?? {}) as any);
    });

    app.post('/lend/account/supply-target', perMin(60), async (req) => {
        return service.supplyTarget((req.body ?? {}) as any);
    });

    app.post('/lend/account/submit-inflow', perMin(30), async (req) => {
        return service.submitInflow((req.body ?? {}) as any);
    });

    // ── admin ──
    app.register(async (admin) => {
        admin.addHook('onRequest', requireAdmin);

        admin.get('/admin/lend/overview', async () => service.overview());

        admin.get('/admin/lend/loans', async (req) => {
            const q = req.query as Record<string, string>;
            const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
            const offset = Math.max(Number(q.offset) || 0, 0);
            const needle = (q.q ?? '').trim().toLowerCase();
            let list = store.all();
            if (q.phase === 'open') list = list.filter(l => OPEN_PHASES.includes(l.view.phase));
            else if (q.phase) list = list.filter(l => l.view.phase === q.phase);
            if (needle) list = list.filter(l => l.ref.toLowerCase().includes(needle) || l.addresses.some(a => a.toLowerCase().includes(needle)));
            return { total: list.length, offset, limit, loans: list.slice(offset, offset + limit).map(l => l.view) };
        });

        admin.get('/admin/lend/loans/:ref', async (req) => {
            const record = store.get((req.params as { ref: string }).ref);
            if (!record) throw new HttpError(404, 'loan not found');
            return record;
        });

        admin.post('/admin/lend/loans/:ref/refresh', async (req) => {
            const { ref } = req.params as { ref: string };
            await service.get(ref, true);
            return store.get(ref);
        });

        admin.get('/admin/lend/settings', async () => settings.get());

        admin.post('/admin/lend/settings', async (req) => {
            let changed: string[];
            try { changed = settings.patch((req.body ?? {}) as Record<string, unknown>); } catch (e) { throw new HttpError(400, (e as Error).message); }
            if (changed.length) opts.events?.record({ section: 'lend', type: 'admin.settings', severity: 'info', summary: `Lend settings changed: ${changed.join(', ')}`, subject: { kind: 'settings', id: 'lend' }, data: settings.get() as unknown as Record<string, unknown> });
            return { changed, settings: settings.get() };
        });

        admin.get('/admin/lend/users', async (req) => {
            const q = req.query as Record<string, string>;
            return service.adminUsers({
                q: q.q,
                limit: Number(q.limit) || 50,
                offset: Number(q.offset) || 0,
            });
        });

        admin.get('/admin/lend/users/:profileId', async (req) => {
            const { profileId } = req.params as { profileId: string };
            return service.adminUserDetail(profileId);
        });

        admin.post('/admin/lend/users/track', async (req) => {
            const body = (req.body ?? {}) as { addressOrProfileId?: string };
            return service.adminTrackUser(body.addressOrProfileId ?? '');
        });

        admin.post('/admin/lend/users/:profileId/notes', async (req) => {
            const { profileId } = req.params as { profileId: string };
            const body = (req.body ?? {}) as { notes?: string };
            return service.adminSetUserNotes(profileId, body.notes ?? '');
        });
    });

    const pollSec = opts.pollSec ?? 45;
    const timer = pollSec > 0 ? setInterval(() => { service.poll().catch(() => {}); }, pollSec * 1000) : null;
    timer?.unref?.();

    return {
        service, store, profileStore, settings,
        publicConfig: () => { const s = settings.get(); return { enabled: true, paused: s.paused, pauseReason: s.paused ? s.pauseReason || null : null, provider: 'liquidium' }; },
        stop: () => { if (timer) clearInterval(timer); },
    };
}
