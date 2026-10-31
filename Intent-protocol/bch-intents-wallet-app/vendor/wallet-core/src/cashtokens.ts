/**
 * CashToken metadata and the tradeable-token list.
 *
 * Metadata (name, symbol, decimals, icon) comes from the Paytaca BCMR indexer and is cached in
 * the host's store, since it almost never changes. The list of tokens that can be swapped comes from the
 * Cauldron indexer, because a token is only swappable where it has a pool.
 *
 * A category is always lower-case hex without a prefix here.
 */

import { storage } from './platform';

export type BchNet = 'chipnet' | 'mainnet';

export interface TokenMeta {
  category: string;
  symbol: string;
  name: string;
  decimals: number;
  icon?: string;
  /** False when no registry knows the token: the symbol is then a placeholder, not a claim. */
  known: boolean;
}

export interface TradeableToken extends TokenMeta {
  /** BCH satoshis per token base unit; 0 when the pool has no price. */
  priceSats: number;
  priceUsd: number;
  tvlSats: number;
  change24hPct?: number;
}

const BCMR_URL: Record<BchNet, string> = {
  mainnet: 'https://bcmr.paytaca.com',
  chipnet: 'https://bcmr-chipnet.paytaca.com',
};
const CAULDRON_URL: Record<BchNet, string> = {
  mainnet: 'https://indexer.riften.net/cauldron',
  chipnet: 'https://indexer-chipnet.riften.net/cauldron',
};

const CACHE_KEY = 'cashtoken_meta_v1';
const KNOWN_TTL_MS = 7 * 24 * 60 * 60_000;
const UNKNOWN_TTL_MS = 60 * 60_000;

export const normalizeCategory = (c: string) => (c.startsWith('0x') ? c.slice(2) : c).toLowerCase();

const SAFE_ICON = /^(https?:\/\/|ipfs:\/\/|data:image\/)/i;
/** Registries point at IPFS as often as HTTPS; a browser needs a gateway for the former. */
export function iconUrl(raw: string | undefined | null): string | undefined {
  if (!raw || !SAFE_ICON.test(raw)) return undefined;
  return raw.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${raw.slice(7)}` : raw;
}

const placeholder = (category: string): TokenMeta => ({
  category, symbol: `CT-${category.slice(0, 4).toUpperCase()}`, name: `CashToken ${category.slice(0, 8)}…`, decimals: 0, known: false,
});

async function getJson(url: string, timeoutMs = 8000): Promise<{ status: number; body: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    clearTimeout(timer);
  }
}

type Cache = Record<string, { meta: TokenMeta; at: number }>;
let memory: Cache | null = null;

async function loadCache(): Promise<Cache> {
  if (memory) return memory;
  try { memory = JSON.parse((await storage().getItem(CACHE_KEY)) ?? '{}') as Cache; } catch { memory = {}; }
  return memory!;
}

async function fetchMeta(category: string, net: BchNet): Promise<TokenMeta> {
  try {
    const { status, body } = await getJson(`${BCMR_URL[net]}/api/tokens/${category}/`);
    if (status === 200 && body?.token && !body.error) {
      const symbol = String(body.token.symbol ?? '').trim().slice(0, 32).toUpperCase();
      const decimals = Number(body.token.decimals ?? 0);
      if (symbol && Number.isInteger(decimals) && decimals >= 0 && decimals <= 18) {
        return { category, symbol, name: String(body.name ?? symbol).trim().slice(0, 128) || symbol, decimals, icon: iconUrl(body.uris?.icon), known: true };
      }
    }
  } catch { /* indexer unreachable: fall through to the placeholder */ }
  return placeholder(category);
}

/** Metadata for these categories, from cache where fresh. Never throws; an unknown token gets a placeholder. */
export async function getTokenMetas(categories: string[], net: BchNet): Promise<Record<string, TokenMeta>> {
  const cache = await loadCache();
  const out: Record<string, TokenMeta> = {};
  const missing: string[] = [];
  const now = Date.now();
  for (const raw of categories) {
    const category = normalizeCategory(raw);
    const hit = cache[`${net}:${category}`];
    if (hit && now - hit.at < (hit.meta.known ? KNOWN_TTL_MS : UNKNOWN_TTL_MS)) out[category] = hit.meta;
    else missing.push(category);
  }
  if (missing.length) {
    const fetched = await Promise.all(missing.map(c => fetchMeta(c, net)));
    for (const meta of fetched) {
      out[meta.category] = meta;
      cache[`${net}:${meta.category}`] = { meta, at: now };
    }
    await storage().setItem(CACHE_KEY, JSON.stringify(cache)).catch(() => {});
  }
  return out;
}

export interface NftMeta {
  category: string;
  /** Lower-case hex, '' for an empty commitment. */
  commitment: string;
  name: string;
  description?: string;
  icon?: string;
  /** False when no registry describes this commitment (or its category): the name is a placeholder. */
  known: boolean;
}

const NFT_CACHE_KEY = 'cashtoken_nft_meta_v1';
type NftCache = Record<string, { meta: NftMeta; at: number }>;
let nftMemory: NftCache | null = null;

async function loadNftCache(): Promise<NftCache> {
  if (nftMemory) return nftMemory;
  try { nftMemory = JSON.parse((await storage().getItem(NFT_CACHE_KEY)) ?? '{}') as NftCache; } catch { nftMemory = {}; }
  return nftMemory!;
}

const nftPlaceholder = (category: string, commitment: string): NftMeta => ({
  category, commitment, name: commitment ? `NFT #${commitment.slice(0, 8)}` : 'NFT', known: false,
});

