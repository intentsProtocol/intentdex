/**
 * InventoryConfig — solver inventory strategy and per-network fill whitelist.
 *
 * Primary inventory is always BCH. This module governs:
 *   1. Which tokens the solver will fill intents for (whitelist).
 *   2. Whether token holdings can be used for INVENTORY_TO_TOKEN fills
 *      when the solver happens to accumulate tokens from prior fills.
 *
 * ── Whitelist resolution, per network ────────────────────────────────────────
 * Highest precedence first:
 *
 *   1. TOKEN_CONFIG_FILE_{MAINNET,CHIPNET}   JSON: { allow?, deny?, perToken? }
 *   2. FILL_TOKEN_WHITELIST_{MAINNET,CHIPNET}  comma-separated category hex
 *   3. FILL_TOKEN_WHITELIST                  DEPRECATED — network-blind
 *   4. derived from live Cauldron pools with TVL ≥ MIN_POOL_TVL_SATS  ← default
 *
 * Deriving (4) is the intended default. It is self-updating and degrades safely:
 * no pool means no route means nothing to whitelist. A hand-maintained list rots
 * instead — a category with no pool at all can sit "whitelisted" forever while
 * being permanently unfillable, which is exactly the state this replaced.
 *
 * `deny` always wins over `allow`, so a single bad token can be killed without
 * rewriting the list.
 *
 * ── Why not just .env? ───────────────────────────────────────────────────────
 * `FILL_TOKEN_WHITELIST` is network-BLIND: one list gated both mainnet and
 * chipnet. Populated with chipnet categories — as it was — a mainnet relayer
 * matches nothing and fills zero orders. It is still honoured for compatibility
 * but warns on load. Prefer the per-network file: it scopes correctly, carries
 * `perToken` policy overrides alongside the list, is reviewable in a diff, and
 * can be changed without a redeploy. Env is for secrets and deploy wiring; this
 * is policy.
 */

import * as fs from 'fs';
import { ENV } from '../config.js';

export type Network = 'mainnet' | 'chipnet';

/** Shape of a TOKEN_CONFIG_FILE_* JSON document. */
export interface TokenConfigFile {
    /** Explicit allow-list. When present, derivation is skipped entirely. */
    allow?: string[];
    /** Always rejected, even if also present in `allow` or derived from pools. */
    deny?: string[];
    /** Per-token policy overrides, same shape ProfitPolicy.perToken accepts. */
    perToken?: Record<string, unknown>;
}

export interface InventoryConfig {
    /** Token category hex IDs the bot will fill intents for. null = allow all. */
    whitelist: Set<string> | null;
    /** Categories explicitly denied; checked before the whitelist. */
    denylist: Set<string>;
    /**
     * Token IDs the solver may use as supply in a Cauldron pre-fill swap when the
     * solver holds those tokens. Empty = only use BCH (no INVENTORY_TO_TOKEN routes).
     */
    inventoryTokenIds: Set<string>;
    /** Where the whitelist came from — surfaced in logs and /router/status. */
    source: 'file' | 'env-network' | 'env-legacy' | 'derived' | 'unrestricted';
    /** Per-token overrides read from the config file, if any. */
    perToken?: Record<string, unknown>;
}

/**
 * Where whitelist inputs come from. Defaults to `ENV`, but injectable so the
 * resolution rules can be tested without mutating process.env — `config.ts`
 * snapshots the environment at import time and dotenv repopulates it from the
 * real `.env`, so env juggling in tests is not reliable.
 */
export interface WhitelistSources {
    configFileMainnet?: string;
    configFileChipnet?: string;
    envListMainnet?: string;
    envListChipnet?: string;
    /** Deprecated network-blind list; only honoured for `defaultNetwork`. */
    envListLegacy?: string;
    /** Which network the legacy list is understood to describe. */
    defaultNetwork?: Network;
    inventoryTokenIds?: string;
}

function sourcesFromEnv(): WhitelistSources {
    return {
        configFileMainnet: ENV.TOKEN_CONFIG_FILE_MAINNET,
        configFileChipnet: ENV.TOKEN_CONFIG_FILE_CHIPNET,
        envListMainnet:    ENV.FILL_TOKEN_WHITELIST_MAINNET,
        envListChipnet:    ENV.FILL_TOKEN_WHITELIST_CHIPNET,
        envListLegacy:     ENV.FILL_TOKEN_WHITELIST,
        defaultNetwork:    ENV.NETWORK === 'mainnet' ? 'mainnet' : 'chipnet',
        inventoryTokenIds: ENV.INVENTORY_TOKEN_IDS,
    };
}

const splitList = (v?: string): string[] =>
    (v ?? '').split(',').map(s => s.trim().replace(/^0x/, '')).filter(Boolean);

let warnedLegacy = false;

/** Test-only: allow the one-shot legacy warning to fire again. */
export function resetLegacyWarning(): void { warnedLegacy = false; }

