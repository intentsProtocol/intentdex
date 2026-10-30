import React, { useState } from 'react';
import { useMesh } from '@/context/MeshContext';
import { CornerCrosshair } from '@/components/common/MeshWireframeBox';
import { Calculator, ArrowUpRight } from 'lucide-react';

export function MeshYieldSimulator() {
  const { language, setActiveTab } = useMesh();
  const [bchAmount, setBchAmount] = useState(20);
  const [dailyTurns, setDailyTurns] = useState(4);
  const [spreadBps, setSpreadBps] = useState(220); // 2.2%

  const isZh = language === 'zh';
  const bchPrice = 320;
  const initialUsd = bchAmount * bchPrice;
  const feePerTurn = (spreadBps / 10000);
  const dailyReturnUsd = initialUsd * feePerTurn * dailyTurns;
  const yearlyReturnUsd = dailyReturnUsd * 365;
  const calculatedApy = ((yearlyReturnUsd / initialUsd) * 100).toFixed(1);

  return (
    <section id="simulator" className="border-b border-[#c0c2c4] dark:border-neutral-800 px-4 sm:px-6 relative">
      <div className="border-x border-[#c0c2c4] dark:border-neutral-800 relative max-w-7xl mx-auto py-16 sm:py-24 px-6 sm:px-10 lg:px-12 text-center">
        <CornerCrosshair className="-left-3 -top-3" />
        <CornerCrosshair className="-right-3 -top-3" />
        <CornerCrosshair className="-left-3 -bottom-3" />
        <CornerCrosshair className="-right-3 -bottom-3" />

        {/* Pill Tag */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-300 dark:border-neutral-700 bg-neutral-100/80 dark:bg-neutral-800/60 text-xs text-neutral-600 dark:text-neutral-400 font-medium mb-3">
          <Calculator className="w-3.5 h-3.5" />
          <span>{isZh ? '收益测算模拟器' : 'Interactive Yield Simulator'}</span>
        </div>

        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 mb-3 max-w-3xl mx-auto">
          {isZh ? '测算您的做市资本周转收益' : 'Calculate Your Virtual Depth Velocity'}
        </h2>
        <p className="text-neutral-600 dark:text-neutral-400 text-sm sm:text-base max-w-2xl mx-auto mb-12">
          {isZh
            ? '通过永续镜像池机制，单笔资金在同个区块或跨区块内被循环消耗与重建，带来远超传统 AMM 的年化收益率。'
            : 'Perpetual mirror recycling turns your capital multiple times daily without impermanent loss.'}
        </p>

        {/* Simulator Card */}
        <div className="max-w-4xl mx-auto rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#121215] shadow-xs p-6 sm:p-10 text-left">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            {/* Left: Input Sliders */}
            <div className="space-y-6">
              <div>
                <div className="flex justify-between text-xs font-mono mb-2">
                  <span className="text-neutral-600 dark:text-neutral-400">{isZh ? '投入 BCH 资金量' : 'Initial BCH Capital'}</span>
                  <span className="font-bold text-neutral-900 dark:text-white">{bchAmount} BCH (${initialUsd.toLocaleString()})</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={bchAmount}
                  onChange={(e) => setBchAmount(Number(e.target.value))}
                  className="w-full accent-neutral-900 dark:accent-neutral-100 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-mono mb-2">
                  <span className="text-neutral-600 dark:text-neutral-400">{isZh ? '每日周转循环次数' : 'Recycling Turns / Day'}</span>
                  <span className="font-bold text-neutral-900 dark:text-white">{dailyTurns}x / day</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="12"
                  value={dailyTurns}
                  onChange={(e) => setDailyTurns(Number(e.target.value))}
                  className="w-full accent-neutral-900 dark:accent-neutral-100 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-mono mb-2">
                  <span className="text-neutral-600 dark:text-neutral-400">{isZh ? '买卖点差' : 'Net Bid/Ask Spread'}</span>
                  <span className="font-bold text-neutral-900 dark:text-white">{(spreadBps / 100).toFixed(2)}% ({spreadBps} bps)</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="500"
                  step="10"
                  value={spreadBps}
                  onChange={(e) => setSpreadBps(Number(e.target.value))}
                  className="w-full accent-neutral-900 dark:accent-neutral-100 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* Right: Calculated APY & Yield Stats */}
            <div className="p-6 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 space-y-4 font-mono">
              <div className="border-b border-neutral-200 dark:border-neutral-700 pb-3">
                <span className="text-xs text-neutral-500 uppercase">{isZh ? '预估复合年化收益' : 'Estimated Annual APY'}</span>
                <div className="text-3xl sm:text-4xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                  {calculatedApy}%
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
                  <span>{isZh ? '单日净收益' : 'Daily Revenue'}:</span>
                  <span className="font-semibold text-neutral-900 dark:text-white">${dailyReturnUsd.toFixed(2)} USD</span>
                </div>
                <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
                  <span>{isZh ? '年化净收益' : 'Annual Revenue'}:</span>
                  <span className="font-semibold text-neutral-900 dark:text-white">${yearlyReturnUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD</span>
                </div>
                <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
                  <span>{isZh ? '单笔手续费成本' : 'Avg Gas Cost'}:</span>
                  <span className="font-semibold text-neutral-900 dark:text-white">&lt; $0.001</span>
                </div>
              </div>

              <button
                onClick={() => { setActiveTab('app'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="w-full py-2.5 rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 font-medium text-xs hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs mt-3"
              >
                <span>{isZh ? '启动该参数池' : 'Deploy Custom Pool'}</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
