import React, { useState, useEffect } from 'react';
import { useMesh } from '@/context/MeshContext';
import { CornerCrosshair } from '@/components/common/MeshWireframeBox';
import { motion } from 'framer-motion';
import { RefreshCw, Play, Pause, Repeat, ArrowRight } from 'lucide-react';

export function MeshRecyclingVisualizer() {
  const { t, language } = useMesh();
  const [activeStep, setActiveStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  const isZh = language === 'zh';

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % 4);
    }, 4500);
    return () => clearInterval(timer);
  }, [isPlaying]);

  const steps = [
    {
      title: t.recycling.step1Title,
      desc: t.recycling.step1Desc,
      state: isZh ? '买单挂单中' : 'Active Bid Pool',
      holding: '10.00 BCH',
      action: isZh ? '在 3,200 汇率挂单收购 pUSD' : 'Bidding for pUSD at 3,200 sats',
      poolType: 'Bid Pool (UTXO #1)',
    },
    {
      title: t.recycling.step2Title,
      desc: t.recycling.step2Desc,
      state: isZh ? '链上原子成交' : 'Atomic Fill On-Chain',
      holding: '32,000 pUSD Received',
      action: isZh ? '收益绕过池金库，同交易实例化镜像卖单' : 'Proceeds instantiate mirror ask in same tx',
      poolType: 'Atomic Transition',
    },
    {
      title: t.recycling.step3Title,
      desc: t.recycling.step3Desc,
      state: isZh ? '镜像卖单激活' : 'Mirror Ask Live',
      holding: '32,000 pUSD Active',
      action: isZh ? '以 3,280 汇率卖出 pUSD (高位套利)' : 'Asking 3,280 sats (Selling High)',
      poolType: 'Mirror Pool (UTXO #2)',
    },
    {
      title: t.recycling.step4Title,
      desc: t.recycling.step4Desc,
      state: isZh ? '闭环完成与自转' : 'Round-Trip Complete',
      holding: '10.25 BCH (+2.5% Gain)',
      action: isZh ? '资金回流原始买单，再次进入就绪状态' : 'BCH flows back to original bid loop',
      poolType: 'Perpetual Loop Re-armed',
    },
  ];

  const current = steps[activeStep];

  return (
    <section id="recycling" className="border-b border-[#c0c2c4] dark:border-neutral-800 px-4 sm:px-6 relative">
      <div className="border-x border-[#c0c2c4] dark:border-neutral-800 relative max-w-7xl mx-auto py-16 sm:py-24 px-6 sm:px-10 lg:px-12 text-center">
        <CornerCrosshair className="-left-3 -top-3" />
        <CornerCrosshair className="-right-3 -top-3" />
        <CornerCrosshair className="-left-3 -bottom-3" />
        <CornerCrosshair className="-right-3 -bottom-3" />

        {/* Pill Tag */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-300 dark:border-neutral-700 bg-neutral-100/80 dark:bg-neutral-800/60 text-xs text-neutral-600 dark:text-neutral-400 font-medium mb-3">
          <RefreshCw className="w-3.5 h-3.5" />
          <span>{t.recycling.kicker}</span>
        </div>

        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 mb-3 max-w-3xl mx-auto">
          {t.recycling.title}
        </h2>
        <p className="text-neutral-600 dark:text-neutral-400 text-sm sm:text-base max-w-2xl mx-auto mb-12">
          {t.recycling.subtitle}
        </p>

        {/* Visualizer Frame Card */}
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#121215] shadow-xs p-6 sm:p-8 text-left space-y-6">
          {/* Header Controls */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-neutral-100 dark:border-neutral-800">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-mono font-semibold text-neutral-800 dark:text-neutral-200">
                {t.recycling.badgeLiveLoop}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800">
                {t.recycling.statCycleGain}
              </span>
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="p-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:text-black dark:hover:text-white transition-colors cursor-pointer"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* 4 Step Selector Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {steps.map((s, idx) => (
              <button
                key={idx}
                onClick={() => { setActiveStep(idx); setIsPlaying(false); }}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  activeStep === idx
                    ? 'border-neutral-900 dark:border-white bg-neutral-100 dark:bg-neutral-800/80 shadow-xs'
                    : 'border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/40 text-neutral-500 hover:border-neutral-300 dark:hover:border-neutral-700'
                }`}
              >
                <div className="text-[10px] font-mono font-semibold text-neutral-500 uppercase mb-1">
                  Step 0{idx + 1}
                </div>
                <div className="font-semibold text-xs text-neutral-900 dark:text-neutral-100 truncate">{s.state}</div>
                <div className="text-[11px] text-neutral-500 mt-0.5 truncate">{s.holding}</div>
              </button>
            ))}
          </div>

          {/* Main Visualizer Diagram Stage */}
          <div className="grid md:grid-cols-12 gap-6 items-center p-6 rounded-xl bg-neutral-50 dark:bg-neutral-900/80 border border-neutral-200 dark:border-neutral-800">
            {/* Left Box: Active State */}
            <div className="md:col-span-5 space-y-3">
              <span className="inline-block px-2 py-0.5 rounded-md bg-neutral-200 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 font-mono text-[11px] font-medium border border-neutral-300 dark:border-neutral-700">
                {current.poolType}
              </span>
              <h3 className="font-semibold text-xl text-neutral-900 dark:text-neutral-100">
                {current.title}
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 text-xs sm:text-sm leading-relaxed">
                {current.desc}
              </p>
              <div className="p-2.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 font-mono text-xs text-neutral-700 dark:text-neutral-300">
                <span className="font-semibold text-neutral-900 dark:text-white">Action: </span>
                {current.action}
              </div>
            </div>

            {/* Center Animated Transition Glyph */}
            <div className="md:col-span-2 flex items-center justify-center my-2 md:my-0">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 16, repeat: Infinity, ease: 'linear' }}
                className="w-12 h-12 rounded-full border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 flex items-center justify-center text-neutral-700 dark:text-neutral-300 shadow-xs"
              >
                <Repeat className="w-5 h-5" />
              </motion.div>
            </div>

            {/* Right Box: Live UTXO State Monitor */}
            <div className="md:col-span-5 p-4 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 space-y-2.5 font-mono text-xs">
              <div className="flex justify-between items-center text-neutral-500 border-b border-neutral-200 dark:border-neutral-700 pb-2">
                <span>ON-CHAIN STATE</span>
                <span className="font-semibold text-neutral-900 dark:text-white">UNSPENT UTXO</span>
              </div>
              <div className="flex justify-between items-center text-neutral-700 dark:text-neutral-300">
                <span className="text-neutral-500">Locked Capital:</span>
                <span className="font-semibold text-neutral-900 dark:text-white">{current.holding}</span>
              </div>
              <div className="flex justify-between items-center text-neutral-700 dark:text-neutral-300">
                <span className="text-neutral-500">Proceeds Mode:</span>
                <span className="font-semibold text-neutral-900 dark:text-white">Mode 2 (Mirror)</span>
              </div>
              <div className="flex justify-between items-center text-neutral-700 dark:text-neutral-300">
                <span className="text-neutral-500">Centralized Custody:</span>
                <span className="font-semibold text-neutral-900 dark:text-white">0.00% (Pure Covenant)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
