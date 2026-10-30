/**
 * /admin/profits, /admin/treasury/*, /admin/solana/referral/* — what we earn, where it goes, and the Jupiter
 * referral account. Every route needs x-admin-key. Margins themselves are settings (POST /admin/settings).
 */
import type { FastifyInstance } from 'fastify';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { requireAdmin } from './admin.js';
import { enabledChains } from './config.js';
import { formatUsdc } from './cctp/encoding.js';
import type { ChainAdapter } from './chains/adapter.js';
import type { ReferralManager, ReferralStatus } from './jupiter/Referral.js';
import type { SwapStore } from './jupiter/SwapStore.js';
import type { TokenCatalog } from './jupiter/TokenCatalog.js';
import { errMsg } from './log.js';
import type { EventLog } from './ops/EventLog.js';
import { profitStats } from './ops/stats.js';
import type { Settings } from './settings.js';
import type { TransferStore } from './store/TransferStore.js';
import type { Treasury, TreasuryWallet } from './treasury/Treasury.js';
import type { BchSwapStore } from './bch/BchSwapStore.js';
import { HttpError } from './types.js';

export interface ProfitDeps {
    settings: Settings;
    events: EventLog;
    store: TransferStore;
    swapStore: SwapStore;
    bchStore?: BchSwapStore;
    adapters: Map<string, ChainAdapter>;
    treasury: Treasury;
    referral: ReferralManager;
    catalog: TokenCatalog;
    mainnet: Connection;
}

interface WalletBalance { chain: string; name: string; usdc?: string; native?: string; symbol?: string; error?: string }

