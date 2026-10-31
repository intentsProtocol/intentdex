/**
 * The asset model both wallets share: one row per token per network, with its balance.
 *
 * How balances are *read* is the host's business (the extension calls RPCs from the page, the app asks its
 * wallet worklet). What a row looks like, what it is worth and how rows are ordered is decided here, once.
 * Balances are bigint base units.
 */

import type { Family, NetworkDef } from './chains';
import type { PriceMap } from './prices';

export type AssetKind = 'native' | 'erc20' | 'spl' | 'cashtoken';

export interface Asset {
  /** `${network.key}:${ref}` — stable across reloads, used as a list key and for the hidden-tokens setting. */
  id: string;
  network: NetworkDef;
  kind: AssetKind;
  /** 'native', or the contract address / mint / category. */
  ref: string;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
  balance: bigint;
  /** Set for assets priced by something other than their symbol (Solana tokens by mint, CashTokens by pool). */
  usdPrice?: number;
  /** False for a token no registry vouches for. */
  verified: boolean;
}

export interface Addresses {
  bch: string | null;
  evm: string | null;
  solana: string | null;
  btc: string | null;
}

/** Wrapped SOL: the mint Jupiter and the swap server use for native SOL. */
export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

export const assetId = (net: NetworkDef, ref: string) => `${net.key}:${ref}`;

export const nativeAsset = (net: NetworkDef, balance: bigint): Asset => ({
  id: assetId(net, 'native'), network: net, kind: 'native', ref: 'native',
  symbol: net.native.symbol, name: net.native.name, decimals: net.native.decimals, logo: net.native.logo,
  balance, verified: true,
});

/** USD per whole token, or undefined when nothing prices it. Testnet funds are worth nothing and get no price. */
export function priceOf(a: Asset, prices: PriceMap): number | undefined {
  if (a.network.mode !== 'mainnet') return undefined;
  if (a.usdPrice !== undefined) return a.usdPrice;
  if (a.kind === 'native') return prices[a.network.native.priceSymbol]?.usd;
  if (a.symbol === 'USDC' && a.verified) return prices.USDC?.usd ?? 1;
  return undefined;
}

export function change24hOf(a: Asset, prices: PriceMap): number | undefined {
  if (a.network.mode !== 'mainnet') return undefined;
  if (a.kind === 'native') return prices[a.network.native.priceSymbol]?.change24h;
  return undefined;
}

export function valueOf(a: Asset, prices: PriceMap): number | undefined {
  const p = priceOf(a, prices);
  if (p === undefined) return undefined;
  return (Number(a.balance) / 10 ** a.decimals) * p;
}

export const FAMILY_ORDER: Family[] = ['bch', 'evm', 'solana', 'btc'];

/** Display order: by value where there is one, then held before empty, then family and name. */
export function sortAssets(assets: Asset[], prices: PriceMap): Asset[] {
  const rank = (a: Asset) => FAMILY_ORDER.indexOf(a.network.family);
  return [...assets].sort((a, b) => {
    const va = valueOf(a, prices) ?? 0, vb = valueOf(b, prices) ?? 0;
    if (va !== vb) return vb - va;
    const ha = a.balance > 0n ? 1 : 0, hb = b.balance > 0n ? 1 : 0;
    if (ha !== hb) return hb - ha;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.kind !== b.kind) return a.kind === 'native' ? -1 : b.kind === 'native' ? 1 : 0;
    return a.network.name.localeCompare(b.network.name) || a.symbol.localeCompare(b.symbol);
  });
}
