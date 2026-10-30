import React, { useState } from 'react';
import { useMesh } from '@/context/MeshContext';
import { CornerCrosshair } from '@/components/common/MeshWireframeBox';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpRight, ShieldCheck, RefreshCw, Layers, Coins, Zap } from 'lucide-react';

export function MeshHero() {
  const { language, t, setActiveTab } = useMesh();
  const [activeTabMode, setActiveTabMode] = useState<'recycle' | 'multislot' | 'batch'>('recycle');
  const [bchInput, setBchInput] = useState(10);

  const isZh = language === 'zh';
  const bchPrice = 320;
  const virtualDepth = bchInput * bchPrice * 5.4;

  return (
    <section id="overview" className="border-b border-[#c0c2c4] dark:border-neutral-800 px-4 sm:px-6 relative">
      <div className="border-x border-[#c0c2c4] dark:border-neutral-800 relative max-w-7xl mx-auto py-12 md:py-20 px-6 sm:px-10 lg:px-12">
        <CornerCrosshair className="-left-3 -top-3" />
        <CornerCrosshair className="-right-3 -top-3" />
        <CornerCrosshair className="-left-3 -bottom-3" />
        <CornerCrosshair className="-right-3 -bottom-3" />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
          {/* Left Column: Heading, Subtitle, Pill, Action Buttons */}
          <div className="lg:col-span-7 space-y-6">
            {/* Pill Tag */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-300 dark:border-neutral-700 bg-neutral-100/80 dark:bg-neutral-800/60 text-xs text-neutral-600 dark:text-neutral-400 font-medium">
              <span>{isZh ? '新一代比特币现金流动性协议' : 'The next generation of UTXO Liquidity'}</span>
            </div>

            {/* Massive Geometric Heading */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 leading-[1.12]">
              {isZh ? '去中心化自主流动性网格' : 'Decentralized Autonomous Liquidity Mesh'}
            </h1>

            {/* Subtitle */}
            <p className="text-base sm:text-lg text-neutral-600 dark:text-neutral-400 leading-relaxed max-w-xl">
              {isZh
                ? '基于比特币现金 CashScript 契约的去中心化流动性回收协议。生成可验证的链上做市契约，零滑点撮合多代币池，实现资金 24/7 永续高频自转。'
                : 'Secure, transparent, and instant liquidity recycling powered by Bitcoin Cash covenants. Deploy deterministic proof pools, route multi-token reserves, and recycle capital with zero slippage.'}
            </p>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
              <button
                onClick={() => { setActiveTab('app'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="px-6 py-3.5 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 font-medium text-sm hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>{isZh ? '进入做市终端' : 'Launch Mesh Terminal'}</span>
                <ArrowUpRight className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  const el = document.querySelector('#features');
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                }}
                className="px-6 py-3.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 font-medium text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs"
              >
                <span>{isZh ? '探索契约特性' : 'Explore Protocol Features'}</span>
              </button>
            </div>
          </div>

          {/* Right Column: Clean Rounded Card */}
          <div className="lg:col-span-5">
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#121215] shadow-sm p-6 relative overflow-hidden">
              {/* Card Header & Tabs */}
              <div className="flex items-center justify-between pb-4 border-b border-neutral-100 dark:border-neutral-800">
                <div className="flex items-center gap-1.5 p-1 rounded-lg bg-neutral-100 dark:bg-neutral-800/80 text-xs">
                  <button
                    onClick={() => setActiveTabMode('recycle')}
                    className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                      activeTabMode === 'recycle'
                        ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs'
                        : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
                    }`}
                  >
                    {isZh ? '永续回收' : 'Recycling'}
                  </button>
                  <button
                    onClick={() => setActiveTabMode('multislot')}
                    className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                      activeTabMode === 'multislot'
                        ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs'
                        : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
                    }`}
                  >
                    {isZh ? '多槽位' : 'Multi-Slot'}
                  </button>
                  <button
                    onClick={() => setActiveTabMode('batch')}
                    className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                      activeTabMode === 'batch'
                        ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs'
                        : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
                    }`}
                  >
                    {isZh ? '多池撮合' : 'Batch Fill'}
                  </button>
                </div>

                <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700">
                  MeshPoolV3
                </span>
              </div>

              {/* Dynamic Content */}
              <div className="my-5 min-h-[190px] flex flex-col justify-between">
                <AnimatePresence mode="wait">
                  {activeTabMode === 'recycle' && (
                    <motion.div
                      key="recycle"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="space-y-3.5"
                    >
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                          <RefreshCw className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span>Perpetual Mirror Loop</span>
                        </span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">+2.2% Net Spread</span>
                      </div>

                      <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 space-y-2.5 font-mono text-xs">
                        <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200">
                          <span>Bid Pool: 10.0 BCH</span>
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">@ 3,200 pUSD</span>
                        </div>
                        <div className="text-center text-[10px] text-neutral-400">
                          ↓ fill() creates mirror ask on-chain in same tx ↓
                        </div>
                        <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200">
                          <span>Mirror Ask: 32,000 pUSD</span>
                          <span className="text-cyan-600 dark:text-cyan-400 font-semibold">@ 3,280 pUSD</span>
                        </div>
                      </div>

                      <p className="text-[11px] text-neutral-500 leading-snug">
                        {isZh ? '无需中心化服务器托管，镜像的镜像即为原始池，资金 24/7 自主复利运转。' : 'Zero server tracking required. The mirror of the mirror is the original pool, keeping capital working 24/7.'}
                      </p>
                    </motion.div>
                  )}

                  {activeTabMode === 'multislot' && (
                    <motion.div
                      key="multislot"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="space-y-3.5"
                    >
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                          <Coins className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                          <span>1 Single Reserve • 3 Tokens</span>
                        </span>
                        <span className="text-neutral-500">Slot 0/1/2</span>
                      </div>

                      <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 space-y-1.5 font-mono text-xs">
                        <div className="text-neutral-900 dark:text-white font-semibold pb-1 border-b border-neutral-200 dark:border-neutral-700">
                          Reserve: 25.0 BCH
                        </div>
                        <div className="flex justify-between text-neutral-600 dark:text-neutral-300">
                          <span>Slot 0: Accepts FLEX</span>
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">1,420 FLEX</span>
                        </div>
                        <div className="flex justify-between text-neutral-600 dark:text-neutral-300">
                          <span>Slot 1: Accepts LAW</span>
                          <span className="font-semibold text-cyan-600 dark:text-cyan-400">850 LAW</span>
                        </div>
                        <div className="flex justify-between text-neutral-600 dark:text-neutral-300">
                          <span>Slot 2: Accepts USDC</span>
                          <span className="font-semibold text-purple-600 dark:text-purple-400">328.5 USDC</span>
                        </div>
                      </div>

                      <p className="text-[11px] text-neutral-500 leading-snug">
                        {isZh ? '收益流出至唯一输出索引，单笔 UTXO 储备即可原生承载多个代币对。' : 'Proceeds leave the pool to unique output indices, allowing 1 reserve to quote multiple tokens.'}
                      </p>
                    </motion.div>
                  )}

                  {activeTabMode === 'batch' && (
                    <motion.div
                      key="batch"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="space-y-3.5"
                    >
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                          <span>Atomic Multi-Pool Fill</span>
                        </span>
                        <span className="text-neutral-500">Atomic Tx</span>
                      </div>

                      <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 space-y-1.5 font-mono text-xs">
                        <div className="text-neutral-900 dark:text-white font-semibold pb-1 border-b border-neutral-200 dark:border-neutral-700">
                          Batch Order: 100 BCH
                        </div>
                        <div className="text-neutral-600 dark:text-neutral-300">
                          • Sweeps Pool #1 (outpoint: a8f...0) — 40 BCH
                        </div>
                        <div className="text-neutral-600 dark:text-neutral-300">
                          • Sweeps Pool #2 (outpoint: c2e...1) — 35 BCH
                        </div>
                        <div className="text-neutral-600 dark:text-neutral-300">
                          • Sweeps Pool #3 (outpoint: f91...0) — 25 BCH
                        </div>
                      </div>

                      <p className="text-[11px] text-neutral-500 leading-snug">
                        {isZh ? '每个池的收益输出索引独立推导，无竞态碰撞，无资金锁定。' : 'Each pool proceeds index is uniquely derived. No order collisions, no pool lockups.'}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Slider for Virtual Depth */}
              <div className="pt-3.5 border-t border-neutral-100 dark:border-neutral-800 space-y-2">
                <div className="flex justify-between items-center text-xs font-mono">
                  <span className="text-neutral-500">{isZh ? '模拟做市资金深度:' : 'Simulated Virtual Depth:'}</span>
                  <span className="font-bold text-sm text-neutral-900 dark:text-neutral-100">
                    $${virtualDepth.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="50"
                  value={bchInput}
                  onChange={(e) => setBchInput(Number(e.target.value))}
                  className="w-full accent-neutral-900 dark:accent-neutral-100 cursor-pointer h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg appearance-none"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
