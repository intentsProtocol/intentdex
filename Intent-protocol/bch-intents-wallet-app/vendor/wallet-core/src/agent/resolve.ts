/**
 * Finding what the user named — "bch", "bitcoin cash", "usdc on base", a CashToken symbol — in the saved
 * snapshot. Only things the wallet already lists can be named; nothing a model invents gets through.
 */
import type { SnapshotAsset, SnapshotToken, SwapProduct, TokenRef, WalletSnapshot } from './types';

const ALIASES: Record<string, string> = {
  'bitcoin cash': 'BCH', bitcoincash: 'BCH', 'bitcoin-cash': 'BCH',
  bitcoin: 'BTC', 'usd coin': 'USDC', usd: 'USDC', dollars: 'USDC', dollar: 'USDC',
  ether: 'ETH', ethereum: 'ETH', solana: 'SOL',
};

const NETWORK_WORDS: Record<string, string[]> = {
  base: ['base', 'base-sepolia'], arbitrum: ['arbitrum', 'arb-sepolia'], arb: ['arbitrum', 'arb-sepolia'],
  optimism: ['optimism', 'op-sepolia'], op: ['optimism', 'op-sepolia'], ethereum: ['ethereum', 'eth-sepolia'],
  eth: ['ethereum', 'eth-sepolia'], sepolia: ['eth-sepolia'], arc: ['arc', 'arc-testnet'], solana: ['solana', 'solana-devnet'],
};

export interface Named { symbol: string; networkHint?: string[] }

/** "usdc on base" → { symbol: 'USDC', networkHint: ['base', 'base-sepolia'] }. */
export function parseName(text: unknown): Named | null {
  let s = String(text ?? '').toLowerCase().trim().replace(/[^\w\s.-]/g, ' ').replace(/\s+/g, ' ');
  if (!s) return null;
  let networkHint: string[] | undefined;
  const on = /^(.*?)\s+(?:on|kwenye|via)\s+([\w-]+)$/.exec(s);
  if (on) { s = on[1]!.trim(); networkHint = NETWORK_WORDS[on[2]!] ?? [on[2]!]; }
  const symbol = (ALIASES[s] ?? s).toUpperCase().replace(/\s+/g, '');
  return symbol ? { symbol, networkHint } : null;
}

/** Held assets with this symbol, the largest balance first. */
export function findAssets(snapshot: WalletSnapshot, text: unknown): SnapshotAsset[] {
  const named = parseName(text);
  if (!named) return [];
  return snapshot.assets
    .filter(a => a.symbol.toUpperCase() === named.symbol && (!named.networkHint || named.networkHint.includes(a.network)))
    .sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : BigInt(b.balance) < BigInt(a.balance) ? -1 : 0));
}

/** A CashToken the relayer trades, by symbol, name or by category address prefix. */
export function findTradeable(snapshot: WalletSnapshot, text: unknown): SnapshotToken | undefined {
  const raw = String(text ?? '').toLowerCase().trim();
  if (!raw) return undefined;
  const byDirect = snapshot.tokens.find(t => t.name.toLowerCase() === raw || t.symbol.toLowerCase() === raw);
  if (byDirect) return byDirect;
  const named = parseName(text);
  if (!named) return undefined;
  const lower = named.symbol.toLowerCase();
  return snapshot.tokens.find(t => t.symbol.toUpperCase() === named.symbol)
    ?? snapshot.tokens.find(t => t.name.toLowerCase().replace(/\s+/g, '') === lower)
    ?? (lower.length >= 8 ? snapshot.tokens.find(t => t.category.startsWith(lower)) : undefined);
}

/** Suggests matching tokens from the snapshot registry for search and quick chat suggestions. */
export function suggestTokens(snapshot: WalletSnapshot, prefix?: string, limit = 8): SnapshotToken[] {
  const p = (prefix ?? '').trim().toLowerCase().replace(/^\$/, '');
  const tokens = snapshot.tokens;
  if (!p) return tokens.slice(0, limit);
  return tokens
    .filter(t => t.symbol.toLowerCase().includes(p) || t.name.toLowerCase().includes(p) || t.category.startsWith(p))
    .slice(0, limit);
}

export function refOfAsset(a: SnapshotAsset): TokenRef {
  return { symbol: a.symbol, network: a.network, networkName: a.networkName, assetId: a.id, ref: a.ref, decimals: a.decimals };
}

export function refOfToken(t: SnapshotToken, snapshot: WalletSnapshot): TokenRef {
  const bch = snapshot.assets.find(a => a.family === 'bch' && a.kind === 'native');
  const held = snapshot.assets.find(a => a.kind === 'cashtoken' && a.ref === t.category);
  return {
    symbol: t.symbol, network: bch?.network ?? (snapshot.mode === 'mainnet' ? 'bch-mainnet' : 'bch-chipnet'),
    networkName: bch?.networkName ?? 'Bitcoin Cash', assetId: held?.id, ref: t.category, decimals: t.decimals,
  };
}

/**
 * Which service would swap this pair, by the same rules as `swap/tokens.ts#resolveRoute`, from what the
 * snapshot knows. The Swap screen settles it with live data before anything is signed.
 */
export function guessProduct(sell: TokenRef, buy: TokenRef, mode: WalletSnapshot['mode']): SwapProduct | null {
  const isBch = (t: TokenRef) => t.network.startsWith('bch-');
  if (isBch(sell) && isBch(buy) && (sell.ref === 'native') !== (buy.ref === 'native')) return 'cashtoken';
  if (sell.symbol === 'USDC' && buy.symbol === 'USDC' && sell.network !== buy.network && !isBch(sell) && !isBch(buy)) return 'cctp';
  const isSol = (t: TokenRef) => t.network === 'solana';
  if (mode === 'mainnet' && isSol(sell) && isSol(buy)) return 'jupiter';
  return null;
}
