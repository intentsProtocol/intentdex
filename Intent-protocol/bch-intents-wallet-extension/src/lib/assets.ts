/**
 * The wallet's assets: one row per token per network, with its balance.
 *
 * Every family is read independently and a family that fails keeps its previous rows, so one dead RPC never
 * blanks the whole portfolio. Balances are bigint base units.
 */

import { networksOf, networkOf, USDC_LOGO, type NetworkDef, type NetworkMode } from '@/lib/chains';
import { evmNativeBalance, erc20Balance } from '@/lib/evm';
import { solBalance, splHoldings } from '@/lib/solana';
import { assetId, nativeAsset, NATIVE_SOL_MINT, type Asset } from '@bch-intents/wallet-core/assets';
import { EsploraClient } from '@/lib/btc-esplora';
import { getNftMetas, getTokenMetas, normalizeCategory, type BchNet } from '@/lib/cashtokens';
import { nftId, type NftHolding } from '@bch-intents/wallet-core/nfts';
import { meshPositionsHeldBy, tryDecodeCommitment, type MeshPositionView } from '@bch-intents/wallet-core/mesh/v4';
import { swapServerApiFor } from '@/swap/api';

export * from '@bch-intents/wallet-core/assets';
export * from '@bch-intents/wallet-core/nfts';

const native = nativeAsset;

// ── Bitcoin Cash ──────────────────────────────────────────────────────────────

export async function loadBch(wallet: any, mode: NetworkMode): Promise<Asset[]> {
  const net = networkOf(mode, 'bch');
  const bchNet: BchNet = mode === 'mainnet' ? 'mainnet' : 'chipnet';
  const [sats, tokens] = await Promise.all([
    wallet.getBalance() as Promise<bigint>,
    (wallet.getAllTokenBalances?.() as Promise<Record<string, bigint>> | undefined)?.catch(() => ({})) ?? Promise.resolve({}),
  ]);
  const out: Asset[] = [native(net, BigInt(sats))];
  const held = Object.entries(tokens as Record<string, bigint>).filter(([, amount]) => BigInt(amount) > 0n);
  if (held.length) {
    const metas = await getTokenMetas(held.map(([c]) => c), bchNet);
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

/**
 * The CashToken NFTs the account holds, with BCMR metadata and, where the commitment decodes as a Mesh V4
 * position, the decoded commitment and a best-effort live view. Reads NFT UTXOs from the mainnet-js wallet.
 * Never throws: metadata and the Mesh read are fail-soft, so an NFT always lists even offline.
 */
export async function loadBchNfts(wallet: any, mode: NetworkMode): Promise<NftHolding[]> {
  const net = networkOf(mode, 'bch');
  const bchNet: BchNet = mode === 'mainnet' ? 'mainnet' : 'chipnet';
  const utxos = (await (wallet.getTokenUtxos?.() as Promise<any[]> | undefined)?.catch(() => []) ?? []).filter(u => u?.token?.nft);
  if (!utxos.length) return [];

  const byCategory = new Map<string, string[]>();
  for (const u of utxos) {
    const cat = normalizeCategory(u.token.category);
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), (u.token.nft.commitment ?? '').toLowerCase()]);
  }
  const metasByCategory: Record<string, Awaited<ReturnType<typeof getNftMetas>>> = {};
  await Promise.all([...byCategory].map(async ([cat, commitments]) => { metasByCategory[cat] = await getNftMetas(cat, commitments, bchNet); }));

  const tokenAddress: string | null = wallet.tokenaddr ?? null;
  const positions = tokenAddress ? await meshPositionsHeldBy(tokenAddress, bchNet) : [];
  const posByKey = new Map<string, MeshPositionView>(positions.map(p => [`${normalizeCategory(p.category)}:${(p.nft?.commitment ?? '').toLowerCase()}`, p]));

  return utxos.map(u => {
    const category = normalizeCategory(u.token.category);
    const commitment = (u.token.nft.commitment ?? '').toLowerCase();
    const meta = metasByCategory[category]?.[commitment];
    const decoded = tryDecodeCommitment(commitment);
    const view = posByKey.get(`${category}:${commitment}`) ?? positions.find(p => normalizeCategory(p.category) === category);
    return {
      id: nftId(net, category, commitment),
      network: net,
      category,
      commitment,
      capability: u.token.nft.capability ?? 'none',
      amount: BigInt(u.token.amount ?? 0),
      utxo: { txid: u.txid, vout: u.vout, satoshis: BigInt(u.satoshis ?? 0) },
      name: meta?.name ?? (decoded ? 'Mesh position' : 'NFT'),
      description: meta?.description,
      logo: meta?.icon,
      verified: !!meta?.known,
      ...(decoded ? { position: { commitment: decoded, view: view ?? undefined } } : {}),
    } satisfies NftHolding;
  });
}

