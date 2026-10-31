import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowDownUp,
  Wallet,
  TrendingUp,
  Coins,
  ChevronDown,
  ArrowRight,
  CheckCircle2,
  Shield,
  Zap,
  BarChart3,
} from 'lucide-react';
import { useChamTheme } from '@/context/ChamThemeContext';

/* ─────────────────── Shared Status Bar ─────────────────── */
function PhoneStatusBar() {
  return (
    <div className="flex items-center justify-between px-5 pt-8 pb-1.5 text-[9px] font-semibold text-white/60">
      <span>9:41</span>
      <div className="flex items-center gap-1">
        <div className="flex gap-[2px]">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className={cn('w-[3px] rounded-[1px]', i <= 3 ? 'bg-white/60' : 'bg-white/20')}
              style={{ height: 4 + i * 2 }}
            />
          ))}
        </div>
        <span className="ml-1">5G</span>
        <div className="w-5 h-2.5 rounded-[2px] border border-white/40 relative ml-0.5">
          <div className="absolute inset-[1px] right-[3px] bg-emerald-400 rounded-[1px]" />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── Bottom Tab Bar ─────────────────── */
function PhoneTabBar({ activeTab, onTabChange }: { activeTab: string; onTabChange: (tab: string) => void }) {
  const { activeColor } = useChamTheme();
  const tabs = [
    { id: 'swap', icon: ArrowDownUp, label: 'Swap' },
    { id: 'portfolio', icon: Wallet, label: 'Portfolio' },
    { id: 'earn', icon: TrendingUp, label: 'Earn' },
    { id: 'tokens', icon: Coins, label: 'Tokens' },
  ];

  return (
    <div className="flex items-center justify-around px-2 py-2 bg-zinc-900/90 backdrop-blur-xl border-t border-white/5">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-all duration-200',
              active ? 'text-white font-bold' : 'text-zinc-500 hover:text-zinc-300'
            )}
            style={active ? { color: activeColor.hex } : undefined}
          >
            <Icon className="w-4 h-4" />
            <span className="text-[8px]">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────── Screen: Swap ─────────────────── */
