import React, { useState } from 'react';
import { useMesh } from '@/context/MeshContext';
import { useMeshApp } from '@/context/MeshAppContext';
import { CornerCrosshair } from '@/components/common/MeshWireframeBox';
import { MeshPoolsExplorer } from './MeshPoolsExplorer';
import { MeshLiquidityTerminal } from './MeshLiquidityTerminal';
import { MeshStrategyStudio } from './MeshStrategyStudio';
import { MeshPortfolio } from './MeshPortfolio';
import { MeshNostrStream } from './MeshNostrStream';
import { MeshCovenantInspector } from './MeshCovenantInspector';
import { MeshWalletModal } from './MeshWalletModal';
import {
  Layers,
  Sliders,
  Sparkles,
  PieChart,
  Radio,
  FileCode2,
  Zap,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';

export function MeshAppShell() {
  const { language } = useMesh();
  const {
    subTab,
    setSubTab,
    isDemoMode,
    toggleDemoMode,
    walletConnected,
    walletAddress,
    bchBalance,
  } = useMeshApp();

  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const isZh = language === 'zh';

  // Contextual telemetry labels per active sub-tab
  const TAB_META: Record<string, { title: string; titleZh: string; desc: string; descZh: string; badge: string }> = {
    pools: {
      title: 'Pools & DLMM Liquidity Explorer',
      titleZh: '流动性池与深度分布',
      desc: 'Browse decentralized covenant bin pools with non-custodial yields.',
      descZh: '浏览自主契约流动性池，查看无托管即时收益率。',
      badge: '48 LIVE COVENANTS',
    },
    liquidity: {
      title: 'DLMM Concentrated Liquidity Terminal',
      titleZh: '离散流动性做市终端',
      desc: 'Place single-sided or concentrated bin liquidity with 1-sat transaction fees.',
      descZh: '配置集中价格区间做市，享受 1 sat 费率的自主再循环契约。',
      badge: 'ZERO RE-INDEXING FEES',
    },
    strategies: {
      title: 'Autonomous Strategy Studio',
      titleZh: '自动化策略工坊',
      desc: 'Deploy self-rebalancing recycling grid pairs and autonomous market makers.',
      descZh: '部署自我平衡的循环网格策略与自主做市契约。',
      badge: '100% NON-CUSTODIAL',
    },
    portfolio: {
      title: 'My Sovereign Positions & Portfolio',
      titleZh: '我的持仓与主权金库',
      desc: 'Inspect active covenant positions, harvest accrued satoshis, or execute sovereign dock exit.',
      descZh: '查看活跃策略契约，一键提取累计手续费或执行主权撤出。',
      badge: 'BCH UTXO VERIFIED',
    },
    intents: {
      title: 'Nostr NIP-90 Intent Swarm',
      titleZh: 'Nostr 去中心化意图流动',
      desc: 'Real-time solver order flow and peer-to-peer mempool liquidity matching.',
      descZh: '实时撮合求解器广播的交易意图与 P2P 内存池流动性。',
      badge: 'P2P GOSSIP MEMPOOL',
    },
    inspector: {
      title: 'CashScript Covenant Bytecode Inspector',
      titleZh: 'CashScript 契约字节码审计',
      desc: 'Audit verified on-chain contract bytecode running on Bitcoin Cash Chipnet.',
      descZh: '审计在 Bitcoin Cash Chipnet 上运行的不可篡改原生契约字节码。',
      badge: 'PRAGMA CASHSCRIPT 0.10',
    },
  };

  const meta = TAB_META[subTab] || TAB_META.pools;

  return (
    <section className="px-4 sm:px-6 relative min-h-[90vh] py-6 sm:py-8">
      <div className="relative max-w-7xl mx-auto space-y-6">
        <CornerCrosshair className="-left-3 -top-3" />
        <CornerCrosshair className="-right-3 -top-3" />
        <CornerCrosshair className="-left-3 -bottom-3" />
        <CornerCrosshair className="-right-3 -bottom-3" />

        {/* Demo Simulation Alert Strip */}
        {isDemoMode && (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-700 dark:text-amber-300">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span className="font-bold uppercase tracking-wider text-[11px] font-mono">
                Simulation Sandbox Active:
              </span>
              <span className="font-medium">
                Testing with pre-allocated 12.50 BCH & 45,000 pUSD. Zero gas risk, all operations simulate live CashScript covenant cycles.
              </span>
            </div>
            <button
              onClick={toggleDemoMode}
              className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 font-bold text-[11px] transition-colors cursor-pointer"
            >
              Switch to Live Chipnet
            </button>
          </div>
        )}

        {/* Contextual Terminal Header */}
        <div className="p-5 rounded-2xl bg-white dark:bg-[#131722] border border-slate-300 dark:border-[#262e42] shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-mono text-[10px] font-bold uppercase">
                {meta.badge}
              </span>
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                Network: Bitcoin Cash Chipnet • 1 sat/vB
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white mt-1.5">
              {isZh ? meta.titleZh : meta.title}
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              {isZh ? meta.descZh : meta.desc}
            </p>
          </div>

          <div className="flex items-center gap-2 self-stretch md:self-auto shrink-0">
            {/* Quick-switch buttons between adjacent views */}
            <button
              onClick={() => setSubTab('pools')}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                subTab === 'pools'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-[#1a2030] border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              Pools
            </button>
            <button
              onClick={() => setSubTab('liquidity')}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                subTab === 'liquidity'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-[#1a2030] border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              DLMM
            </button>
            <button
              onClick={() => setSubTab('strategies')}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                subTab === 'strategies'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-[#1a2030] border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              Studio
            </button>
            <button
              onClick={() => setSubTab('portfolio')}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                subTab === 'portfolio'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-[#1a2030] border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              Portfolio
            </button>
          </div>
        </div>

        {/* Dynamic Content Views */}
        <div>
          {subTab === 'pools' && <MeshPoolsExplorer />}
          {subTab === 'liquidity' && <MeshLiquidityTerminal />}
          {subTab === 'strategies' && <MeshStrategyStudio />}
          {subTab === 'portfolio' && <MeshPortfolio />}
          {subTab === 'intents' && <MeshNostrStream />}
          {subTab === 'inspector' && <MeshCovenantInspector />}
        </div>
      </div>

      <MeshWalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
    </section>
  );
}
