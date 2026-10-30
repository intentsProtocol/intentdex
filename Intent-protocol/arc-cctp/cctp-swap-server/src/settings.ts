/**
 * settings.ts — what an admin can change while the server runs, for both products.
 *
 * Defaults come from config (env). Changes are saved to data/settings.json and survive restarts, so a pause
 * set during an incident is still in force after a redeploy. Secrets and addresses are not settings: keys,
 * RPC URLs and the Jupiter referral account stay in env.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PublicKey } from '@solana/web3.js';
import { config } from './config.js';
import { HttpError } from './types.js';

export interface CctpSettings {
    paused: boolean;             // no new transfers; transfers in flight keep being relayed
    pauseReason?: string;
    relayEnabled: boolean;       // false: attested transfers wait (the user can still self-mint)
    fastEnabled: boolean;        // false: every transfer uses Standard finality
    minTransferUsdc: number;
    maxTransferUsdc: number;
    feeBufferPct: number;        // maxFee = expected fee + this
    disabledChains: string[];    // chain keys closed as source and destination
    disabledRoutes: string[];    // 'src>dst'
    // our margin: a USDC transfer to the treasury on the source chain, next to the burn
    feeBps: number;              // share of the amount sent; 0 = none
    feeMinUsdc: number;          // floor on the bps part; 0 = none
    feeMaxUsdc: number;          // cap on the bps part; 0 = none
    gasFeeUsdc: Record<string, number>;  // flat charge per destination chain, to recover the relayer's mint gas
    feeEnforced: boolean;        // true: no relay until the fee is seen on chain (the user can still self-mint)
}

export interface SolanaSettings {
    paused: boolean;             // no new swaps; a swap already signed can still execute
    pauseReason?: string;
    stocksEnabled: boolean;      // tokenized stocks listed and swappable
    allowUnverified: boolean;    // tokens outside Jupiter's verified list swappable
    maxSlippageBps: number;      // highest slippage a client may ask for
    defaultSlippageBps: number;  // used when the client sends none; 0 = let Jupiter estimate
    maxSwapUsd: number;          // 0 = no limit
    minStockLiquidityUsd: number;// stocks below this are hidden from /solana/stocks
    referralFeeBps: number;      // 0 = off, else 50-255; needs a referral account
    stocksFeeBps: number | null; // fee when either side is a tokenized stock; null = same as referralFeeBps
    stablesFeeBps: number | null;// fee for stable-to-stable pairs; null = same as referralFeeBps
    referralAccount: string;     // Jupiter referral account (public key); '' = use JUPITER_REFERRAL_ACCOUNT from env
    blockedMints: string[];
}

export interface BchSettings {
    enabled: boolean;
    paused: boolean;
    pauseReason?: string;
    feeBps: number;              // 0-1000 bps (0 = no fee, 25 = 0.25%, 50 = 0.50%)
    feeRecipientNear: string;    // NEAR account to receive appFees
    minSwapUsd: number;
    maxSwapUsd: number;
}

export interface AllSettings { cctp: CctpSettings; solana: SolanaSettings; bch: BchSettings; updatedAt: number }

function defaults(): AllSettings {
    return {
        cctp: {
            paused: false, relayEnabled: true, fastEnabled: true,
            minTransferUsdc: config.limits.minTransferUsdc, maxTransferUsdc: config.limits.maxTransferUsdc,
            feeBufferPct: config.quote.feeBufferPct, disabledChains: [], disabledRoutes: [],
            feeBps: 0, feeMinUsdc: 0, feeMaxUsdc: 0, gasFeeUsdc: {}, feeEnforced: true,
        },
        solana: {
            paused: false, stocksEnabled: true, allowUnverified: true,
            maxSlippageBps: config.jupiter.maxSlippageBps, defaultSlippageBps: 0, maxSwapUsd: 0, minStockLiquidityUsd: 0,
            referralFeeBps: config.jupiter.referralAccount ? config.jupiter.referralFeeBps : 0, stocksFeeBps: null, stablesFeeBps: null,
            referralAccount: '', blockedMints: [],
        },
        bch: {
            enabled: config.bch.enabled,
            paused: false,
            feeBps: config.bch.defaultFeeBps,
            feeRecipientNear: config.bch.feeRecipientNear,
            minSwapUsd: config.bch.minSwapUsd,
            maxSwapUsd: config.bch.maxSwapUsd,
        },
        updatedAt: 0,
    };
}

const bool = (k: string, v: unknown): boolean => { if (typeof v !== 'boolean') throw new HttpError(400, `${k} must be true or false`); return v; };
const numIn = (k: string, v: unknown, min: number, max: number, int = false): number => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) {
        throw new HttpError(400, `${k} must be ${int ? 'an integer' : 'a number'} from ${min} to ${max}`);
    }
    return v;
};
const strList = (k: string, v: unknown, ok: (s: string) => boolean): string[] => {
    if (!Array.isArray(v) || v.some(s => typeof s !== 'string' || !ok(s))) throw new HttpError(400, `${k} has an invalid entry`);
    return [...new Set(v as string[])];
};
const reason = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined);
const isMint = (s: string) => { try { return new PublicKey(s).toBase58() === s; } catch { return false; } };
/** Jupiter accepts a referral fee of 50-255 bps; 0 means no fee. */
const referralBps = (k: string, v: unknown): number => {
    const n = numIn(k, v, 0, 255, true);
    if (n !== 0 && n < 50) throw new HttpError(400, `${k} must be 0 (off) or 50-255 (Jupiter's range)`);
    return n;
};

