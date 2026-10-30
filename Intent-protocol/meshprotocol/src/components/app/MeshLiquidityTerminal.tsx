import React, { useState } from 'react';
import { useMeshApp } from '@/context/MeshAppContext';
import { MOCK_POOLS } from '@/lib/meshApi';
import { TactileInput } from '@/components/ui/TactileInput';
import { TactileButton } from '@/components/ui/TactileButton';
import { TacticalBadge } from '@/components/ui/TacticalBadge';
import { Sliders, ShieldCheck, CheckCircle2, ArrowRight, Sparkles, Scale, Flame, Zap } from 'lucide-react';

export function MeshLiquidityTerminal() {
  const { selectedPool, bchBalance, tokenBalances, addPosition, setSubTab } = useMeshApp();
  const pool = selectedPool ?? MOCK_POOLS[0];

  const [shape, setShape] = useState<'spot' | 'curve' | 'bid-ask'>('curve');
  const [minPrice, setMinPrice] = useState<number>(340);
  const [maxPrice, setMaxPrice] = useState<number>(375);
  const [depositBch, setDepositBch] = useState<string>('2.50');
  const [depositToken, setDepositToken] = useState<string>('893.12');
  const [singleSided, setSingleSided] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [success, setSuccess] = useState<boolean>(false);

  const currentPrice = pool.priceTokensPerBch;

  const handleDeposit = () => {
    setLoading(true);
    setTimeout(() => {
      addPosition({
        name: `${pool.reserveSymbol}/${pool.targetSymbol} DLMM Position`,
        template: 'dlmm-bins',
        pair: `${pool.reserveSymbol} / ${pool.targetSymbol}`,
        depositBch: parseFloat(depositBch) || 0,
        depositTokens: parseFloat(depositToken) || 0,
        tokenSymbol: pool.targetSymbol,
        valueUsd: (parseFloat(depositBch) || 0) * 357.5 + (parseFloat(depositToken) || 0),
        status: 'optimal',
        minPrice,
        maxPrice,
        currentPrice,
      });
      setLoading(false);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setSubTab('portfolio');
      }, 1000);
    }, 600);
  };

  const bins = Array.from({ length: 24 }).map((_, i) => {
    const p = 320 + i * 3.5;
    const isCurrent = Math.abs(p - currentPrice) < 2.0;
    const isInRange = p >= minPrice && p <= maxPrice;

    let height = 30;
    if (shape === 'curve') {
      const dist = Math.abs(p - currentPrice);
      height = Math.max(15, 95 - dist * 3.2);
    } else if (shape === 'spot') {
      height = isInRange ? 65 : 20;
    } else {
      height = p < currentPrice ? 85 : 40;
    }

    return {
      price: p,
      isCurrent,
      isInRange,
      height: Math.min(100, Math.max(10, height)),
    };
  });

  return (
    <div className="space-y-6">
      {/* Pair Header Banner */}
      <div className="p-5 rounded-2xl bg-white dark:bg-[#151821] border border-neutral-300 dark:border-neutral-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="font-extrabold text-xl text-neutral-900 dark:text-white">
              {pool.reserveSymbol} / {pool.targetSymbol}
            </span>
            <TacticalBadge status="optimal" />
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-300 dark:border-neutral-700">
              {(pool.feeBps / 100).toFixed(2)}% Fee Tier
            </span>
          </div>
          <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1 font-mono">
            Current Price: 1 BCH = <span className="text-neutral-900 dark:text-white font-bold">{currentPrice}</span> {pool.targetSymbol}
          </p>
        </div>

        <div className="flex items-center gap-6 font-mono text-xs">
          <div>
            <div className="text-neutral-500 text-[10px] uppercase">24h Volume</div>
            <div className="font-bold text-neutral-900 dark:text-white">$${pool.volume24hUsd.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-neutral-500 text-[10px] uppercase">Dynamic APR</div>
            <div className="font-bold text-emerald-500">+{pool.apyPct}%</div>
          </div>
          <div>
            <div className="text-neutral-500 text-[10px] uppercase">Covenant Reserve</div>
            <div className="font-bold text-neutral-900 dark:text-white">{(pool.tvlSats / 1e8).toFixed(2)} BCH</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Interactive Depth Visualizer */}
        <div className="lg:col-span-7 space-y-4">
          <div className="p-5 rounded-2xl bg-white dark:bg-[#151821] border border-neutral-300 dark:border-neutral-800 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-900 dark:text-white font-mono uppercase tracking-wider">
                DLMM Discrete Bin Depth Visualizer
              </span>
              <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 text-xs font-semibold">
                <button
                  onClick={() => setShape('curve')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${shape === 'curve' ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 font-bold' : 'text-neutral-500'}`}
                >
                  Curve (Concentrated)
                </button>
                <button
                  onClick={() => setShape('spot')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${shape === 'spot' ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 font-bold' : 'text-neutral-500'}`}
                >
                  Spot (Uniform)
                </button>
                <button
                  onClick={() => setShape('bid-ask')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${shape === 'bid-ask' ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 font-bold' : 'text-neutral-500'}`}
                >
                  Bid-Ask Skew
                </button>
              </div>
            </div>

            {/* Depth Bars Container */}
            <div className="relative h-52 rounded-xl bg-[#090a0f] border border-neutral-800 p-4 flex items-end justify-between gap-1 overflow-hidden">
              {/* Mid Cursor */}
              <div className="absolute top-2 bottom-2 left-1/2 w-px bg-sky-400 z-10">
                <span className="absolute top-1 -translate-x-1/2 px-1.5 py-0.5 rounded bg-sky-950 border border-sky-500/50 text-[8px] font-mono text-sky-300 shadow-xs">
                  MID
                </span>
              </div>

              {bins.map((b, i) => (
                <div
                  key={i}
                  className="flex-1 flex flex-col items-center justify-end h-full group relative cursor-pointer"
                  onClick={() => {
                    if (b.price < currentPrice) setMinPrice(Math.round(b.price));
                    else setMaxPrice(Math.round(b.price));
                  }}
                >
                  <div
                    className={`w-full rounded-t-sm transition-all duration-200 ${
                      b.isCurrent
                        ? 'bg-sky-400'
                        : b.isInRange
                        ? 'bg-emerald-500 hover:bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                        : 'bg-neutral-800 hover:bg-neutral-700'
                    }`}
                    style={{ height: `${b.height}%` }}
                  />
                  <div className="absolute bottom-full mb-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-neutral-900 text-[9px] font-mono px-1.5 py-0.5 rounded border border-neutral-700 text-white whitespace-nowrap z-20">
                    {b.price.toFixed(1)} {pool.targetSymbol}
                  </div>
                </div>
              ))}
            </div>

            {/* Granular Min/Max Handles */}
            <div className="grid grid-cols-2 gap-4 pt-1">
              <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-[#0e1017] border border-neutral-300 dark:border-neutral-700/80 space-y-1">
                <span className="text-[10px] text-neutral-500 font-mono uppercase font-semibold">Min Price Bound</span>
                <input
                  type="number"
                  value={minPrice}
                  onChange={e => setMinPrice(parseFloat(e.target.value) || 0)}
                  className="w-full bg-transparent font-mono text-base font-bold text-neutral-900 dark:text-white focus:outline-none"
                />
                <span className="text-[10px] text-emerald-500 font-mono">
                  {((minPrice / currentPrice - 1) * 100).toFixed(1)}% vs Market Mid
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-[#0e1017] border border-neutral-300 dark:border-neutral-700/80 space-y-1">
                <span className="text-[10px] text-neutral-500 font-mono uppercase font-semibold">Max Price Bound</span>
                <input
                  type="number"
                  value={maxPrice}
                  onChange={e => setMaxPrice(parseFloat(e.target.value) || 0)}
                  className="w-full bg-transparent font-mono text-base font-bold text-neutral-900 dark:text-white focus:outline-none"
                />
                <span className="text-[10px] text-rose-500 font-mono">
                  {((maxPrice / currentPrice - 1) * 100).toFixed(1)}% vs Market Mid
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Deposit & Action Panel */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-2xl bg-white dark:bg-[#151821] border border-neutral-300 dark:border-neutral-800 space-y-4 shadow-xs">
            <h3 className="font-bold text-base text-neutral-900 dark:text-white">Deposit Liquidity</h3>

            <div className="space-y-3">
              <TactileInput
                label="BCH Deposit"
                balanceHint={`Bal: ${bchBalance.toFixed(4)} BCH`}
                value={depositBch}
                onChange={e => setDepositBch(e.target.value)}
                suffix="BCH"
                onMax={() => setDepositBch(Math.max(0, bchBalance - 0.001).toFixed(4))}
                onFraction={f => setDepositBch((bchBalance * f).toFixed(4))}
              />

              <TactileInput
                label={`${pool.targetSymbol} Deposit`}
                balanceHint={`Bal: ${(tokenBalances[pool.targetSymbol] ?? 0).toLocaleString()} ${pool.targetSymbol}`}
                value={depositToken}
                onChange={e => setDepositToken(e.target.value)}
                suffix={pool.targetSymbol}
                onMax={() => setDepositToken(String(tokenBalances[pool.targetSymbol] ?? 0))}
                onFraction={f => setDepositToken(String(Math.floor((tokenBalances[pool.targetSymbol] ?? 0) * f)))}
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={singleSided}
                onChange={e => setSingleSided(e.target.checked)}
                className="w-4 h-4 accent-emerald-500 rounded"
              />
              <span>Single-sided deposit (auto-recycles into mirror covenant)</span>
            </label>

            <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-[#0e1017] border border-neutral-200 dark:border-neutral-800 font-mono text-[11px] space-y-1.5 text-neutral-600 dark:text-neutral-400">
              <div className="flex justify-between">
                <span>Fee Tier:</span>
                <span className="text-neutral-900 dark:text-white font-bold">{(pool.feeBps / 100).toFixed(2)}%</span>
              </div>
              <div className="flex justify-between">
                <span>Network Gas:</span>
                <span className="text-emerald-500 font-bold">~250 sats (1 sat/byte)</span>
              </div>
              <div className="flex justify-between">
                <span>Sovereign Exit:</span>
                <span className="text-neutral-900 dark:text-white font-bold">100% Non-Custodial Dock</span>
              </div>
            </div>

            <TactileButton
              variant="emerald"
              size="lg"
              className="w-full h-12"
              loading={loading}
              onClick={handleDeposit}
            >
              {success ? 'Bins Funded Successfully!' : 'Deploy Liquidity Bins (1 Sat Fee)'}
            </TactileButton>
          </div>
        </div>
      </div>
    </div>
  );
}
