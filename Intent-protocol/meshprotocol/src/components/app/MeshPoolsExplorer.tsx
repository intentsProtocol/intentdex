import React, { useState } from 'react';
import { useMeshApp } from '@/context/MeshAppContext';
import { MOCK_POOLS, type MeshPool } from '@/lib/meshApi';
import { MetricCard } from '@/components/ui/MetricCard';
import { TacticalBadge } from '@/components/ui/TacticalBadge';
import { TactileButton } from '@/components/ui/TactileButton';
import { Search, Sliders, ArrowUpRight, Repeat, Filter, Sparkles, TrendingUp, Layers } from 'lucide-react';

export function MeshPoolsExplorer() {
  const { setSubTab, setSelectedPool } = useMeshApp();
  const [filter, setFilter] = useState<'all' | 'stables' | 'high-yield' | 'recycled'>('all');
  const [search, setSearch] = useState('');

  const filteredPools = MOCK_POOLS.filter(p => {
    if (search && !p.targetSymbol.toLowerCase().includes(search.toLowerCase()) && !p.reserveSymbol.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    if (filter === 'stables') return p.targetSymbol.includes('USD');
    if (filter === 'high-yield') return p.apyPct > 22;
    if (filter === 'recycled') return p.mode === 'mirror';
    return true;
  });

  const handleProvide = (pool: MeshPool) => {
    setSelectedPool(pool);
    setSubTab('liquidity');
  };

  const handleStrategy = (pool: MeshPool) => {
    setSelectedPool(pool);
    setSubTab('strategies');
  };

  return (
    <div className="space-y-6">
      {/* 4-Card Protocol Telemetry Strip using Reusable MetricCards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <MetricCard
          label="Total Value Locked"
          value="$2,418,920"
          subValue="11,840 BCH allocated"
          delta={{ value: "4.8% 24h", isPositive: true }}
        />
        <MetricCard
          label="24h Covenant Volume"
          value="$482,100"
          subValue="1 sat/byte gas efficiency"
          delta={{ value: "12.4%", isPositive: true }}
        />
        <MetricCard
          label="24h LP Fees Generated"
          value="$1,446.30"
          subValue="Paid to LPs"
          delta={{ value: "14.2% vs 7d avg", isPositive: true }}
        />
        <MetricCard
          label="Active Covenants"
          value="48 Pools"
          subValue="100% Non-custodial UTXOs"
        />
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {[
            { id: 'all', label: 'All Markets' },
            { id: 'stables', label: 'Stablecoins (pUSD / mUSD)' },
            { id: 'high-yield', label: 'High APY (>22%)' },
            { id: 'recycled', label: 'Recycling Mirror Pools' },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                filter === f.id
                  ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-xs'
                  : 'bg-white dark:bg-[#151821] border border-neutral-300 dark:border-neutral-700/80 text-neutral-700 dark:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-500'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[260px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="Search by token or symbol..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-white dark:bg-[#0e1017] border border-neutral-300 dark:border-neutral-700/80 text-xs text-neutral-900 dark:text-white placeholder:text-neutral-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 font-mono"
          />
        </div>
      </div>

      {/* Pools Wireframe Table */}
      <div className="rounded-2xl border border-neutral-300 dark:border-neutral-800 overflow-hidden bg-white dark:bg-[#151821] shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800 font-mono text-[10px] text-neutral-500 uppercase tracking-wider bg-neutral-50 dark:bg-[#11131a]">
                <th className="py-3.5 px-4 font-semibold">Pool Market</th>
                <th className="py-3.5 px-4 font-semibold">Type</th>
                <th className="py-3.5 px-4 font-semibold">TVL</th>
                <th className="py-3.5 px-4 font-semibold">24h Vol</th>
                <th className="py-3.5 px-4 font-semibold">Fee Tier</th>
                <th className="py-3.5 px-4 font-semibold">Dynamic APY</th>
                <th className="py-3.5 px-4 font-semibold">Status</th>
                <th className="py-3.5 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200/80 dark:divide-neutral-800/80">
              {filteredPools.map(pool => (
                <tr key={pool.address} className="hover:bg-neutral-50 dark:hover:bg-[#1c202c]/50 transition-colors">
                  <td className="py-4 px-4 font-medium">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 flex items-center justify-center font-bold text-xs text-emerald-500">
                        {pool.targetSymbol[0]}
                      </div>
                      <div>
                        <div className="font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                          {pool.reserveSymbol} / {pool.targetSymbol}
                        </div>
                        <div className="font-mono text-[10px] text-neutral-500 truncate max-w-[140px]">
                          {pool.address}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200">
                      <Repeat className="w-2.5 h-2.5 text-emerald-500" /> DLMM Bin
                    </span>
                  </td>
                  <td className="py-4 px-4 font-mono">
                    <div className="font-bold text-neutral-900 dark:text-white">$${pool.tvlUsd.toLocaleString()}</div>
                    <div className="text-[10px] text-neutral-500">{(pool.tvlSats / 1e8).toFixed(2)} BCH</div>
                  </td>
                  <td className="py-4 px-4 font-mono text-neutral-800 dark:text-neutral-200">
                    $${pool.volume24hUsd.toLocaleString()}
                  </td>
                  <td className="py-4 px-4 font-mono text-neutral-600 dark:text-neutral-400">
                    {(pool.feeBps / 100).toFixed(2)}%
                  </td>
                  <td className="py-4 px-4 font-mono">
                    <span className="text-emerald-500 font-bold">+{pool.apyPct.toFixed(1)}%</span>
                  </td>
                  <td className="py-4 px-4">
                    <TacticalBadge status="optimal" />
                  </td>
                  <td className="py-4 px-4 text-right">
                    <div className="inline-flex items-center gap-2">
                      <TactileButton
                        size="xs"
                        variant="outline"
                        onClick={() => handleProvide(pool)}
                      >
                        Add Bins
                      </TactileButton>
                      <TactileButton
                        size="xs"
                        variant="primary"
                        onClick={() => handleStrategy(pool)}
                      >
                        Strategy
                      </TactileButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