export class Settings {
    private state: AllSettings;
    private file: string;

    constructor(dataDir: string, private chainKeys: string[] = config.chains.map(c => c.key)) {
        fs.mkdirSync(dataDir, { recursive: true });
        this.file = path.join(dataDir, 'settings.json');
        const d = defaults();
        let saved: Partial<AllSettings> = {};
        if (fs.existsSync(this.file)) { try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* unreadable: start from defaults */ } }
        this.state = { cctp: { ...d.cctp, ...saved.cctp }, solana: { ...d.solana, ...saved.solana }, bch: { ...d.bch, ...saved.bch }, updatedAt: saved.updatedAt ?? 0 };
    }

    get cctp(): CctpSettings { return this.state.cctp; }
    get solana(): SolanaSettings { return this.state.solana; }
    get bch(): BchSettings { return this.state.bch; }
    all(): AllSettings { return structuredClone(this.state); }

    private save() {
        this.state.updatedAt = Date.now();
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
        fs.renameSync(tmp, this.file);
    }

    /** Validate and apply a partial change. Returns the names of the fields that changed. */
    patch(p: { cctp?: Record<string, unknown>; solana?: Record<string, unknown>; bch?: Record<string, unknown> }): string[] {
        const c: Partial<CctpSettings> = {};
        const s: Partial<SolanaSettings> = {};
        const b: Partial<BchSettings> = {};
        for (const [k, v] of Object.entries(p.cctp ?? {})) {
            switch (k) {
                case 'paused': c.paused = bool(k, v); break;
                case 'pauseReason': c.pauseReason = reason(v); break;
                case 'relayEnabled': c.relayEnabled = bool(k, v); break;
                case 'fastEnabled': c.fastEnabled = bool(k, v); break;
                case 'minTransferUsdc': c.minTransferUsdc = numIn(k, v, 0.01, 1_000_000); break;
                case 'maxTransferUsdc': c.maxTransferUsdc = numIn(k, v, 0.01, 10_000_000); break;
                case 'feeBufferPct': c.feeBufferPct = numIn(k, v, 0, 500); break;
                case 'disabledChains': c.disabledChains = strList(k, v, x => this.chainKeys.includes(x)); break;
                case 'disabledRoutes': c.disabledRoutes = strList(k, v, x => { const [a, b, extra] = x.split('>'); return !extra && a !== b && this.chainKeys.includes(a) && this.chainKeys.includes(b); }); break;
                case 'feeBps': c.feeBps = numIn(k, v, 0, 1000); break;
                case 'feeMinUsdc': c.feeMinUsdc = numIn(k, v, 0, 10_000); break;
                case 'feeMaxUsdc': c.feeMaxUsdc = numIn(k, v, 0, 1_000_000); break;
                case 'gasFeeUsdc': {
                    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'gasFeeUsdc must be an object of chain → USDC');
                    const out: Record<string, number> = {};
                    for (const [ck, cv] of Object.entries(v as Record<string, unknown>)) {
                        if (!this.chainKeys.includes(ck)) throw new HttpError(400, `gasFeeUsdc: unknown chain '${ck}'`);
                        const n = numIn(`gasFeeUsdc.${ck}`, cv, 0, 1000);
                        if (n > 0) out[ck] = n;
                    }
                    c.gasFeeUsdc = out;
                    break;
                }
                case 'feeEnforced': c.feeEnforced = bool(k, v); break;
                default: throw new HttpError(400, `unknown cctp setting '${k}'`);
            }
        }
        for (const [k, v] of Object.entries(p.solana ?? {})) {
            switch (k) {
                case 'paused': s.paused = bool(k, v); break;
                case 'pauseReason': s.pauseReason = reason(v); break;
                case 'stocksEnabled': s.stocksEnabled = bool(k, v); break;
                case 'allowUnverified': s.allowUnverified = bool(k, v); break;
                case 'maxSlippageBps': s.maxSlippageBps = numIn(k, v, 1, 10_000, true); break;
                case 'defaultSlippageBps': s.defaultSlippageBps = numIn(k, v, 0, 10_000, true); break;
                case 'maxSwapUsd': s.maxSwapUsd = numIn(k, v, 0, 100_000_000); break;
                case 'minStockLiquidityUsd': s.minStockLiquidityUsd = numIn(k, v, 0, 1_000_000_000); break;
                case 'referralFeeBps': s.referralFeeBps = referralBps(k, v); break;
                case 'stocksFeeBps': s.stocksFeeBps = v === null ? null : referralBps(k, v); break;
                case 'stablesFeeBps': s.stablesFeeBps = v === null ? null : referralBps(k, v); break;
                case 'referralAccount':
                    if (v !== '' && !isMint(v as string)) throw new HttpError(400, 'referralAccount must be a Solana address or empty');
                    s.referralAccount = v as string;
                    break;
                case 'blockedMints': s.blockedMints = strList(k, v, isMint); break;
                default: throw new HttpError(400, `unknown solana setting '${k}'`);
            }
        }
        for (const [k, v] of Object.entries(p.bch ?? {})) {
            switch (k) {
                case 'enabled': b.enabled = bool(k, v); break;
                case 'paused': b.paused = bool(k, v); break;
                case 'pauseReason': b.pauseReason = reason(v); break;
                case 'feeBps': b.feeBps = numIn(k, v, 0, 1000, true); break;
                case 'feeRecipientNear':
                    if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, 'feeRecipientNear must be a valid NEAR account ID');
                    b.feeRecipientNear = v.trim();
                    break;
                case 'minSwapUsd': b.minSwapUsd = numIn(k, v, 1, 100_000); break;
                case 'maxSwapUsd': b.maxSwapUsd = numIn(k, v, 1, 1_000_000); break;
                default: throw new HttpError(400, `unknown bch setting '${k}'`);
            }
        }
        const nextC = { ...this.state.cctp, ...c }, nextS = { ...this.state.solana, ...s }, nextB = { ...this.state.bch, ...b };
        if (nextC.minTransferUsdc > nextC.maxTransferUsdc) throw new HttpError(400, 'minTransferUsdc is above maxTransferUsdc');
        if (nextS.defaultSlippageBps > nextS.maxSlippageBps) throw new HttpError(400, 'defaultSlippageBps is above maxSlippageBps');
        if (nextC.feeMaxUsdc > 0 && nextC.feeMinUsdc > nextC.feeMaxUsdc) throw new HttpError(400, 'feeMinUsdc is above feeMaxUsdc');
        if (nextB.minSwapUsd > nextB.maxSwapUsd) throw new HttpError(400, 'bch minSwapUsd is above maxSwapUsd');
        const hasReferral = !!(nextS.referralAccount || config.jupiter.referralAccount);
        if (!hasReferral && (nextS.referralFeeBps || nextS.stocksFeeBps || nextS.stablesFeeBps)) {
            throw new HttpError(400, 'set a Jupiter referral account (settings or JUPITER_REFERRAL_ACCOUNT) before turning a Solana fee on');
        }
        if (!nextC.paused) nextC.pauseReason = undefined;
        if (!nextS.paused) nextS.pauseReason = undefined;
        if (!nextB.paused) nextB.pauseReason = undefined;

        const changed: string[] = [];
        for (const k of Object.keys(c) as (keyof CctpSettings)[]) if (JSON.stringify(this.state.cctp[k]) !== JSON.stringify(nextC[k])) changed.push(`cctp.${k}`);
        for (const k of Object.keys(s) as (keyof SolanaSettings)[]) if (JSON.stringify(this.state.solana[k]) !== JSON.stringify(nextS[k])) changed.push(`solana.${k}`);
        for (const k of Object.keys(b) as (keyof BchSettings)[]) if (JSON.stringify(this.state.bch[k]) !== JSON.stringify(nextB[k])) changed.push(`bch.${k}`);
        if (changed.length) { this.state.cctp = nextC; this.state.solana = nextS; this.state.bch = nextB; this.save(); }
        return changed;
    }

    /** Back to the env defaults for one product. */
    reset(section: 'cctp' | 'solana' | 'bch') {
        const d = defaults();
        if (section === 'cctp') this.state.cctp = d.cctp;
        else if (section === 'solana') this.state.solana = d.solana;
        else if (section === 'bch') this.state.bch = d.bch;
        this.save();
    }

    /** The Jupiter referral account in force: the admin setting, else the env value, else none. */
    referralAccount(): string | undefined { return this.state.solana.referralAccount || config.jupiter.referralAccount || undefined; }

    // ── checks used by the public API ────────────────────────────────────────
    chainOpen(key: string): boolean { return !this.state.cctp.disabledChains.includes(key); }
    routeOpen(src: string, dst: string): boolean {
        return this.chainOpen(src) && this.chainOpen(dst) && !this.state.cctp.disabledRoutes.includes(`${src}>${dst}`);
    }
}
