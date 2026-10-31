/**
 * What the active account holds: its addresses, its assets with balances, and prices.
 *
 * One provider under the unlocked part of the app. It reloads when the account or the network mode changes,
 * every 30 seconds while the app is in front, and when a screen asks (pull to refresh, after a send).
 *
 * A family whose read fails keeps its previous rows and is named in `stale`, so one unreachable server shows as
 * a notice and not as an empty wallet.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { FAMILIES, getNetwork, networkOf, networksOf, type Family, type NetworkDef, type NetworkMode } from '@bch-intents/wallet-core/chains';
import { sortAssets, type Addresses, type Asset } from '@bch-intents/wallet-core/assets';
import { groupNfts, isPosition, type NftGroup, type NftHolding } from '@bch-intents/wallet-core/nfts';
import { fetchPrices, type PriceMap } from '@bch-intents/wallet-core/prices';
import { isSnapshot, type WalletSnapshot } from '@bch-intents/wallet-core/agent';
import { addressOf, call } from '@/wdk/bridge';
import { loadBch, loadBchNfts, loadBtc, loadEvm, loadSolana } from '@/lib/assets';
import { vaultRead } from '@/agent/vault';
import { useAccounts } from './accounts';
import { useSettingsStore } from './settings';

export interface WalletAddresses extends Addresses {
  /** The token-aware form of the BCH address (starts with z), for receiving CashTokens. */
  bchToken: string | null;
}

interface PortfolioValue {
  mode: NetworkMode;
  isMainnet: boolean;
  accountIndex: number;
  addresses: WalletAddresses;
  /** Sorted for display; includes rows with a zero balance. */
  assets: Asset[];
  /** CashToken NFTs the account holds (collectibles and Mesh V4 positions alike). */
  nfts: NftHolding[];
  /** NFTs that are plain collectibles (not Mesh positions), grouped by category for the list. */
  nftGroups: NftGroup[];
  /** Mesh V4 positions the account holds (NFTs whose commitment decoded). */
  positions: NftHolding[];
  /** Total value of the held positions at the bids, in satoshis; 0n when nothing priced it. */
  positionValueSats: bigint;
  prices: PriceMap;
  loading: boolean;
  refreshing: boolean;
  /** True when balances are restored from the saved offline snapshot because network is unavailable. */
  isOfflineSnapshot: boolean;
  /** Timestamp when the offline snapshot was captured. */
  snapshotAt: number | null;
  /** Unverified tokens beyond the per-network cap: counted, not loaded. */
  spamDropped: number;
  /** Names of the families whose last read failed. */
  stale: Family[];
  /** An address could not be derived: the worklet is not answering. */
  addressError: boolean;
  refresh: () => Promise<void>;
  nativeOf: (net: NetworkDef) => Asset | undefined;
  assetById: (id: string) => Asset | undefined;
  nftById: (id: string) => NftHolding | undefined;
}

const NO_ADDRESSES: WalletAddresses = { bch: null, bchToken: null, evm: null, solana: null, btc: null };

const PortfolioContext = createContext<PortfolioValue | null>(null);

export function usePortfolio(): PortfolioValue {
  const value = useContext(PortfolioContext);
  if (!value) throw new Error('usePortfolio is used outside the unlocked part of the app');
  return value;
}

const REFRESH_MS = 30_000;

/**
 * An address on a busy chain collects thousands of spam airdrops (seen: 7,500 on one wallet). Each network keeps
 * at most this many rows — native coins, verified and priced tokens first — and only counts the rest, so loading,
 * sorting and drawing stay light.
 */
export const MAX_ROWS_PER_FAMILY = 200;

function capRows(rows: Asset[]): { kept: Asset[]; dropped: number } {
  if (rows.length <= MAX_ROWS_PER_FAMILY) return { kept: rows, dropped: 0 };
  const rank = (a: Asset) => (a.kind === 'native' ? 0 : a.verified ? 1 : a.usdPrice ? 2 : 3);
  const kept = [...rows].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_ROWS_PER_FAMILY);
  return { kept, dropped: rows.length - kept.length };
}