export function ScreenSwap() {
  const { activeColor } = useChamTheme();
  return (
    <div className="flex-1 flex flex-col px-4 py-3 gap-2.5">
      <div className="text-center">
        <h3 className="text-sm font-bold text-white">Cross-Chain Swap</h3>
        <p className="text-[8px] text-zinc-500">Intent-based · Solver Competition</p>
      </div>

      {/* From Token */}
      <div className="bg-zinc-900 rounded-2xl p-3 border border-white/5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] text-zinc-500 font-medium">You Pay</span>
          <span className="text-[8px] text-zinc-500">Balance: 2.45 BCH</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold text-white">1.00</span>
          <div className="flex items-center gap-1.5 bg-zinc-800 rounded-xl px-2.5 py-1.5 border border-white/5">
            <img src="/logos/bitcoin-cash-bch-logo.svg" alt="BCH" className="w-4 h-4" />
            <span className="text-xs font-bold text-white">BCH</span>
            <ChevronDown className="w-3 h-3 text-zinc-400" />
          </div>
        </div>
        <div className="text-right text-[8px] text-zinc-500 mt-1">≈ $382.50</div>
      </div>

      {/* Swap Arrow */}
      <div className="flex justify-center -my-1.5 z-10">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center border"
          style={{
            background: `${activeColor.hex}15`,
            borderColor: `${activeColor.hex}40`,
          }}
        >
          <ArrowDownUp className="w-3.5 h-3.5" style={{ color: activeColor.hex }} />
        </div>
      </div>

      {/* To Token */}
      <div className="bg-zinc-900 rounded-2xl p-3 border border-white/5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] text-zinc-500 font-medium">You Receive</span>
          <span className="text-[8px] text-zinc-500">Balance: 0.00 SOL</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold" style={{ color: activeColor.hex }}>
            2.648
          </span>
          <div className="flex items-center gap-1.5 bg-zinc-800 rounded-xl px-2.5 py-1.5 border border-white/5">
            <img src="/assets/solanaLogo.png" alt="SOL" className="w-4 h-4" />
            <span className="text-xs font-bold text-white">SOL</span>
            <ChevronDown className="w-3 h-3 text-zinc-400" />
          </div>
        </div>
        <div className="text-right text-[8px] text-zinc-500 mt-1">≈ $382.34</div>
      </div>

      {/* Route Info */}
      <div className="bg-zinc-900/50 rounded-xl px-3 py-2 border border-white/5 space-y-1">
        <div className="flex items-center justify-between text-[8px]">
          <span className="text-zinc-500">Route</span>
          <span className="font-medium flex items-center gap-1" style={{ color: activeColor.hex }}>
            <Zap className="w-2.5 h-2.5" /> P2P via Nostr
          </span>
        </div>
        <div className="flex items-center justify-between text-[8px]">
          <span className="text-zinc-500">Settlement</span>
          <span className="text-white font-medium flex items-center gap-1">
            <Shield className="w-2.5 h-2.5 text-emerald-400" /> Atomic HTLC
          </span>
        </div>
        <div className="flex items-center justify-between text-[8px]">
          <span className="text-zinc-500">Solver Quote</span>
          <span className="text-white font-medium">Best of 3 solvers</span>
        </div>
      </div>

      {/* CTA */}
      <button
        className="w-full py-2.5 rounded-2xl text-sm font-bold text-black flex items-center justify-center gap-1.5 mt-auto shadow-md"
        style={{
          background: `linear-gradient(to right, ${activeColor.hex}, color-mix(in srgb, ${activeColor.hex} 80%, #ffffff))`,
        }}
      >
        Sign Intent <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/* ─────────────────── Screen: Portfolio ─────────────────── */
export function ScreenPortfolio() {
  const { activeColor } = useChamTheme();
  const assets = [
    { symbol: 'BCH', name: 'Bitcoin Cash', icon: '/logos/bitcoin-cash-bch-logo.svg', balance: '2.45', usd: '$937.13', change: '+5.2%', positive: true },
    { symbol: 'SOL', name: 'Solana', icon: '/assets/solanaLogo.png', balance: '12.80', usd: '$1,850.24', change: '+8.1%', positive: true },
    { symbol: 'ETH', name: 'Ethereum', icon: '/logos/ethereum-eth-logo.svg', balance: '0.85', usd: '$2,104.50', change: '-1.3%', positive: false },
    { symbol: 'USDC', name: 'USD Coin', icon: '/logos/usd-coin-usdc-logo.svg', balance: '812', usd: '$812.00', change: '+0.0%', positive: true },
  ];

  return (
    <div className="flex-1 flex flex-col px-4 py-3 gap-3">
      {/* Total Balance */}
      <div className="text-center py-2">
        <p className="text-[9px] text-zinc-500 font-medium uppercase tracking-wider mb-1">Total Balance</p>
        <h2 className="text-2xl font-black text-white tracking-tight">$5,703.97</h2>
        <div className="flex items-center justify-center gap-1 mt-1">
          <TrendingUp className="w-3 h-3 text-emerald-400" />
          <span className="text-[10px] font-bold text-emerald-400">+$284.12 (12.4%)</span>
          <span className="text-[8px] text-zinc-500 ml-0.5">24h</span>
        </div>
      </div>

      {/* Chain pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {['All', 'BCH', 'SOL', 'ETH'].map((chain, i) => (
          <button
            key={chain}
            className={cn(
              'px-2.5 py-1 rounded-full text-[8px] font-bold whitespace-nowrap border transition-all shrink-0',
              i === 0
                ? 'bg-white/10 text-white border-white/20'
                : 'bg-zinc-900 text-zinc-400 border-white/5 hover:border-white/10'
            )}
            style={i === 0 ? { color: activeColor.hex, borderColor: `${activeColor.hex}40` } : undefined}
          >
            {chain}
          </button>
        ))}
      </div>

      {/* Mini Chart */}
      <div className="h-14 bg-zinc-900/50 rounded-xl border border-white/5 flex items-end px-2 py-1.5 gap-[2px]">
        {[30, 45, 35, 50, 42, 60, 55, 70, 65, 72, 68, 78, 75, 82, 80, 85].map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm"
            style={{
              height: `${h}%`,
              background: `linear-gradient(to top, ${activeColor.hex}66, ${activeColor.hex}22)`,
            }}
          />
        ))}
      </div>

      {/* Asset List */}
      <div className="flex flex-col gap-1.5 flex-1 overflow-y-auto">
        {assets.map((asset) => (
          <div key={asset.symbol} className="flex items-center gap-2.5 p-2 rounded-xl bg-zinc-900/50 border border-white/5">
            <img src={asset.icon} alt={asset.symbol} className="w-6 h-6 shrink-0 rounded-full object-contain" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-white">{asset.symbol}</span>
                <span className="text-[10px] font-bold text-white">{asset.usd}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[8px] text-zinc-500">{asset.balance}</span>
                <span className={cn('text-[8px] font-semibold', asset.positive ? 'text-emerald-400' : 'text-red-400')}>
                  {asset.change}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────── Screen: Earn ─────────────────── */
export function ScreenEarn() {
  const { activeColor } = useChamTheme();
  const pools = [
    { pair: 'BCH / USDC', apy: '24.8%', tvl: '$1.2M', myStake: '$450.00', icon1: '/logos/bitcoin-cash-bch-logo.svg', icon2: '/logos/usd-coin-usdc-logo.svg' },
    { pair: 'BCH / SOL', apy: '18.2%', tvl: '$890K', myStake: '$200.00', icon1: '/logos/bitcoin-cash-bch-logo.svg', icon2: '/assets/solanaLogo.png' },
  ];

  return (
    <div className="flex-1 flex flex-col px-4 py-3 gap-3">
      <div className="text-center">
        <h3 className="text-sm font-bold text-white">Earn Yield</h3>
        <p className="text-[8px] text-zinc-500">Liquidity Pools & Solvers</p>
      </div>

      {/* Yield Summary */}
      <div
        className="rounded-2xl p-3 border"
        style={{
          background: `radial-gradient(ellipse at top left, ${activeColor.hex}15 0%, rgba(20,20,25,0.8) 100%)`,
          borderColor: `${activeColor.hex}30`,
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] text-zinc-400 font-medium">Total Earned</span>
          <span className="text-[8px] font-bold flex items-center gap-1" style={{ color: activeColor.hex }}>
            <BarChart3 className="w-2.5 h-2.5" /> Compounding
          </span>
        </div>
        <div className="text-xl font-black" style={{ color: activeColor.hex }}>$42.18</div>
        <div className="text-[8px] text-zinc-500 mt-0.5">Across 2 active positions</div>
      </div>

      {/* Pool cards */}
      <div className="flex flex-col gap-2 flex-1">
        {pools.map((pool) => (
          <div key={pool.pair} className="bg-zinc-900 rounded-2xl p-3 border border-white/5">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex -space-x-1.5">
                <img src={pool.icon1} alt="" className="w-5 h-5 rounded-full border border-zinc-800 object-contain" />
                <img src={pool.icon2} alt="" className="w-5 h-5 rounded-full border border-zinc-800 object-contain" />
              </div>
              <span className="text-[10px] font-bold text-white">{pool.pair}</span>
              <span
                className="ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: `${activeColor.hex}15`, color: activeColor.hex }}
              >
                {pool.apy} APY
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[7px] text-zinc-500 block">TVL</span>
                <span className="text-[9px] font-bold text-white">{pool.tvl}</span>
              </div>
              <div>
                <span className="text-[7px] text-zinc-500 block">My Stake</span>
                <span className="text-[9px] font-bold text-white">{pool.myStake}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <button
        className="w-full py-2.5 rounded-2xl text-sm font-bold text-black flex items-center justify-center gap-1.5"
        style={{
          background: `linear-gradient(to right, ${activeColor.hex}, color-mix(in srgb, ${activeColor.hex} 80%, #ffffff))`,
        }}
      >
        Add Liquidity <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/* ─────────────────── Screen: CashTokens ─────────────────── */
export function ScreenCashTokens() {
  const { activeColor } = useChamTheme();
  const tokens = [
    { name: 'FURU', type: 'Fungible', amount: '10,000', usd: '$48.20', color: 'text-violet-400' },
    { name: 'BCHN', type: 'Fungible', amount: '5,000', usd: '$125.00', color: 'text-cyan-400' },
    { name: 'CHAM NFT', type: 'NFT', amount: '×1', usd: '--', color: 'text-emerald-400' },
  ];

  return (
    <div className="flex-1 flex flex-col px-4 py-3 gap-3">
      <div className="text-center">
        <h3 className="text-sm font-bold text-white">CashTokens</h3>
        <p className="text-[8px] text-zinc-500">Native UTXO Tokens on Bitcoin Cash</p>
      </div>

      {/* Categories */}
      <div className="flex items-center gap-2">
        <button
          className="flex-1 py-1.5 rounded-xl text-[9px] font-bold border"
          style={{
            background: `${activeColor.hex}15`,
            color: activeColor.hex,
            borderColor: `${activeColor.hex}40`,
          }}
        >
          Fungible
        </button>
        <button className="flex-1 py-1.5 rounded-xl text-[9px] font-bold bg-zinc-900 text-zinc-400 border border-white/5">
          NFTs
        </button>
      </div>

      {/* Token list */}
      <div className="flex flex-col gap-1.5 flex-1">
        {tokens.map((token) => (
          <div key={token.name} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-zinc-900/50 border border-white/5">
            <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black', 'bg-zinc-800 border border-white/5', token.color)}>
              {token.name.slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-white">{token.name}</span>
                <span className="text-[10px] font-bold text-white">{token.amount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[8px] text-zinc-500">{token.type}</span>
                <span className="text-[8px] text-zinc-500">{token.usd}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* UTXO info */}
      <div className="bg-zinc-900/50 rounded-xl px-3 py-2 border border-white/5">
        <div className="flex items-center justify-between text-[8px]">
          <span className="text-zinc-500 flex items-center gap-1">
            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" /> UTXO Commitment
          </span>
          <span className="text-white font-mono text-[7px]">a4f2...c8d1</span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── Flow Screen Carousel ─────────────────── */
const SCREEN_ORDER = ['swap', 'portfolio', 'earn', 'tokens'] as const;
type ScreenId = (typeof SCREEN_ORDER)[number];

const SCREENS: Record<ScreenId, React.FC> = {
  swap: ScreenSwap,
  portfolio: ScreenPortfolio,
  earn: ScreenEarn,
  tokens: ScreenCashTokens,
};

interface FlowScreenCarouselProps {
  interval?: number;
  activeScreen?: ScreenId;
  onScreenChange?: (screen: ScreenId) => void;
  className?: string;
}

export function FlowScreenCarousel({
  interval = 5000,
  activeScreen: controlledScreen,
  onScreenChange,
  className,
}: FlowScreenCarouselProps) {
  const [internalScreen, setInternalScreen] = useState<ScreenId>('swap');
  const screen = controlledScreen ?? internalScreen;

  useEffect(() => {
    if (interval <= 0 || controlledScreen) return;
    const timer = setInterval(() => {
      setInternalScreen((prev) => {
        const idx = SCREEN_ORDER.indexOf(prev);
        const next = SCREEN_ORDER[(idx + 1) % SCREEN_ORDER.length];
        onScreenChange?.(next);
        return next;
      });
    }, interval);
    return () => clearInterval(timer);
  }, [interval, controlledScreen, onScreenChange]);

  const handleTabChange = (tab: string) => {
    const t = tab as ScreenId;
    setInternalScreen(t);
    onScreenChange?.(t);
  };

  const ScreenComponent = SCREENS[screen];

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <PhoneStatusBar />
      <AnimatePresence mode="wait">
        <motion.div
          key={screen}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.25 }}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <ScreenComponent />
        </motion.div>
      </AnimatePresence>
      <PhoneTabBar activeTab={screen} onTabChange={handleTabChange} />
    </div>
  );
}

export default FlowScreenCarousel;