// ── EVM ───────────────────────────────────────────────────────────────────────

async function loadEvmNetwork(net: NetworkDef, owner: string): Promise<Asset[]> {
  if (net.nativeIsUsdc) return [native(net, await evmNativeBalance(net, owner))];
  const [gas, usdc] = await Promise.all([
    evmNativeBalance(net, owner),
    net.usdc ? erc20Balance(net, net.usdc, owner).catch(() => 0n) : Promise.resolve(0n),
  ]);
  const out = [native(net, gas)];
  if (net.usdc) {
    out.push({
      id: assetId(net, net.usdc.toLowerCase()), network: net, kind: 'erc20', ref: net.usdc,
      symbol: 'USDC', name: 'USD Coin', decimals: 6, logo: USDC_LOGO, balance: usdc, verified: true,
    });
  }
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

// ── Solana ────────────────────────────────────────────────────────────────────

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
        out.push({ ...native(net, BigInt(b.amount)), usdPrice: b.usdPrice });
        continue;
      }
      if (b.isStock) continue;
      out.push({
        id: assetId(net, b.mint), network: net, kind: 'spl', ref: b.mint,
        symbol: b.symbol ?? `${b.mint.slice(0, 4)}…`, name: b.name ?? 'Unknown token', decimals: b.decimals, logo: b.icon,
        balance: BigInt(b.amount), usdPrice: b.usdPrice, verified: b.verified,
      });
    }
    if (!sawNative) out.unshift(native(net, 0n));
    return out;
  } catch {
    return null;
  }
}

async function loadSolanaFromRpc(net: NetworkDef, owner: string): Promise<Asset[]> {
  const [lamports, holdings] = await Promise.all([solBalance(net, owner), splHoldings(net, owner).catch(() => [])]);
  const out = [native(net, lamports)];
  let sawUsdc = false;
  for (const h of holdings) {
    if (h.mint === NATIVE_SOL_MINT) continue;
    const isUsdc = h.mint === net.usdc;
    sawUsdc ||= isUsdc;
    out.push({
      id: assetId(net, h.mint), network: net, kind: 'spl', ref: h.mint,
      symbol: isUsdc ? 'USDC' : `${h.mint.slice(0, 4)}…`, name: isUsdc ? 'USD Coin' : 'Unknown token',
      decimals: h.decimals, logo: isUsdc ? USDC_LOGO : undefined, balance: h.amount, verified: isUsdc,
    });
  }
  // USDC is always listed: it is what the bridge delivers here.
  if (!sawUsdc && net.usdc) {
    out.push({ id: assetId(net, net.usdc), network: net, kind: 'spl', ref: net.usdc, symbol: 'USDC', name: 'USD Coin', decimals: 6, logo: USDC_LOGO, balance: 0n, verified: true });
  }
  return out;
}

export async function loadSolana(owner: string, mode: NetworkMode): Promise<Asset[]> {
  const net = networkOf(mode, 'solana');
  if (mode === 'mainnet') {
    const fromServer = await loadSolanaFromServer(net, owner);
    if (fromServer) {
      if (net.usdc && !fromServer.some(a => a.ref === net.usdc)) {
        fromServer.push({ id: assetId(net, net.usdc), network: net, kind: 'spl', ref: net.usdc, symbol: 'USDC', name: 'USD Coin', decimals: 6, logo: USDC_LOGO, balance: 0n, verified: true });
      }
      return fromServer;
    }
  }
  return loadSolanaFromRpc(net, owner);
}

// ── Bitcoin ───────────────────────────────────────────────────────────────────

export async function loadBtc(address: string, mode: NetworkMode): Promise<Asset[]> {
  const net = networkOf(mode, 'btc');
  const b = await new EsploraClient(net.rpc).getBalance(address);
  return [native(net, BigInt(b.confirmed + b.unconfirmed))];
}
