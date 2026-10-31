/**
 * The active account's assets on the active network mode, with prices.
 *
 * Replaces the BCH-only BCHWalletProvider: the same polling idea, for every chain family. Each family is loaded
 * on its own, so the list fills in as answers arrive and a family whose RPC is down keeps the rows it had.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useWDK } from '@/context/WDKProvider';
import {
  loadBch, loadBchNfts, loadBtc, loadEvm, loadSolana, sortAssets, valueOf, type Addresses, type Asset,
} from '@/lib/assets';
import { groupNfts, isPosition, type NftGroup, type NftHolding } from '@bch-intents/wallet-core/nfts';
import { fetchPrices, type PriceMap } from '@/lib/prices';
import type { Family, NetworkDef } from '@/lib/chains';
import type { Signers } from '@/lib/send';

interface PortfolioContextType {
  assets: Asset[];
  /** CashToken NFTs the account holds (collectibles and Mesh V4 positions alike). */
  nfts: NftHolding[];
  /** Plain collectibles (not Mesh positions), grouped by category. */
  nftGroups: NftGroup[];
  /** Mesh V4 positions the account holds. */
  positions: NftHolding[];
  /** Total value of held positions at the bids, in satoshis; 0n when nothing priced it. */
  positionValueSats: bigint;
  nftById: (id: string) => NftHolding | undefined;
  prices: PriceMap;
  /** True until the first answer of every family has arrived (or failed). */
  loading: boolean;
  refreshing: boolean;
  /** Families that could not be read on the last round. Their rows, if any, are from an earlier round. */
  stale: Family[];
  /** Total in USD on mainnet; undefined in testnet mode, where funds have no value. */
  totalUsd: number | undefined;
  refresh: () => Promise<void>;
  addresses: Addresses;
  signers: Signers;
  /** The gas asset of a network, for fee checks. */
  nativeOf: (net: NetworkDef) => Asset | undefined;
  findAsset: (id: string) => Asset | undefined;
  lastUpdated: number | null;
}

const PortfolioContext = createContext<PortfolioContextType | null>(null);