async function fetchNftMeta(category: string, commitment: string, net: BchNet): Promise<NftMeta> {
  try {
    const { status, body } = await getJson(`${BCMR_URL[net]}/api/tokens/${category}/${commitment || 'empty'}/`);
    if (status === 200 && body && !body.error) {
      // The indexer returns the per-commitment identity under `type_metadata`; fall back to the category identity.
      const m = body.type_metadata ?? body;
      const name = String(m.name ?? '').trim().slice(0, 128);
      if (name) return { category, commitment, name, description: m.description ? String(m.description).slice(0, 512) : undefined, icon: iconUrl(m.uris?.icon), known: true };
    }
  } catch { /* indexer unreachable: fall through to the placeholder */ }
  return nftPlaceholder(category, commitment);
}

/**
 * Per-commitment NFT metadata for one category, from cache where fresh. Keyed by commitment ('' for none).
 * Never throws; an undescribed NFT gets a placeholder.
 */
export async function getNftMetas(category: string, commitments: string[], net: BchNet): Promise<Record<string, NftMeta>> {
  const cat = normalizeCategory(category);
  const cache = await loadNftCache();
  const out: Record<string, NftMeta> = {};
  const missing: string[] = [];
  const now = Date.now();
  for (const raw of commitments) {
    const commitment = (raw ?? '').replace(/^0x/, '').toLowerCase();
    const hit = cache[`${net}:${cat}:${commitment}`];
    if (hit && now - hit.at < (hit.meta.known ? KNOWN_TTL_MS : UNKNOWN_TTL_MS)) out[commitment] = hit.meta;
    else missing.push(commitment);
  }
  if (missing.length) {
    const fetched = await Promise.all(missing.map(c => fetchNftMeta(cat, c, net)));
    for (const meta of fetched) {
      out[meta.commitment] = meta;
      cache[`${net}:${cat}:${meta.commitment}`] = { meta, at: now };
    }
    await storage().setItem(NFT_CACHE_KEY, JSON.stringify(cache)).catch(() => {});
  }
  return out;
}

let listCache: Partial<Record<BchNet, { at: number; tokens: TradeableToken[] }>> = {};

/** CashTokens with a Cauldron pool, most traded first. Empty when the indexer cannot be reached. */
export async function getTradeableTokens(net: BchNet, limit = 60): Promise<TradeableToken[]> {
  const hit = listCache[net];
  if (hit && Date.now() - hit.at < 120_000) return hit.tokens;
  try {
    const { status, body } = await getJson(`${CAULDRON_URL[net]}/tokens/list_cached?limit=${limit}&by=volume&order=desc`);
    if (status !== 200 || !Array.isArray(body)) return hit?.tokens ?? [];
    const tokens: TradeableToken[] = [];
    for (const t of body) {
      const category = normalizeCategory(String(t.token_id ?? ''));
      const symbol = String(t.bcmr?.token?.symbol || t.display_symbol || '').toUpperCase();
      if (!/^[0-9a-f]{64}$/.test(category) || !symbol || symbol === 'UNKNOWN') continue;
      const decimals = Number(t.bcmr?.token?.decimals ?? 0);
      tokens.push({
        category, symbol,
        name: t.bcmr?.name || t.display_name || symbol,
        decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 18 ? decimals : 0,
        icon: iconUrl(t.bcmr?.uris?.icon),
        known: true,
        priceSats: Number(t.price_now) || 0,
        priceUsd: Number(t.price_now_usd) || 0,
        tvlSats: Number(t.tvl_sats) || 0,
        change24hPct: Number.isFinite(Number(t.change_24h_bp)) ? Number(t.change_24h_bp) / 100 : undefined,
      });
    }
    listCache[net] = { at: Date.now(), tokens };
    return tokens;
  } catch {
    return hit?.tokens ?? [];
  }
}