function readConfigFile(path: string): TokenConfigFile | null {
    try {
        if (!fs.existsSync(path)) return null;
        return JSON.parse(fs.readFileSync(path, 'utf8')) as TokenConfigFile;
    } catch (e: any) {
        console.warn(`[InventoryConfig] failed to parse ${path}: ${e.message}; ignoring`);
        return null;
    }
}

/**
 * Build the inventory config for one network.
 *
 * @param network        which chain this config gates — REQUIRED, because a
 *                       mainnet relayer must never inherit chipnet categories.
 * @param poolTokenIds   token IDs eligible from live pools. Pass the TVL-filtered
 *                       list from `CauldronPoolCache.getTokensWithPoolsAboveTvl()`.
 * @param heldTokenIds   token IDs currently in the solver wallet (seeds
 *                       inventoryTokenIds).
 */
export function buildInventoryConfig(
    network: Network,
    poolTokenIds: string[],
    heldTokenIds: string[] = [],
    sources: WhitelistSources = sourcesFromEnv(),
): InventoryConfig {
    const isMainnet = network === 'mainnet';

    const filePath = isMainnet ? sources.configFileMainnet : sources.configFileChipnet;
    const fileCfg = filePath ? readConfigFile(filePath) : null;

    const envNetworkList = splitList(isMainnet
        ? sources.envListMainnet
        : sources.envListChipnet);

    // The legacy list is network-blind, which is precisely the mainnet blocker: a
    // list of chipnet categories applied to mainnet matches nothing, so a mainnet
    // relayer fills zero orders. Rather than propagate that, scope it to the
    // network the operator actually configured (ENV.NETWORK) and let the other
    // network fall through to derivation — which degrades safely.
    const legacyAppliesHere = (sources.defaultNetwork ?? 'chipnet') === network;
    const envLegacyList = legacyAppliesHere ? splitList(sources.envListLegacy) : [];

    const denylist = new Set((fileCfg?.deny ?? []).map(s => s.replace(/^0x/, '')));

    let whitelist: Set<string> | null;
    let source: InventoryConfig['source'];

    if (fileCfg?.allow?.length) {
        whitelist = new Set(fileCfg.allow.map(s => s.replace(/^0x/, '')));
        source = 'file';
    } else if (envNetworkList.length) {
        whitelist = new Set(envNetworkList);
        source = 'env-network';
    } else if (envLegacyList.length) {
        whitelist = new Set(envLegacyList);
        source = 'env-legacy';
        if (!warnedLegacy) {
            warnedLegacy = true;
            console.warn(
                `[InventoryConfig] FILL_TOKEN_WHITELIST is DEPRECATED (network-blind). Applying its ` +
                `${envLegacyList.length} categor${envLegacyList.length === 1 ? 'y' : 'ies'} to '${network}' ` +
                `only, since that is NETWORK; other networks derive from pool TVL instead. ` +
                `Migrate to FILL_TOKEN_WHITELIST_${isMainnet ? 'MAINNET' : 'CHIPNET'} or ` +
                `TOKEN_CONFIG_FILE_${isMainnet ? 'MAINNET' : 'CHIPNET'}.`,
            );
        }
    } else if (poolTokenIds.length > 0) {
        whitelist = new Set(poolTokenIds.map(s => s.replace(/^0x/, '')));
        source = 'derived';
    } else {
        // No list and no pool data yet (cold cache) — allow all rather than block
        // every fill during startup. ProfitPolicy still gates on actual economics.
        whitelist = null;
        source = 'unrestricted';
    }

    const envInventoryTokens = splitList(sources.inventoryTokenIds);
    const inventoryTokenIds = new Set(
        envInventoryTokens.length ? envInventoryTokens : heldTokenIds.map(s => s.replace(/^0x/, '')),
    );

    return { whitelist, denylist, inventoryTokenIds, source, perToken: fileCfg?.perToken };
}

/** Returns true if the bot should attempt to fill an intent for this token. */
export function isWhitelisted(tokenId: string, config: InventoryConfig): boolean {
    const id = tokenId.replace(/^0x/, '');
    if (config.denylist.has(id)) return false;
    if (!config.whitelist) return true;
    return config.whitelist.has(id);
}

/**
 * Returns true if the solver should consider using `tokenId` as supply
 * in a Cauldron pre-fill swap (INVENTORY_TO_TOKEN route).
 */
export function isInventoryToken(tokenId: string, config: InventoryConfig): boolean {
    return config.inventoryTokenIds.has(tokenId.replace(/^0x/, ''));
}

/** One-line summary for startup logs / diagnostics. */
export function describeInventoryConfig(network: Network, config: InventoryConfig): string {
    const n = config.whitelist ? config.whitelist.size : '∞';
    const d = config.denylist.size ? `, ${config.denylist.size} denied` : '';
    return `[InventoryConfig] ${network}: ${n} fillable token(s) via '${config.source}'${d}`;
}
