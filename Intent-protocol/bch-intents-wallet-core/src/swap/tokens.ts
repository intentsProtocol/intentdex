/**
 * What can be swapped, and which service swaps it.
 *
 * Three products behind one card, chosen by the pair the user picks (the same idea as `resolveRoute` in
 * frontend/src/swap-server/routing.ts, with the wallet's own token model):
 *
 *   cashtoken   BCH ↔ CashToken, or two CashTokens      cashtoken-relayer (Dutch-auction intent)
 *   cctp        USDC on one chain → USDC on another      cctp-swap-server (Circle CCTP)
 *   jupiter     two Solana tokens, mainnet only          cctp-swap-server (Jupiter)
 *
 * A pair no product can execute resolves to `none` with a reason, and the card disables its button. Nothing
 * ever falls through to a default executor.
 */

import { getNetwork, networkOf, USDC_LOGO, type NetworkDef, type NetworkMode } from '../chains';
import type { Asset } from '../assets';
import type { TradeableToken } from '../cashtokens';
import type { MessageKey } from '../i18n';
import { NATIVE_SOL_MINT } from '../assets';
import type { CctpChain, SolanaToken, SwapServerConfig } from './types';

export type SwapTokenKind = 'bch' | 'cashtoken' | 'usdc' | 'sol' | 'spl';
export type Product = 'cashtoken' | 'cctp' | 'jupiter';

export interface SwapToken {
  /** `${net.key}:${ref}` — the same shape as an Asset id, so a held asset and its swap row match. */
  id: string;
  net: NetworkDef;
  kind: SwapTokenKind;
  /** 'native', a CashToken category, a USDC contract, or a Solana mint. */
  ref: string;
  symbol: string;
  name: string;
  /** Decimals of the amount the product's API takes. USDC is always 6 here, also on Arc. */
  decimals: number;
  logo?: string;
  verified: boolean;
  suspicious?: boolean;
  priceUsd?: number;
  product: Product;
}

export type Route =
  | { kind: 'cashtoken'; sell: string; buy: string }
  | { kind: 'cctp'; src: CctpChain; dst: CctpChain }
  | { kind: 'jupiter'; inputMint: string; outputMint: string }
  | { kind: 'none'; reason: MessageKey };

const idOf = (net: NetworkDef, ref: string) => `${net.key}:${ref}`;

// ── lists ─────────────────────────────────────────────────────────────────────

export function bchTokens(mode: NetworkMode, tradeable: TradeableToken[], held: Asset[]): SwapToken[] {
  const net = networkOf(mode, 'bch');
  const out: SwapToken[] = [{
    id: idOf(net, 'native'), net, kind: 'bch', ref: 'native', symbol: 'BCH', name: 'Bitcoin Cash', decimals: 8,
    logo: net.native.logo, verified: true, product: 'cashtoken',
  }];
  const seen = new Set<string>();
  for (const tk of tradeable) {
    seen.add(tk.category);
    out.push({
      id: idOf(net, tk.category), net, kind: 'cashtoken', ref: tk.category, symbol: tk.symbol, name: tk.name, decimals: tk.decimals,
      logo: tk.icon, verified: tk.known, priceUsd: tk.priceUsd || undefined, product: 'cashtoken',
    });
  }
  // A held token without a pool is still listed, so the user sees why it cannot be sold rather than not finding it.
  for (const a of held) {
    if (a.kind !== 'cashtoken' || a.network.key !== net.key || seen.has(a.ref)) continue;
    out.push({ id: a.id, net, kind: 'cashtoken', ref: a.ref, symbol: a.symbol, name: a.name, decimals: a.decimals, logo: a.logo, verified: a.verified, product: 'cashtoken' });
  }
  return out;
}

/** One USDC row per CCTP chain the server offers and this wallet can sign for. */
export function cctpTokens(config: SwapServerConfig | undefined, mode: NetworkMode): SwapToken[] {
  if (!config || config.cctp.network !== mode) return [];
  return config.cctp.chains.flatMap((c): SwapToken[] => {
    const net = getNetwork(c.key);
    if (!net || net.mode !== mode) return [];
    return [{
      id: idOf(net, net.nativeIsUsdc ? 'native' : net.family === 'evm' ? c.usdc.toLowerCase() : c.usdc),
      net, kind: 'usdc', ref: c.usdc, symbol: 'USDC', name: `USD Coin · ${c.name}`, decimals: 6, logo: USDC_LOGO, verified: true, product: 'cctp',
    }];
  });
}

export function jupiterToken(t: SolanaToken, net: NetworkDef): SwapToken {
  const native = t.mint === NATIVE_SOL_MINT;
  return {
    id: idOf(net, native ? 'native' : t.mint), net, kind: native ? 'sol' : 'spl', ref: t.mint, symbol: t.symbol, name: t.name, decimals: t.decimals,
    logo: native ? net.native.logo : t.icon, verified: t.verified, suspicious: t.suspicious, priceUsd: t.usdPrice, product: 'jupiter',
  };
}

