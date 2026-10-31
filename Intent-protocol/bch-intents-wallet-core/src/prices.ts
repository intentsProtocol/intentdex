/**
 * USD prices for the wallet's native assets, keyed by symbol.
 *
 * The mesh server's feed is used when the build was given its URL; otherwise CoinGecko's public endpoint.
 * Solana tokens are priced by mint through the swap server (see lib/assets.ts), never by symbol.
 */

import { services } from './platform';

export interface Price { usd: number; change24h?: number }
export type PriceMap = Record<string, Price>;

const COINGECKO_IDS: Record<string, string> = {
  BCH: 'bitcoin-cash', BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', USDC: 'usd-coin',
};

async function getJson(url: string, timeoutMs = 10_000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`price feed answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fromMesh(): Promise<PriceMap> {
  const json = await getJson(`${services().priceFeed}/api/v1/prices`);
  const rows: any[] = Array.isArray(json) ? json : json?.prices ?? json?.data ?? [];
  const out: PriceMap = {};
  if (Array.isArray(rows)) {
    for (const r of rows) {
      const symbol = String(r.symbol ?? '').toUpperCase();
      const usd = Number(r.price ?? r.usd ?? r.usdPrice);
      if (symbol && Number.isFinite(usd)) out[symbol] = { usd, change24h: Number.isFinite(Number(r.change24h)) ? Number(r.change24h) : undefined };
    }
  } else if (rows && typeof rows === 'object') {
    for (const [symbol, v] of Object.entries(rows as Record<string, any>)) {
      const usd = Number(typeof v === 'number' ? v : v?.price ?? v?.usd);
      if (Number.isFinite(usd)) out[symbol.toUpperCase()] = { usd, change24h: Number.isFinite(Number(v?.change24h)) ? Number(v.change24h) : undefined };
    }
  }
  if (!Object.keys(out).length) throw new Error('price feed returned nothing usable');
  return out;
}

async function fromCoinGecko(): Promise<PriceMap> {
  const ids = Object.values(COINGECKO_IDS).join(',');
  const json = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
  const out: PriceMap = {};
  for (const [symbol, id] of Object.entries(COINGECKO_IDS)) {
    const usd = Number(json?.[id]?.usd);
    if (Number.isFinite(usd)) out[symbol] = { usd, change24h: Number.isFinite(Number(json[id].usd_24h_change)) ? Number(json[id].usd_24h_change) : undefined };
  }
  return out;
}

let cache: { at: number; prices: PriceMap } | null = null;
const TTL_MS = 60_000;

/** Prices by symbol. Never throws: a feed that is down means "no price", and the UI shows a dash. */
export async function fetchPrices(force = false): Promise<PriceMap> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.prices;
  let prices: PriceMap = {};
  try {
    prices = services().priceFeed ? await fromMesh().catch(fromCoinGecko) : await fromCoinGecko();
  } catch {
    return cache?.prices ?? {};
  }
  cache = { at: Date.now(), prices };
  return prices;
}
