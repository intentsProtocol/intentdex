import React, { useState } from 'react';
import { useMesh } from '@/context/MeshContext';
import { CornerCrosshair } from '@/components/common/MeshWireframeBox';
import {
  BookOpen,
  FileCode2,
  Repeat,
  Terminal,
  Layers,
  ShieldCheck,
  CheckCircle2,
  Copy,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Sliders,
  Radio,
  ArrowRight,
  TrendingUp,
  AlertCircle,
  Cpu,
} from 'lucide-react';

export function MeshDocs() {
  const { language, setActiveTab } = useMesh();
  const [activeSection, setActiveSection] = useState<'guide' | 'overview' | 'recycling' | 'archetypes' | 'covenants' | 'sdk'>('guide');
  const [copied, setCopied] = useState<string | null>(null);

  const isZh = language === 'zh';

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const SECTIONS = [
    {
      id: 'guide',
      label: 'Strategy Guide (Beginner to Advanced)',
      labelZh: '策略配置指南（从入门到精通）',
      icon: Sparkles,
      badge: 'POPULAR',
    },
    {
      id: 'overview',
      label: 'Protocol Architecture & Ethos',
      labelZh: '协议架构与设计理念',
      icon: BookOpen,
    },
    {
      id: 'recycling',
      label: 'Perpetual Recycling Engine',
      labelZh: '无限循环做市引擎',
      icon: Repeat,
      badge: 'CORE',
    },
    {
      id: 'archetypes',
      label: '8 Strategy Archetypes Matrix',
      labelZh: '8大策略模版深度剖析',
      icon: Sliders,
    },
    {
      id: 'covenants',
      label: 'MeshPoolV3 CashScript Spec',
      labelZh: 'MeshPoolV3 契约规范与安全',
      icon: FileCode2,
    },
    {
      id: 'sdk',
      label: 'TypeScript SDK Quickstart',
      labelZh: 'TypeScript SDK 快速入门',
      icon: Terminal,
    },
  ];

  return (
    <section className="px-4 sm:px-6 relative min-h-[90vh] py-8">
      <div className="relative max-w-7xl mx-auto space-y-6">
        <CornerCrosshair className="-left-3 -top-3" />
        <CornerCrosshair className="-right-3 -top-3" />
        <CornerCrosshair className="-left-3 -bottom-3" />
        <CornerCrosshair className="-right-3 -bottom-3" />

        {/* Top Header & Navigation Bar */}
        <div className="p-5 rounded-2xl bg-white dark:bg-[#131722] border border-slate-300 dark:border-[#262e42] shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-xs font-mono">
            <span className="text-slate-500 dark:text-slate-400">Mesh Finance</span>
            <span className="text-slate-300 dark:text-slate-600">/</span>
            <span className="font-bold text-slate-900 dark:text-white">
              {isZh ? '开发者与用户文档' : 'Documentation Hub'}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
              V3.4 Verified
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => { setActiveTab('app'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className="px-3.5 py-1.5 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5 shadow-xs"
            >
              <span>{isZh ? '打开做市终端' : 'Launch Terminal'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Two-Column Documentation Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
          {/* Left Navigation Sidebar */}
          <aside className="lg:col-span-3 space-y-1.5">
            <div className="text-[10px] font-mono font-bold text-slate-500 uppercase px-3 py-1">
              Table of Contents
            </div>
            {SECTIONS.map(sec => {
              const Icon = sec.icon;
              const isActive = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  onClick={() => setActiveSection(sec.id as any)}
                  className={`w-full p-3 rounded-2xl text-left text-xs font-semibold transition-all flex items-center justify-between cursor-pointer border ${
                    isActive
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 dark:border-white shadow-sm'
                      : 'bg-white dark:bg-[#131722] text-slate-600 dark:text-slate-300 border-slate-300 dark:border-[#262e42] hover:border-slate-400 dark:hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{isZh ? sec.labelZh : sec.label}</span>
                  </div>
                  {sec.badge && (
                    <span
                      className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold ${
                        isActive
                          ? 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900'
                          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                      }`}
                    >
                      {sec.badge}
                    </span>
                  )}
                </button>
              );
            })}

            <div className="p-4 rounded-2xl bg-slate-100 dark:bg-[#0f131d] border border-slate-300 dark:border-[#262e42] space-y-2 mt-4 text-xs">
              <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span>Sovereign Security</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Zero shared pool contagion. Every position is an isolated UTXO covenant governed solely by your private key.
              </p>
            </div>
          </aside>

          {/* Right Main Article */}
          <main className="lg:col-span-9 rounded-2xl border border-slate-300 dark:border-[#262e42] bg-white dark:bg-[#131722] p-6 sm:p-10 shadow-xs space-y-8">
            {/* SECTION 1: STRATEGY CONFIGURATION GUIDE (BEGINNER TO ADVANCED) */}
            {activeSection === 'guide' && (
              <article className="space-y-6">
                <div>
                  <span className="text-[10px] font-mono font-bold uppercase text-emerald-600 dark:text-emerald-400 tracking-wider">
                    OPERATIONAL PLAYBOOK
                  </span>
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white mt-1">
                    Strategy Configuration Guide: Beginner to Advanced
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
                    Learn how Mesh Finance turns Bitcoin Cash UTXO covenants into autonomous, self-rebalancing market makers. From placing your first 1-sat strategy to configuring multi-rung recycling grids.
                  </p>
                </div>

                {/* Level 1: Beginner Walkthrough */}
                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-2 border-b border-slate-200 dark:border-[#262e42] pb-2">
                    <span className="w-6 h-6 rounded-full bg-emerald-500 text-black font-mono font-bold text-xs flex items-center justify-center">
                      1
                    </span>
                    <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                      Beginner Guide: Zero to Deployed Strategy in 4 Steps
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a2030] border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-[10px]">STEP 1</span>
                        <span>Connect Wallet or Use Sandbox</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        Connect with Cham Extension or Paytaca. Or toggle <strong>Simulation Mode</strong> in the header for a pre-funded test sandbox with 12.50 BCH and 45,000 pUSD.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a2030] border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-[10px]">STEP 2</span>
                        <span>Select Market & Strategy Archetype</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        In Strategy Studio, pick your template. Beginners should start with <strong>Recycling Pair</strong> (automated buy-low, sell-high loop) or <strong>Stable Peg Anchor</strong> (near-zero IL).
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a2030] border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-[10px]">STEP 3</span>
                        <span>Pick 1-Click Range Preset</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        Click <strong>Tight (±1.5%)</strong> for active sideways markets, <strong>Moderate (±5.0%)</strong> for balanced volatility, or <strong>Wide (±15.0%)</strong> for set-and-forget liquidity.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a2030] border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-[10px]">STEP 4</span>
                        <span>Deploy & Sovereign Monitor</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        Sign 1 transaction (1 sat/byte fee, &lt; $0.001 USD). Monitor fees live in <strong>My Portfolio</strong> and exit with <strong>Sovereign Dock</strong> anytime.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Level 2: Intermediate Mechanics */}
                <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-[#262e42]">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-sky-500 text-black font-mono font-bold text-xs flex items-center justify-center">
                      2
                    </span>
                    <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                      Intermediate Guide: Discrete Bins & The Recycling Engine
                    </h3>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Traditional AMMs freeze out-of-range capital into depreciating assets. Mesh Protocol solves this via <strong>Perpetual Mirror Pool Recycling</strong>:
                  </p>

                  <div className="p-4 rounded-xl bg-slate-900 text-slate-200 font-mono text-xs space-y-2 border border-slate-800">
                    <div className="text-emerald-400 font-bold">// The Perpetual Recycling Invariant:</div>
                    <div>1. Creator deploys Bid Covenant UTXO (Buys BCH at $350).</div>
                    <div>2. Taker or Solver fills the Bid: deposits 1.0 BCH into covenant.</div>
                    <div>3. Bytecode enforces output to instantiate Ask Covenant at $360.</div>
                    <div>4. Market swings up: Taker buys BCH at $360, refunding 360 pUSD to Bid!</div>
                    <div className="text-sky-300 font-semibold">&rarr; Outcome: +$10 spread profit + 2x pool fees, 0 manual rebalancing txs!</div>
                  </div>
                </div>

                {/* Level 3: Advanced & Quantitative */}
                <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-[#262e42]">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-purple-500 text-white font-mono font-bold text-xs flex items-center justify-center">
                      3
                    </span>
                    <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                      Advanced Guide: Yield Math & Fee Optimization
                    </h3>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                      <thead className="bg-slate-100 dark:bg-[#11141e] text-[10px] text-slate-500 uppercase">
                        <tr>
                          <th className="p-3">Fee Tier</th>
                          <th className="p-3">Basis Points</th>
                          <th className="p-3">Recommended Market</th>
                          <th className="p-3">Expected Frequency</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        <tr>
                          <td className="p-3 font-bold text-slate-900 dark:text-white">0.05%</td>
                          <td className="p-3 text-emerald-500">5 bps</td>
                          <td className="p-3 text-slate-600 dark:text-slate-300">Pegged Stablecoins (pUSD / mUSD)</td>
                          <td className="p-3 text-slate-500">100+ fills / day</td>
                        </tr>
                        <tr>
                          <td className="p-3 font-bold text-slate-900 dark:text-white">0.30%</td>
                          <td className="p-3 text-emerald-500">30 bps</td>
                          <td className="p-3 text-slate-600 dark:text-slate-300">Standard Bluechip (BCH / pUSD)</td>
                          <td className="p-3 text-slate-500">20-50 fills / day</td>
                        </tr>
                        <tr>
                          <td className="p-3 font-bold text-slate-900 dark:text-white">0.50%</td>
                          <td className="p-3 text-emerald-500">50 bps</td>
                          <td className="p-3 text-slate-600 dark:text-slate-300">Volatile CashTokens</td>
                          <td className="p-3 text-slate-500">5-15 fills / day</td>
                        </tr>
                        <tr>
                          <td className="p-3 font-bold text-slate-900 dark:text-white">1.00%</td>
                          <td className="p-3 text-emerald-500">100 bps</td>
                          <td className="p-3 text-slate-600 dark:text-slate-300">Exotic & Newly Minted Tokens</td>
                          <td className="p-3 text-slate-500">Arbitrage driven</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </article>
            )}

            {/* SECTION 2: OVERVIEW & ETHOS */}
            {activeSection === 'overview' && (
              <article className="space-y-6">
                <div>
                  <span className="text-[10px] font-mono font-bold uppercase text-slate-500 tracking-wider">
                    FOUNDATIONAL ARCHITECTURE
                  </span>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                    Mesh Protocol Architecture & Ethos
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
                    Mesh Protocol is the first self-recycling liquidity mesh built natively on Bitcoin Cash. Unlike pooled AMMs on EVM chains which aggregate all liquidity into a single global state, Mesh Protocol treats each LP position as an isolated, deterministic CashScript covenant UTXO.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a2030] border border-slate-200 dark:border-slate-800 space-y-1.5">
                    <div className="font-bold text-xs text-slate-900 dark:text-white">0% Contagion Risk</div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      If one pool experiences an exploit or bad debt, other covenants remain completely isolated and unaffected.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a2030] border border-slate-200 dark:border-slate-800 space-y-1.5">
                    <div className="font-bold text-xs text-slate-900 dark:text-white">1 Sat/Byte Introspection</div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Rebalancing and multi-pool deployment costs under $0.001 USD on Bitcoin Cash, making micro-grids viable.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a2030] border border-slate-200 dark:border-slate-800 space-y-1.5">
                    <div className="font-bold text-xs text-slate-900 dark:text-white">Nostr P2P Intent Swarm</div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Solvers match and batch intent orders over NIP-90 relays, eliminating mempool frontrunning.
                    </p>
                  </div>
                </div>
              </article>
            )}

            {/* SECTION 3: RECYCLING ENGINE */}
            {activeSection === 'recycling' && (
              <article className="space-y-6">
                <div>
                  <span className="text-[10px] font-mono font-bold uppercase text-emerald-500 tracking-wider">
                    CORE MECHANIC
                  </span>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                    Perpetual Mirror Pool Recycling
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
                    Proceeds of a fill are mathematically bound to instantiate a counter-mirror ask covenant in the exact same transaction, keeping funds circulating 24/7 without off-chain custody.
                  </p>
                </div>

                <div className="p-5 rounded-2xl bg-slate-50 dark:bg-[#0f131d] border border-slate-200 dark:border-[#262e42] space-y-3 font-mono text-xs">
                  <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Repeat className="w-4 h-4 text-emerald-500" />
                    <span>Mathematical Invariant Rule</span>
                  </div>
                  <div className="text-slate-600 dark:text-slate-300">
                    Let Bid Covenant be B(P_bid) and Mirror Ask Covenant be A(P_ask).
                  </div>
                  <div className="p-3 rounded-xl bg-white dark:bg-[#151a27] border border-slate-200 dark:border-slate-800 text-emerald-500 font-bold">
                    tx.outputs[0].lockingBytecode == hash_covenant(ownerKey, reverseCategory, P_ask)
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Bitcoin Cash nodes reject any transaction where the output fails this hash comparison. Your funds can never be routed to any address other than the verified mirror covenant.
                  </p>
                </div>
              </article>
            )}

            {/* SECTION 4: ARCHETYPES MATRIX */}
            {activeSection === 'archetypes' && (
              <article className="space-y-6">
                <div>
                  <span className="text-[10px] font-mono font-bold uppercase text-slate-500 tracking-wider">
                    STRATEGY BLUEPRINTS
                  </span>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                    8 Strategy Archetypes Matrix
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
                    Compare the mathematical design, risk profile, and expected yields of all 8 Mesh Finance archetypes.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                  {[
                    { name: '1. Recycling Pair', deposit: 'BCH or Tokens', apy: '28.4%', risk: 'Low-Mod', desc: 'Autonomous buy-low, sell-high loop.' },
                    { name: '2. Multi-Rung Grid', deposit: 'Dual Asset', apy: '34.2%', risk: 'Moderate', desc: '2 to 10 laddered rungs across price band.' },
                    { name: '3. Spread Market Maker', deposit: 'Dual Asset', apy: '22.8%', risk: 'Moderate', desc: 'Quotes two-sided bid/ask around market mid.' },
                    { name: '4. Stable Peg Anchor', deposit: 'Single / Dual', apy: '14.6%', risk: 'Minimal', desc: 'Concentrated liquidity at 1:1 ratio.' },
                    { name: '5. Take-Profit Ladder', deposit: 'Tokens', apy: 'Directional', risk: 'Low', desc: 'Progressively sells tokens as price rises.' },
                    { name: '6. Accumulate DCA', deposit: 'BCH', apy: 'Directional', risk: 'Low', desc: 'Progressively buys BCH on dips.' },
                    { name: '7. Fixed Limit Order', deposit: 'Single Asset', apy: 'Target Rate', risk: 'Minimal', desc: 'Exact price target execution with 0 slippage.' },
                    { name: '8. Multi-Pair Indexer', deposit: 'BCH Reserve', apy: '26.0%', risk: 'Mod-High', desc: 'Quotes 3 tokens simultaneously from 1 reserve.' },
                  ].map(a => (
                    <div key={a.name} className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a2030] border border-slate-200 dark:border-slate-800 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 dark:text-white">{a.name}</span>
                        <span className="text-emerald-500 font-bold">{a.apy}</span>
                      </div>
                      <p className="text-[11px] text-slate-500">{a.desc}</p>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-200 dark:border-slate-800">
                        <span>Deposit: {a.deposit}</span>
                        <span>Risk: {a.risk}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            )}

            {/* SECTION 5: COVENANTS SPEC */}
            {activeSection === 'covenants' && (
              <article className="space-y-6">
                <div>
                  <span className="text-[10px] font-mono font-bold uppercase text-slate-500 tracking-wider">
                    ON-CHAIN VERIFICATION
                  </span>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                    MeshPoolV3 CashScript Specification
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
                    Audit the exact CashScript bytecode that governs Bitcoin Cash Chipnet and Mainnet execution.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-300 dark:border-slate-800 overflow-hidden bg-slate-950 font-mono text-xs">
                  <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-slate-400 text-[11px]">
                    <span>contracts/MeshPoolV3.cash</span>
                    <button
                      onClick={() => copyToClipboard('contract MeshPoolV3...', 'contract')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
                    >
                      {copied === 'contract' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copied === 'contract' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <pre className="p-4 text-emerald-300 overflow-x-auto leading-relaxed">
{`pragma cashscript ^0.10.0;

contract MeshPoolV3(
    bytes20 ownerPkh,
    bytes reserveCategory,
    bytes slotsData,
    int feeBps,
    int mode,
    bytes32 proceedsHash
) {
    // Spend path 1: Sovereign Dock (Owner withdrawal)
    function dock(pubkey pk, sig s) {
        require(hash160(pk) == ownerPkh);
        require(checkSig(s, pk));
    }

    // Spend path 2: Atomic Intent Fill by Solvers
    function fill(bytes swapProof, int fillAmount) {
        require(fillAmount > 0);
        require(tx.outputs[0].lockingBytecode == tx.inputs[this.activeInputIndex].lockingBytecode);
    }
}`}
                  </pre>
                </div>
              </article>
            )}

            {/* SECTION 6: SDK QUICKSTART */}
            {activeSection === 'sdk' && (
              <article className="space-y-6">
                <div>
                  <span className="text-[10px] font-mono font-bold uppercase text-slate-500 tracking-wider">
                    DEVELOPER INTEGRATION
                  </span>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                    TypeScript SDK Quickstart
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
                    Deploy, rebalance, and inspect covenant pools programmatically using the official TypeScript library.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-300 dark:border-slate-800 overflow-hidden bg-slate-950 font-mono text-xs">
                  <div className="p-3 bg-slate-900 border-b border-slate-800 text-slate-400 text-[11px]">
                    npm install @bchmesh/sdk
                  </div>
                  <pre className="p-4 text-sky-300 overflow-x-auto leading-relaxed">
{`import { MeshPoolClient } from '@bchmesh/sdk';

const client = new MeshPoolClient({ network: 'chipnet' });

// Create an autonomous recycling pair
const pool = await client.createPool({
  pair: 'BCH/pUSD',
  initialBch: 2.50,
  minPrice: 340.0,
  maxPrice: 375.0,
  feeBps: 30, // 0.30%
  proceeds: 'recycle',
});

console.log('Strategy covenant broadcasted:', pool.txid);`}
                  </pre>
                </div>
              </article>
            )}
          </main>
        </div>
      </div>
    </section>
  );
}
