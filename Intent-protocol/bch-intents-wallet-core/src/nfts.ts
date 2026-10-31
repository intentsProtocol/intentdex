/**
 * The NFT model both wallets share: CashToken NFTs the account holds, kept apart from fungible `Asset`s.
 *
 * NFTs are deliberately NOT `Asset`s: an `Asset` is priced and feeds the swap picker, the send picker,
 * `sortAssets` and the USD total, none of which an NFT belongs in. A host reads the holdings from its BCH
 * wallet (the `getNftHoldings` method), enriches each with BCMR metadata and, where the commitment decodes as
 * a Mesh V4 position, with the decoded commitment and (optionally) a live server view.
 *
 * Balances and satoshis are bigint base units, as everywhere else in this package.
 */
import type { NetworkDef } from './chains';
import type { MeshPositionView, PositionCommitment } from './mesh/v4';

/** One NFT, matching one unspent output. A coin can carry an NFT and a fungible amount of the same category. */
export interface NftHolding {
  /** `${network.key}:${category}:${commitment}` — distinct from an Asset's `assetId`, and stable for the hidden list. */
  id: string;
  network: NetworkDef;
  category: string;
  /** Lower-case hex, '' for an empty commitment. */
  commitment: string;
  capability: 'none' | 'mutable' | 'minting';
  /** Fungible amount riding on the same coin; usually 0. */
  amount: bigint;
  utxo: { txid: string; vout: number; satoshis: bigint };
  name: string;
  description?: string;
  logo?: string;
  /** False when no registry vouches for the category: the name is then a placeholder. */
  verified: boolean;
  /** Set when the commitment decodes as a Mesh V4 position NFT. */
  position?: { commitment: PositionCommitment; view?: MeshPositionView };
}

/** NFTs of one category, shown together. */
export interface NftGroup {
  category: string;
  network: NetworkDef;
  name: string;
  logo?: string;
  items: NftHolding[];
}

export const nftId = (net: NetworkDef, category: string, commitment: string) => `${net.key}:${category}:${commitment}`;

/** True when a holding is a Mesh V4 liquidity position (worth its own card and value, not a collectible row). */
export const isPosition = (h: NftHolding): boolean => h.position !== undefined;

/**
 * Group holdings by category for display: categories in first-seen order, NFTs within a category in the order
 * given. A position is its own concern (shown as a card elsewhere); `groupNfts` still returns it so a caller
 * that wants everything can have it — filter with `isPosition` where positions are handled separately.
 */
export function groupNfts(holdings: NftHolding[]): NftGroup[] {
  const byCategory = new Map<string, NftGroup>();
  for (const h of holdings) {
    const key = `${h.network.key}:${h.category}`;
    let group = byCategory.get(key);
    if (!group) {
      group = { category: h.category, network: h.network, name: h.name, logo: h.logo, items: [] };
      byCategory.set(key, group);
    }
    group.items.push(h);
  }
  return [...byCategory.values()];
}
