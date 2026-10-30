import React, { createContext, useContext, useState, useEffect } from 'react';
import { MOCK_POOLS, type MeshPool } from '@/lib/meshApi';

export type AppSubTab = 'pools' | 'liquidity' | 'strategies' | 'portfolio' | 'intents' | 'inspector';

export interface PositionItem {
  id: string;
  name: string;
  template: string;
  pair: string;
  depositBch: number;
  depositTokens: number;
  tokenSymbol: string;
  valueUsd: number;
  pnlUsd: number;
  feesEarnedSats: number;
  status: 'optimal' | 'rebalancing' | 'out-of-range';
  minPrice: number;
  maxPrice: number;
  currentPrice: number;
  recyclesCount: number;
  createdAt: number;
}

interface MeshAppContextType {
  subTab: AppSubTab;
  setSubTab: (t: AppSubTab) => void;
  isDemoMode: boolean;
  toggleDemoMode: () => void;
  walletConnected: boolean;
  walletAddress: string | null;
  connectWallet: (type?: string) => void;
  disconnectWallet: () => void;
  bchBalance: number;
  tokenBalances: Record<string, number>;
  positions: PositionItem[];
  addPosition: (pos: Omit<PositionItem, 'id' | 'createdAt' | 'recyclesCount' | 'feesEarnedSats' | 'pnlUsd'>) => void;
  dockPosition: (id: string) => void;
  claimFees: (id: string) => void;
  selectedPool: MeshPool | null;
  setSelectedPool: (p: MeshPool | null) => void;
  selectedTemplate: string | null;
  setSelectedTemplate: (t: string | null) => void;
  network: 'chipnet' | 'mainnet' | 'demo';
  setNetwork: (n: 'chipnet' | 'mainnet' | 'demo') => void;
}

const MeshAppContext = createContext<MeshAppContextType | undefined>(undefined);

export function MeshAppProvider({ children }: { children: React.ReactNode }) {
  const [subTab, setSubTab] = useState<AppSubTab>('pools');
  const [isDemoMode, setIsDemoMode] = useState<boolean>(true);
  const [network, setNetwork] = useState<'chipnet' | 'mainnet' | 'demo'>('chipnet');
  const [walletConnected, setWalletConnected] = useState<boolean>(true);
  const [walletAddress, setWalletAddress] = useState<string | null>('bchtest:qp8z4demo...72a9');

  const [bchBalance, setBchBalance] = useState<number>(12.50);
  const [tokenBalances, setTokenBalances] = useState<Record<string, number>>({
    pUSD: 45000,
    mUSD: 12000,
    MESH: 3250,
  });

  const [selectedPool, setSelectedPool] = useState<MeshPool | null>(MOCK_POOLS[0]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>('recycling-pair');

  const [positions, setPositions] = useState<PositionItem[]>([
    {
      id: 'stg-alpha-01',
      name: 'BCH/pUSD High Yield Recycler',
      template: 'recycling-pair',
      pair: 'BCH / pUSD',
      depositBch: 2.50,
      depositTokens: 893.12,
      tokenSymbol: 'pUSD',
      valueUsd: 1786.25,
      pnlUsd: 64.30,
      feesEarnedSats: 14200,
      status: 'optimal',
      minPrice: 345.0,
      maxPrice: 370.0,
      currentPrice: 357.25,
      recyclesCount: 18,
      createdAt: Date.now() - 86400000 * 3,
    },
    {
      id: 'stg-alpha-02',
      name: 'pUSD/mUSD Stable Anchor',
      template: 'stable-pair',
      pair: 'pUSD / mUSD',
      depositBch: 0.10,
      depositTokens: 5000,
      tokenSymbol: 'mUSD',
      valueUsd: 5035.0,
      pnlUsd: 28.50,
      feesEarnedSats: 7900,
      status: 'optimal',
      minPrice: 0.996,
      maxPrice: 1.004,
      currentPrice: 1.002,
      recyclesCount: 42,
      createdAt: Date.now() - 86400000 * 7,
    },
    {
      id: 'stg-alpha-03',
      name: 'BCH/MESH Volatility Harvester',
      template: 'grid',
      pair: 'BCH / MESH',
      depositBch: 1.80,
      depositTokens: 2232,
      tokenSymbol: 'MESH',
      valueUsd: 1286.0,
      pnlUsd: 91.20,
      feesEarnedSats: 25400,
      status: 'rebalancing',
      minPrice: 1180.0,
      maxPrice: 1320.0,
      currentPrice: 1240.0,
      recyclesCount: 9,
      createdAt: Date.now() - 86400000 * 1,
    },
  ]);

  useEffect(() => {
    if (!isDemoMode) return;
    const interval = setInterval(() => {
      setPositions(prev =>
        prev.map(p => ({
          ...p,
          feesEarnedSats: p.feesEarnedSats + Math.floor(Math.random() * 80 + 20),
          pnlUsd: +(p.pnlUsd + Math.random() * 0.15).toFixed(2),
        }))
      );
    }, 10000);
    return () => clearInterval(interval);
  }, [isDemoMode]);

  const toggleDemoMode = () => setIsDemoMode(v => !v);
  const connectWallet = () => {
    setWalletConnected(true);
    setWalletAddress('bchtest:qp8z4demo...72a9');
  };
  const disconnectWallet = () => {
    setWalletConnected(false);
    setWalletAddress(null);
  };

  const addPosition = (pos: Omit<PositionItem, 'id' | 'createdAt' | 'recyclesCount' | 'feesEarnedSats' | 'pnlUsd'>) => {
    const newPos: PositionItem = {
      ...pos,
      id: 'stg-' + Math.random().toString(36).substring(2, 9),
      recyclesCount: 0,
      feesEarnedSats: 0,
      pnlUsd: 0,
      createdAt: Date.now(),
    };
    setPositions(prev => [newPos, ...prev]);
    setBchBalance(b => Math.max(0, +(b - pos.depositBch).toFixed(4)));
    if (pos.depositTokens > 0) {
      setTokenBalances(tb => ({
        ...tb,
        [pos.tokenSymbol]: Math.max(0, +((tb[pos.tokenSymbol] ?? 0) - pos.depositTokens).toFixed(2)),
      }));
    }
  };

  const dockPosition = (id: string) => {
    const pos = positions.find(p => p.id === id);
    if (pos) {
      setBchBalance(b => +(b + pos.depositBch).toFixed(4));
      setPositions(prev => prev.filter(p => p.id !== id));
    }
  };

  const claimFees = (id: string) => {
    setPositions(prev =>
      prev.map(p => {
        if (p.id === id) {
          const sats = p.feesEarnedSats;
          setBchBalance(b => +(b + sats / 1e8).toFixed(6));
          return { ...p, feesEarnedSats: 0 };
        }
        return p;
      })
    );
  };

  return (
    <MeshAppContext.Provider
      value={{
        subTab,
        setSubTab,
        isDemoMode,
        toggleDemoMode,
        walletConnected,
        walletAddress,
        connectWallet,
        disconnectWallet,
        bchBalance,
        tokenBalances,
        positions,
        addPosition,
        dockPosition,
        claimFees,
        selectedPool,
        setSelectedPool,
        selectedTemplate,
        setSelectedTemplate,
        network,
        setNetwork,
      }}
    >
      {children}
    </MeshAppContext.Provider>
  );
}

export function useMeshApp() {
  const ctx = useContext(MeshAppContext);
  if (!ctx) throw new Error('useMeshApp must be used within MeshAppProvider');
  return ctx;
}