const FAMILIES: Family[] = ['bch', 'evm', 'solana', 'btc'];
const POLL_MS = 20_000;

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const wdk = useWDK();
  const mode = wdk.networkMode;

  const [byFamily, setByFamily] = useState<Partial<Record<Family, Asset[]>>>({});
  const [nfts, setNfts] = useState<NftHolding[]>([]);
  const [prices, setPrices] = useState<PriceMap>({});
  const [stale, setStale] = useState<Family[]>([]);
  const [pending, setPending] = useState<Family[]>(FAMILIES);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const addresses: Addresses = useMemo(() => ({
    bch: wdk.bchAddress, evm: wdk.evmAddress, solana: wdk.solanaAddress, btc: wdk.activeBtcAddress,
  }), [wdk.bchAddress, wdk.evmAddress, wdk.solanaAddress, wdk.activeBtcAddress]);

  const signers: Signers = useMemo(() => ({
    bchWallet: wdk.bchWallet,
    evmSigner: wdk.evmSigner,
    solanaSecretKey: wdk.solanaSigner?.secretKey ?? null,
    btcAccount: wdk.activeBtcAccount,
    addresses,
  }), [wdk.bchWallet, wdk.evmSigner, wdk.solanaSigner, wdk.activeBtcAccount, addresses]);

  // A round belongs to one account on one mode. An answer that arrives after either changed is dropped.
  const scope = `${mode}|${addresses.bch}|${addresses.evm}|${addresses.solana}|${addresses.btc}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const loadFamily = useCallback(async (family: Family, forScope: string) => {
    const settle = (rows: Asset[] | null) => {
      if (scopeRef.current !== forScope) return;
      setPending(p => p.filter(f => f !== family));
      if (rows) {
        setByFamily(prev => ({ ...prev, [family]: rows }));
        setStale(s => s.filter(f => f !== family));
      } else {
        setStale(s => (s.includes(family) ? s : [...s, family]));
      }
    };
    try {
      if (family === 'bch') {
        // NFTs read from the same wallet; a failure keeps the previous list and never blanks the tokens.
        if (wdk.bchWallet) loadBchNfts(wdk.bchWallet, mode).then(rows => { if (scopeRef.current === forScope) setNfts(rows); }).catch(() => {});
        return settle(wdk.bchWallet ? await loadBch(wdk.bchWallet, mode) : []);
      }
      if (family === 'solana') return settle(addresses.solana ? await loadSolana(addresses.solana, mode) : []);
      if (family === 'btc') return settle(addresses.btc ? await loadBtc(addresses.btc, mode) : []);
      if (!addresses.evm) return settle([]);
      const { assets, failed } = await loadEvm(addresses.evm, mode);
      if (scopeRef.current !== forScope) return;
      setPending(p => p.filter(f => f !== 'evm'));
      // Keep the previous rows of a network that failed this round; replace the rest.
      setByFamily(prev => ({ ...prev, evm: [...assets, ...(prev.evm ?? []).filter(a => failed.includes(a.network.key))] }));
      setStale(s => (failed.length ? (s.includes('evm') ? s : [...s, 'evm']) : s.filter(f => f !== 'evm')));
    } catch {
      settle(null);
    }
  }, [wdk.bchWallet, mode, addresses]);

  const refresh = useCallback(async () => {
    if (!wdk.isInitialized) return;
    const forScope = scopeRef.current;
    setRefreshing(true);
    await Promise.all([
      ...FAMILIES.map(f => loadFamily(f, forScope)),
      fetchPrices().then(p => { if (scopeRef.current === forScope) setPrices(p); }),
    ]);
    if (scopeRef.current === forScope) setLastUpdated(Date.now());
    setRefreshing(false);
  }, [wdk.isInitialized, loadFamily]);

  // New account or mode: start empty, then load.
  useEffect(() => {
    setByFamily({});
    setNfts([]);
    setStale([]);
    setPending(FAMILIES);
    setLastUpdated(null);
  }, [scope]);

  useEffect(() => {
    if (!wdk.isInitialized) return;
    refresh();
    const tick = () => { if (document.visibilityState === 'visible') refresh(); };
    const interval = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', tick); };
  }, [wdk.isInitialized, refresh]);

  const assets = useMemo(
    () => sortAssets(FAMILIES.flatMap(f => byFamily[f] ?? []), prices),
    [byFamily, prices],
  );

  const totalUsd = useMemo(() => {
    if (mode !== 'mainnet') return undefined;
    return assets.reduce((sum, a) => sum + (valueOf(a, prices) ?? 0), 0);
  }, [assets, prices, mode]);

  // The background worker answers a dapp's bch_getBalance from here, without waking the wallet UI.
  const bchSats = byFamily.bch?.find(a => a.kind === 'native')?.balance;
  useEffect(() => {
    if (bchSats !== undefined) chrome.storage.local.set({ bch_active_balance: Number(bchSats) });
  }, [bchSats]);

  const nativeOf = useCallback((net: NetworkDef) => assets.find(a => a.network.key === net.key && a.kind === 'native'), [assets]);
  const findAsset = useCallback((id: string) => assets.find(a => a.id === id), [assets]);

  const positions = useMemo(() => nfts.filter(isPosition), [nfts]);
  const nftGroups = useMemo(() => groupNfts(nfts.filter(n => !isPosition(n))), [nfts]);
  const positionValueSats = useMemo(
    () => positions.reduce((sum, p) => sum + BigInt(p.position?.view?.totals.valueAtBidSats ?? '0'), 0n),
    [positions],
  );
  const nftById = useCallback((id: string) => nfts.find(n => n.id === id), [nfts]);

  const value: PortfolioContextType = {
    assets, nfts, nftGroups, positions, positionValueSats, nftById, prices,
    loading: pending.length > 0 && assets.length === 0,
    refreshing, stale, totalUsd, refresh, addresses, signers, nativeOf, findAsset, lastUpdated,
  };
  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

export function usePortfolio() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error('usePortfolio must be used within PortfolioProvider');
  return ctx;
}