export function registerProfitRoutes(app: FastifyInstance, d: ProfitDeps) {
    const { settings, events, store, swapStore, bchStore, adapters, treasury, referral, catalog, mainnet } = d;
    const cache = new Map<string, { at: number; value: unknown }>();
    async function cached<T>(key: string, ttlMs: number, fresh: boolean, load: () => Promise<T>): Promise<T> {
        const hit = cache.get(key);
        if (!fresh && hit && Date.now() - hit.at < ttlMs) return hit.value as T;
        const value = await load();
        cache.set(key, { at: Date.now(), value });
        return value;
    }

    /** What a treasury wallet holds: USDC on every chain of its kind, plus SOL on mainnet for a Solana wallet. */
    function balancesOf(w: TreasuryWallet, fresh = false): Promise<WalletBalance[]> {
        return cached(`bal:${w.id}`, 60_000, fresh, async () => {
            const out: WalletBalance[] = await Promise.all(enabledChains().filter(c => c.kind === w.kind).map(async (c): Promise<WalletBalance> => {
                try { return { chain: c.key, name: c.name, usdc: formatUsdc(await adapters.get(c.key)!.usdcBalance(w.address)) }; }
                catch (e) { return { chain: c.key, name: c.name, error: errMsg(e) }; }
            }));
            if (w.kind === 'solana') {
                try { out.push({ chain: 'solana-mainnet', name: 'Solana mainnet', native: ((await mainnet.getBalance(new PublicKey(w.address))) / 1e9).toFixed(4), symbol: 'SOL' }); }
                catch (e) { out.push({ chain: 'solana-mainnet', name: 'Solana mainnet', error: errMsg(e) }); }
            }
            return out;
        });
    }

    const referralStatus = (fresh = false): Promise<ReferralStatus> =>
        cached('referral', 60_000, fresh, () => referral.status(settings.referralAccount()));

    /** The key of the active Solana treasury wallet, when it was generated here. */
    function solanaSigner(): Keypair {
        const w = treasury.active('solana');
        if (!w) throw new HttpError(409, 'create or activate a Solana treasury wallet first');
        const secret = treasury.secretOf(w.address);
        if (!secret) throw new HttpError(409, 'the active Solana treasury wallet is external (watch-only): set the referral account up from that wallet at referral.jup.ag and paste its address in the settings');
        return Keypair.fromSecretKey(bs58.decode(secret));
    }

    const walletView = async (w: TreasuryWallet, fresh = false) => ({ ...w, hasKey: w.origin === 'generated', balances: await balancesOf(w, fresh) });

    app.register(async (admin) => {
        admin.addHook('onRequest', requireAdmin);

        admin.get('/admin/profits', async (req) => {
            const fresh = (req.query as Record<string, string>).fresh === '1';
            const s = settings.all();
            const wallets = treasury.list().filter(w => !w.archived);
            const allBch = bchStore ? bchStore.all() : [];
            const bchSuccess = allBch.filter(x => x.status === 'SUCCESS');
            const bchTotalVolume = allBch.reduce((acc, x) => acc + (x.amountInUsd || 0), 0);
            const bchTotalProfit = bchSuccess.reduce((acc, x) => acc + (x.ourFeeUsd || 0), 0);

            return {
                stats: profitStats(store.all(), swapStore.all(), Date.now()),
                bchStats: {
                    totalSwaps: allBch.length,
                    successfulSwaps: bchSuccess.length,
                    totalVolumeUsd: Math.round(bchTotalVolume * 100) / 100,
                    totalProfitUsd: Math.round(bchTotalProfit * 100) / 100,
                },
                margins: {
                    cctp: { feeBps: s.cctp.feeBps, feeMinUsdc: s.cctp.feeMinUsdc, feeMaxUsdc: s.cctp.feeMaxUsdc, gasFeeUsdc: s.cctp.gasFeeUsdc, feeEnforced: s.cctp.feeEnforced },
                    solana: { referralFeeBps: s.solana.referralFeeBps, stocksFeeBps: s.solana.stocksFeeBps, stablesFeeBps: s.solana.stablesFeeBps, referralAccount: settings.referralAccount() ?? null },
                    bch: { feeBps: s.bch.feeBps, feeRecipientNear: s.bch.feeRecipientNear, minSwapUsd: s.bch.minSwapUsd, maxSwapUsd: s.bch.maxSwapUsd },
                },
                collecting: {
                    evm: !!treasury.active('evm') && (s.cctp.feeBps > 0 || s.cctp.feeMinUsdc > 0 || Object.keys(s.cctp.gasFeeUsdc).length > 0),
                    solanaCctp: !!treasury.active('solana') && (s.cctp.feeBps > 0 || s.cctp.feeMinUsdc > 0 || Object.keys(s.cctp.gasFeeUsdc).length > 0),
                    jupiter: !!settings.referralAccount() && (s.solana.referralFeeBps > 0 || !!s.solana.stocksFeeBps || !!s.solana.stablesFeeBps),
                    bch: s.bch.feeBps > 0 && !!s.bch.feeRecipientNear,
                },
                treasury: await Promise.all(wallets.map(w => walletView(w, fresh))),
                referral: await referralStatus(fresh).catch(e => ({ exists: false, tokenAccounts: [], error: errMsg(e) })),
                history: events.query({ type: 'fee.', limit: 20 }).events,
            };
        });

        // ── treasury wallets ──────────────────────────────────────────────────
        admin.get('/admin/treasury', async (req) => {
            const fresh = (req.query as Record<string, string>).fresh === '1';
            return { wallets: await Promise.all(treasury.list().map(w => walletView(w, fresh))) };
        });

        admin.post('/admin/treasury/wallets', async (req, reply) => {
            const b = (req.body ?? {}) as Record<string, unknown>;
            if (b.kind !== 'evm' && b.kind !== 'solana') throw new HttpError(400, "kind must be 'evm' or 'solana'");
            const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim() : undefined;
            const w = b.address ? treasury.addExternal(b.kind, b.address, label) : treasury.generate(b.kind, label);
            events.record({ section: 'system', type: 'treasury.created', severity: 'info', summary: `Treasury wallet ${w.origin === 'generated' ? 'generated' : 'added'}: ${w.label} (${w.kind}) ${w.address}${w.active ? ', now active' : ''}` });
            // A Solana treasury needs a USDC token account before it can be paid; the relayer creates it.
            if (w.kind === 'solana') {
                for (const c of enabledChains().filter(x => x.kind === 'solana')) {
                    await adapters.get(c.key)?.ensureUsdcAccount?.(w.address).catch(e => events.record({ section: 'system', type: 'treasury.account_failed', severity: 'warn', summary: `Could not create the USDC account for ${w.address} on ${c.name}: ${errMsg(e)}` }));
                }
            }
            return reply.status(201).send({ wallet: await walletView(w, true) });
        });

        admin.post('/admin/treasury/wallets/:id/activate', async (req) => {
            const w = treasury.activate((req.params as { id: string }).id);
            events.record({ section: 'system', type: 'treasury.activated', severity: 'warn', summary: `Fees for ${w.kind === 'evm' ? 'EVM chains' : 'Solana'} now go to ${w.label} ${w.address}` });
            return { wallet: await walletView(w) };
        });

        admin.post('/admin/treasury/wallets/:id/archive', async (req) => {
            const w = treasury.archive((req.params as { id: string }).id);
            events.record({ section: 'system', type: 'treasury.archived', severity: 'info', summary: `Treasury wallet archived: ${w.label} ${w.address}` });
            return { wallet: w };
        });

        // ── Jupiter referral account ──────────────────────────────────────────
        admin.get('/admin/solana/referral', async (req) => ({
            ...(await referralStatus((req.query as Record<string, string>).fresh === '1')),
            feeMints: referral.feeMints(),
            signer: (() => { const w = treasury.active('solana'); return w ? { address: w.address, hasKey: w.origin === 'generated' } : null; })(),
        }));

        /** Create the referral account from the Solana treasury wallet, with token accounts for SOL, USDC and USDT. */
        admin.post('/admin/solana/referral/create', async (req) => {
            const name = String(((req.body ?? {}) as Record<string, unknown>).name ?? '').trim();
            if (settings.referralAccount()) throw new HttpError(409, `a referral account is already set: ${settings.referralAccount()}`);
            const signer = solanaSigner();
            const { account, signature } = await referral.create(name, signer);
            settings.patch({ solana: { referralAccount: account } });
            events.record({ section: 'solana', type: 'referral.created', severity: 'success', summary: `Jupiter referral account created: ${account}`, data: { signature, partner: signer.publicKey.toBase58() } });
            const tokenAccounts = [];
            for (const m of referral.feeMints()) {
                try { tokenAccounts.push({ mint: m.mint, symbol: m.symbol, ...(await referral.addTokenAccount(account, m.mint, signer)) }); }
                catch (e) { tokenAccounts.push({ mint: m.mint, symbol: m.symbol, error: errMsg(e) }); }
            }
            return { account, signature, tokenAccounts, status: await referralStatus(true) };
        });

        admin.post('/admin/solana/referral/token-accounts', async (req) => {
            const account = settings.referralAccount();
            if (!account) throw new HttpError(409, 'no referral account is set');
            const b = (req.body ?? {}) as Record<string, unknown>;
            const signer = solanaSigner();
            let mints = referral.feeMints().map(m => m.mint);
            if (typeof b.mint === 'string' && b.mint) {
                try { new PublicKey(b.mint); } catch { throw new HttpError(400, 'mint is not a valid Solana address'); }
                mints = [b.mint];
            }
            const out = [];
            for (const mint of mints) out.push({ mint, symbol: catalog.cached(mint)?.symbol, ...(await referral.addTokenAccount(account, mint, signer)) });
            events.record({ section: 'solana', type: 'referral.token_accounts', severity: 'info', summary: `Referral fee accounts ready for ${out.map(o => o.symbol ?? o.mint.slice(0, 6)).join(', ')}` });
            return { tokenAccounts: out, status: await referralStatus(true) };
        });

        admin.post('/admin/solana/referral/claim', async () => {
            const account = settings.referralAccount();
            if (!account) throw new HttpError(409, 'no referral account is set');
            const signatures = await referral.claimAll(account, solanaSigner());
            events.record({ section: 'solana', type: 'fee.claimed', severity: 'success', summary: `Referral fees claimed to the treasury in ${signatures.length} transaction(s)`, data: { signatures } });
            return { signatures, status: await referralStatus(true) };
        });
    });
}