export function jupiterTokens(config: SwapServerConfig | undefined, mode: NetworkMode, list: SolanaToken[]): SwapToken[] {
  if (mode !== 'mainnet' || !config?.solana.enabled) return [];
  const net = networkOf('mainnet', 'solana');
  const out = list.filter(t => !t.isStock).map(t => jupiterToken(t, net));
  if (!out.some(t => t.kind === 'sol')) {
    out.unshift({ id: idOf(net, 'native'), net, kind: 'sol', ref: config.solana.nativeMint || NATIVE_SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, logo: net.native.logo, verified: true, product: 'jupiter' });
  }
  return out;
}

// ── balances ──────────────────────────────────────────────────────────────────

/** What the wallet holds of a swap token, in the token's own (API) decimals. */
export function balanceOf(token: SwapToken, assets: Asset[]): bigint {
  // The same USDC is both a CCTP row and, on Solana mainnet, a Jupiter row: match on network and reference.
  const ref = token.kind === 'bch' || token.kind === 'sol' ? 'native' : token.ref;
  const asset = assets.find(a => a.network.key === token.net.key && (
    a.ref === ref || a.ref.toLowerCase() === ref.toLowerCase() || (token.kind === 'usdc' && token.net.nativeIsUsdc && a.kind === 'native')
  ));
  if (!asset) return 0n;
  // Arc reports its native USDC with 18 decimals; the bridge counts it with 6.
  if (asset.decimals > token.decimals) return asset.balance / 10n ** BigInt(asset.decimals - token.decimals);
  return asset.balance;
}

// ── routing ───────────────────────────────────────────────────────────────────

export function resolveRoute(sell: SwapToken | undefined, buy: SwapToken | undefined, config?: SwapServerConfig): Route {
  if (!sell || !buy) return { kind: 'none', reason: 'swap.reason.pick' };
  if (sell.id === buy.id) return { kind: 'none', reason: 'swap.reason.same' };

  const bchSide = (t: SwapToken) => t.kind === 'bch' || t.kind === 'cashtoken';
  if (bchSide(sell) && bchSide(buy)) {
    return { kind: 'cashtoken', sell: sell.kind === 'bch' ? 'BCH' : sell.ref, buy: buy.kind === 'bch' ? 'BCH' : buy.ref };
  }

  const solSide = (t: SwapToken) => t.net.family === 'solana';
  if (solSide(sell) && solSide(buy)) {
    if (sell.net.mode !== 'mainnet') return { kind: 'none', reason: 'swap.reason.solanaMainnet' };
    return { kind: 'jupiter', inputMint: sell.ref, outputMint: buy.ref };
  }

  const cctpChain = (t: SwapToken) => (t.symbol === 'USDC' && t.verified ? config?.cctp.chains.find(c => c.key === t.net.key) : undefined);
  const src = cctpChain(sell), dst = cctpChain(buy);
  if (src && dst) {
    if (src.key === dst.key) return { kind: 'none', reason: 'swap.reason.sameChain' };
    if (config!.cctp.closedRoutes.includes(`${src.key}>${dst.key}`)) return { kind: 'none', reason: 'swap.reason.closed' };
    return { kind: 'cctp', src, dst };
  }
  if (src || dst) return { kind: 'none', reason: 'swap.reason.usdcOnly' };
  return { kind: 'none', reason: 'swap.reason.unsupported' };
}

/**
 * After a pick on one side, the token the other side should become when the pair would otherwise have no route.
 * Keeps the user inside one product: pick USDC on Base and the other side becomes USDC on another chain.
 */
export function counterpart(picked: SwapToken, other: SwapToken | undefined, all: SwapToken[], config?: SwapServerConfig): SwapToken | undefined {
  if (other && resolveRoute(picked, other, config).kind !== 'none') return other;
  const candidates = all.filter(t => t.product === picked.product && t.id !== picked.id);
  if (picked.product === 'cctp') {
    const order = ['base', 'arbitrum', 'ethereum', 'optimism', 'solana', 'arc', 'base-sepolia', 'arb-sepolia', 'eth-sepolia', 'op-sepolia', 'solana-devnet', 'arc-testnet'];
    return [...candidates].filter(t => t.net.key !== picked.net.key).sort((a, b) => order.indexOf(a.net.key) - order.indexOf(b.net.key))[0];
  }
  if (picked.product === 'cashtoken') return picked.kind === 'bch' ? candidates.find(t => t.kind === 'cashtoken') : candidates.find(t => t.kind === 'bch');
  return picked.kind === 'sol' ? candidates.find(t => t.symbol === 'USDC' && t.verified) ?? candidates[0] : candidates.find(t => t.kind === 'sol');
}

export const PRODUCT_LABEL: Record<Product, MessageKey> = {
  cashtoken: 'swap.product.cashtoken',
  cctp: 'swap.product.cctp',
  jupiter: 'swap.product.jupiter',
};
