/**
 * The wallet's assets: one row per token per network, with its balance.
 *
 * Every family is read independently and a family that fails keeps its previous rows, so one dead RPC never
 * blanks the whole portfolio. Balances are bigint base units.
 *
 * EVM and Solana are read here over JSON-RPC. Bitcoin and Bitcoin Cash are read by their wallet modules inside
 * the worklet (see lib/rpc.ts for why the two differ).
 */
import { networkOf, networksOf, USDC_LOGO, type NetworkDef, type NetworkMode } from '@bch-intents/wallet-core/chains';
import { assetId, nativeAsset, NATIVE_SOL_MINT, type Asset } from '@bch-intents/wallet-core/assets';
import { getNftMetas, getTokenMetas, normalizeCategory, type BchNet } from '@bch-intents/wallet-core/cashtokens';
import { nftId, type NftHolding } from '@bch-intents/wallet-core/nfts';
import { meshPositionsHeldBy, tryDecodeCommitment, type MeshPositionView } from '@bch-intents/wallet-core/mesh/v4';
import { swapServerApiFor } from '@bch-intents/wallet-core/swap/api';
import { account } from '@/wdk/bridge';
import { erc20Balance, evmNativeBalance } from './evm';
import { solRpc } from './rpc';

const usdcRow = (net: NetworkDef, ref: string, kind: 'erc20' | 'spl', balance: bigint): Asset => ({
  id: assetId(net, kind === 'erc20' ? ref.toLowerCase() : ref), network: net, kind, ref,
  symbol: 'USDC', name: 'USD Coin', decimals: 6, logo: USDC_LOGO, balance, verified: true,
});

// ── Bitcoin Cash ─────────────────────────────────────────────────────────────

export async function loadBch(accountIndex: number, mode: NetworkMode): Promise<Asset[]> {
  const net = networkOf(mode, 'bch');
  const bchNet: BchNet = mode === 'mainnet' ? 'mainnet' : 'chipnet';
  const wallet = account(net.key, accountIndex);
  const [sats, tokens] = await Promise.all([
    wallet.balance(),
    wallet.call<Record<string, string>>('getTokenBalances').catch(() => ({} as Record<string, string>)),
  ]);
  const out: Asset[] = [nativeAsset(net, sats)];
  const held = Object.entries(tokens ?? {}).filter(([, amount]) => BigInt(amount) > 0n);
  if (held.length) {
    // Names for at most 200 categories: a spammed address can hold thousands, and each name is a request.
    const metas = await getTokenMetas(held.slice(0, 200).map(([c]) => c), bchNet);
    for (const [rawCategory, amount] of held) {
      const category = normalizeCategory(rawCategory);
      const meta = metas[category];
      out.push({
        id: assetId(net, category), network: net, kind: 'cashtoken', ref: category,
        symbol: meta?.symbol ?? 'CT', name: meta?.name ?? 'CashToken', decimals: meta?.decimals ?? 0, logo: meta?.icon,
        balance: BigInt(amount), verified: !!meta?.known,
      });
    }
  }
  return out;
}

/** What the BCH wallet module reports for each held NFT (bigints arrive as decimal strings over the bridge). */
interface RawNft { category: string; commitment: string; capability: 'none' | 'mutable' | 'minting'; amount: string | bigint; txid: string; vout: number; satoshis: string | bigint }

/**
 * The CashToken NFTs the account holds, with BCMR metadata and — where the commitment decodes as a Mesh V4
 * position — the decoded commitment and (best-effort) a live server view. Never throws: metadata and the Mesh
 * read are both fail-soft, so an NFT always lists, even offline, as a bare category + commitment.
 */
export async function loadBchNfts(accountIndex: number, mode: NetworkMode, tokenAddress: string | null): Promise<NftHolding[]> {
  const net = networkOf(mode, 'bch');
  const bchNet: BchNet = mode === 'mainnet' ? 'mainnet' : 'chipnet';
  const raw = await account(net.key, accountIndex).call<RawNft[]>('getNftHoldings').catch(() => [] as RawNft[]);
  if (!raw.length) return [];

  // Metadata per category (one request per distinct category), then live positions for the whole wallet at once.
  const byCategory = new Map<string, string[]>();
  for (const r of raw) {
    const cat = normalizeCategory(r.category);
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), (r.commitment ?? '').toLowerCase()]);
  }
  const metasByCategory: Record<string, Awaited<ReturnType<typeof getNftMetas>>> = {};
  await Promise.all([...byCategory].map(async ([cat, commitments]) => { metasByCategory[cat] = await getNftMetas(cat, commitments, bchNet); }));

  const positions = tokenAddress ? await meshPositionsHeldBy(tokenAddress, bchNet) : [];
  const posByKey = new Map<string, MeshPositionView>(positions.map(p => [`${normalizeCategory(p.category)}:${(p.nft?.commitment ?? '').toLowerCase()}`, p]));

  return raw.map(r => {
    const category = normalizeCategory(r.category);
    const commitment = (r.commitment ?? '').toLowerCase();
    const meta = metasByCategory[category]?.[commitment];
    const decoded = tryDecodeCommitment(commitment);
    const view = posByKey.get(`${category}:${commitment}`) ?? positions.find(p => normalizeCategory(p.category) === category);
    return {
      id: nftId(net, category, commitment),
      network: net,
      category,
      commitment,
      capability: r.capability ?? 'none',
      amount: BigInt(r.amount ?? 0),
      utxo: { txid: r.txid, vout: r.vout, satoshis: BigInt(r.satoshis ?? 0) },
      name: meta?.name ?? (decoded ? 'Mesh position' : 'NFT'),
      description: meta?.description,
      logo: meta?.icon,
      verified: !!meta?.known,
      ...(decoded ? { position: { commitment: decoded, view: view ?? undefined } } : {}),
    } satisfies NftHolding;
  });
}