function reconstructAssetsFromSnapshot(snapshot: WalletSnapshot): Partial<Record<Family, Asset[]>> {
  const result: Partial<Record<Family, Asset[]>> = {};
  for (const s of snapshot.assets) {
    const net = getNetwork(s.network) ?? networkOf(snapshot.mode, s.family as any);
    if (!net) continue;
    const asset: Asset = {
      id: s.id,
      network: net,
      kind: s.kind,
      ref: s.ref,
      symbol: s.symbol,
      name: s.name,
      decimals: s.decimals,
      balance: BigInt(s.balance),
      verified: true,
      usdPrice: s.usd,
    };
    const fam = s.family;
    if (!result[fam]) result[fam] = [];
    result[fam]!.push(asset);
  }
  return result;
}

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const mode = useSettingsStore(s => s.settings.mode);
  const accountIndex = useAccounts(s => s.active);

  const [addresses, setAddresses] = useState<WalletAddresses>(NO_ADDRESSES);
  const [byFamily, setByFamily] = useState<Partial<Record<Family, Asset[]>>>({});
  const [nfts, setNfts] = useState<NftHolding[]>([]);
  const [dropped, setDropped] = useState<Partial<Record<Family, number>>>({});
  const [prices, setPrices] = useState<PriceMap>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState<Family[]>([]);
  const [addressError, setAddressError] = useState(false);
  const [isOfflineSnapshot, setIsOfflineSnapshot] = useState(false);
  const [snapshotAt, setSnapshotAt] = useState<number | null>(null);

  // Which account and mode a running load belongs to: an answer for an earlier one is dropped.
  const generation = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);

  const load = useCallback(async (gen: number, known?: WalletAddresses) => {
    const bch = networkOf(mode, 'bch'), sol = networkOf(mode, 'solana'), btc = networkOf(mode, 'btc');
    const evm = networksOf(mode, 'evm')[0];

    let addr = known;
    if (!addr) {
      const [a, token, e, s, b] = await Promise.all([
        addressOf(bch.key, accountIndex).catch(() => null),
        call<string>(bch.key, accountIndex, 'getTokenAddress').catch(() => null),
        addressOf(evm.key, accountIndex).catch(() => null),
        addressOf(sol.key, accountIndex).catch(() => null),
        addressOf(btc.key, accountIndex).catch(() => null),
      ]);
      addr = { bch: a, bchToken: token, evm: e, solana: s, btc: b };
      if (gen !== generation.current) return;
      setAddresses(addr);
      setAddressError(!a && !e && !s && !b);
    }

    fetchPrices().then(p => { if (gen === generation.current) setPrices(p); }).catch(() => {});

    const failed: Family[] = [];
    const put = (family: Family, rows: Asset[]) => {
      const { kept, dropped: n } = capRows(rows);
      if (n) console.log('[wallet]', family, mode, 'rows', rows.length, 'kept', kept.length);
      if (gen !== generation.current) return;
      setByFamily(prev => ({ ...prev, [family]: kept }));
      setDropped(prev => (prev[family] === n ? prev : { ...prev, [family]: n }));
    };
    await Promise.all([
      addr.bch ? loadBch(accountIndex, mode).then(rows => put('bch', rows)).catch(() => { failed.push('bch'); }) : Promise.resolve(),
      // NFTs are read from the same wallet; a failure keeps the previous list and never blanks the tokens.
      addr.bch ? loadBchNfts(accountIndex, mode, addr.bchToken).then(rows => { if (gen === generation.current) setNfts(rows); }).catch(() => {}) : Promise.resolve(),
      addr.evm ? loadEvm(addr.evm, mode).then(({ assets, failed: nets }) => {
        if (gen !== generation.current) return;
        // Keep the rows of a network that did not answer, replace the ones that did.
        setByFamily(prev => ({ ...prev, evm: [...(prev.evm ?? []).filter(a => nets.includes(a.network.key)), ...assets] }));
        if (nets.length) failed.push('evm');
      }).catch(() => { failed.push('evm'); }) : Promise.resolve(),
      addr.solana ? loadSolana(addr.solana, mode).then(rows => put('solana', rows)).catch(() => { failed.push('solana'); }) : Promise.resolve(),
      addr.btc ? loadBtc(accountIndex, mode).then(rows => put('btc', rows)).catch(() => { failed.push('btc'); }) : Promise.resolve(),
    ]);
    if (gen === generation.current) {
      setStale(FAMILIES.filter(f => failed.includes(f)));
      if (failed.length < FAMILIES.length) {
        setIsOfflineSnapshot(false);
      }
    }
  }, [mode, accountIndex]);

  // A new account or mode: immediately check snapshot cache for offline/instant display, then load fresh.
  useEffect(() => {
    const gen = ++generation.current;
    setAddresses(NO_ADDRESSES);
    setDropped({});
    setNfts([]);
    setStale([]);
    setLoading(true);

    vaultRead<unknown>('snapshot', null).then(cached => {
      if (gen !== generation.current) return;
      if (isSnapshot(cached) && cached.mode === mode && cached.accountIndex === accountIndex && cached.assets.length > 0) {
        setByFamily(prev => {
          const hasReal = Object.values(prev).some(arr => (arr?.length ?? 0) > 0);
          return hasReal ? prev : reconstructAssetsFromSnapshot(cached);
        });
        setPrices(prev => {
          if (Object.keys(prev).length > 0) return prev;
          const p: PriceMap = {};
          for (const [sym, usd] of Object.entries(cached.usd)) {
            p[sym] = { usd, change24h: 0 };
          }
          return p;
        });
        setIsOfflineSnapshot(true);
        setSnapshotAt(cached.at);
        setLoading(false);
      }
    }).catch(() => {});

    const run = load(gen).finally(() => { if (gen === generation.current) setLoading(false); });
    inFlight.current = run;
  }, [load, mode, accountIndex]);

  const addressesRef = useRef(addresses);
  addressesRef.current = addresses;

  const refresh = useCallback(async () => {
    const gen = generation.current;
    if (inFlight.current) await inFlight.current.catch(() => {});
    if (gen !== generation.current) return;
    setRefreshing(true);
    const known = addressesRef.current.evm || addressesRef.current.bch ? addressesRef.current : undefined;
    const run = load(gen, known).finally(() => { if (gen === generation.current) setRefreshing(false); });
    inFlight.current = run;
    await run;
  }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!timer) timer = setInterval(() => { refresh().catch(() => {}); }, REFRESH_MS); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') { refresh().catch(() => {}); start(); } else stop();
    });
    return () => { stop(); sub.remove(); };
  }, [refresh]);

  const assets = useMemo(() => sortAssets(FAMILIES.flatMap(f => byFamily[f] ?? []), prices), [byFamily, prices]);

  const spamDropped = useMemo(() => Object.values(dropped).reduce((a, b) => a + (b ?? 0), 0), [dropped]);
  const positions = useMemo(() => nfts.filter(isPosition), [nfts]);
  const nftGroups = useMemo(() => groupNfts(nfts.filter(n => !isPosition(n))), [nfts]);
  const positionValueSats = useMemo(
    () => positions.reduce((sum, p) => sum + BigInt(p.position?.view?.totals.valueAtBidSats ?? '0'), 0n),
    [positions],
  );

  const value = useMemo<PortfolioValue>(() => ({
    mode, isMainnet: mode === 'mainnet', accountIndex, addresses, assets, nfts, nftGroups, positions, positionValueSats, prices, loading, refreshing, isOfflineSnapshot, snapshotAt, stale, addressError, refresh, spamDropped,
    nativeOf: net => assets.find(a => a.network.key === net.key && a.kind === 'native'),
    assetById: id => assets.find(a => a.id === id),
    nftById: id => nfts.find(n => n.id === id),
  }), [mode, accountIndex, addresses, assets, nfts, nftGroups, positions, positionValueSats, prices, loading, refreshing, isOfflineSnapshot, snapshotAt, stale, addressError, refresh, spamDropped]);

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

/** The address of the active account on a network. */
export function addressFor(addresses: WalletAddresses, net: NetworkDef): string | null {
  return addresses[net.family];
}