// ── EVM ──────────────────────────────────────────────────────────────────────

async function loadEvmNetwork(net: NetworkDef, owner: string): Promise<Asset[]> {
  if (net.nativeIsUsdc) return [nativeAsset(net, await evmNativeBalance(net, owner))];
  const [gas, usdc] = await Promise.all([
    evmNativeBalance(net, owner),
    net.usdc ? erc20Balance(net, net.usdc, owner).catch(() => 0n) : Promise.resolve(0n),
  ]);
  const out = [nativeAsset(net, gas)];
  if (net.usdc) out.push(usdcRow(net, net.usdc, 'erc20', usdc));
  return out;
}

/** Every EVM network of the mode. A network whose RPC fails is left out of the answer, not zeroed. */
export async function loadEvm(owner: string, mode: NetworkMode): Promise<{ assets: Asset[]; failed: string[] }> {
  const nets = networksOf(mode, 'evm');
  const settled = await Promise.allSettled(nets.map(n => loadEvmNetwork(n, owner)));
  const assets: Asset[] = [];
  const failed: string[] = [];
  settled.forEach((r, i) => (r.status === 'fulfilled' ? assets.push(...r.value) : failed.push(nets[i].key)));
  return { assets, failed };
}

// ── Solana ───────────────────────────────────────────────────────────────────

/** Mainnet: the swap server's balances endpoint, which also names and prices each token. */
async function loadSolanaFromServer(net: NetworkDef, owner: string): Promise<Asset[] | null> {
  const api = swapServerApiFor(true);
  if (!api) return null;
  try {
    const { balances } = await api.getSolBalances(owner, { timeoutMs: 8000 });
    const out: Asset[] = [];
    let sawNative = false;
    for (const b of balances) {
      if (b.native) {
        sawNative = true;
        out.push({ ...nativeAsset(net, BigInt(b.amount)), usdPrice: b.usdPrice });
        continue;
      }
      if (b.isStock) continue;
      out.push({
        id: assetId(net, b.mint), network: net, kind: 'spl', ref: b.mint,
        symbol: b.symbol ?? `${b.mint.slice(0, 4)}…`, name: b.name ?? 'Unknown token', decimals: b.decimals, logo: b.icon,
        balance: BigInt(b.amount), usdPrice: b.usdPrice, verified: b.verified,
      });
    }
    if (!sawNative) out.unshift(nativeAsset(net, 0n));
    return out;
  } catch {
    return null;
  }
}

async function loadSolanaFromRpc(net: NetworkDef, owner: string): Promise<Asset[]> {
  const node = solRpc(net);
  const [lamports, holdings] = await Promise.all([node.balance(owner), node.holdings(owner).catch(() => [])]);
  const out = [nativeAsset(net, lamports)];
  for (const h of holdings) {
    if (h.mint === NATIVE_SOL_MINT) continue;
    if (h.mint === net.usdc) { out.push(usdcRow(net, h.mint, 'spl', h.amount)); continue; }
    out.push({
      id: assetId(net, h.mint), network: net, kind: 'spl', ref: h.mint,
      symbol: `${h.mint.slice(0, 4)}…`, name: 'Unknown token', decimals: h.decimals, balance: h.amount, verified: false,
    });
  }
  return out;
}

export async function loadSolana(owner: string, mode: NetworkMode): Promise<Asset[]> {
  const net = networkOf(mode, 'solana');
  const rows = (mode === 'mainnet' ? await loadSolanaFromServer(net, owner) : null) ?? await loadSolanaFromRpc(net, owner);
  // USDC is always listed: it is what the bridge delivers here.
  if (net.usdc && !rows.some(a => a.ref === net.usdc)) rows.push(usdcRow(net, net.usdc, 'spl', 0n));
  return rows;
}

// ── Bitcoin ──────────────────────────────────────────────────────────────────

export async function loadBtc(accountIndex: number, mode: NetworkMode): Promise<Asset[]> {
  const net = networkOf(mode, 'btc');
  return [nativeAsset(net, await account(net.key, accountIndex).balance())];
}
