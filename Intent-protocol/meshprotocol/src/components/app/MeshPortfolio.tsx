import React from 'react';
import { useMeshApp } from '@/context/MeshAppContext';
import { MetricCard } from '@/components/ui/MetricCard';
import { TacticalBadge } from '@/components/ui/TacticalBadge';
import { TactileButton } from '@/components/ui/TactileButton';
import { PieChart, Repeat, ArrowUpRight, MinusCircle, RefreshCw, CheckCircle2 } from 'lucide-react';

export function MeshPortfolio() {
  const { positions, dockPosition, claimFees, bchBalance } = useMeshApp();

  const totalValue = positions.reduce((a, b) => a + b.valueUsd, 0);
  const totalFeesSats = positions.reduce((a, b) => a + b.feesEarnedSats, 0);
  const totalPnl = positions.reduce((a, b) => a + b.pnlUsd, 0);

  return (
    <div className="space-y-6">
      {/* Portfolio Telemetry Bar using MetricCard */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <MetricCard
          label="Deposited Strategy Value"
          value={`$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subValue={`Across ${positions.length} active covenants`}
        />
        <MetricCard
          label="Total Accrued Fees"
          value={`${totalFeesSats.toLocaleString()} sats`}
          subValue={`≈ $${((totalFeesSats / 1e8) * 357.5).toFixed(2)} USD`}
          delta={{ value: "Live Accruing", isPositive: true }}
        />
        <MetricCard
          label="Total Net P&L"
          value={`+$${totalPnl.toFixed(2)}`}
          subValue="Fees + Spread profit"
          delta={{ value: "Net Positive", isPositive: true }}
        />
        <MetricCard
          label="Weighted Strategy APY"
          value="26.4%"
          subValue="Dynamic compounding"
          delta={{ value: "Real Yield", isPositive: true }}
        />
      </div>

      {/* Positions List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-base text-neutral-900 dark:text-white font-mono uppercase tracking-wider">
            Active Strategy Positions ({positions.length})
          </h3>
          <span className="text-xs text-neutral-500 font-mono">
            Sovereign UTXOs verified on Bitcoin Cash
          </span>
        </div>

        {positions.length === 0 ? (
          <div className="p-12 text-center rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-800 text-neutral-500 text-xs font-mono">
            No active positions deployed yet. Visit Strategy Studio to open one.
          </div>
        ) : (
          <div className="space-y-3">
            {positions.map(pos => {
              const inRange = pos.currentPrice >= pos.minPrice && pos.currentPrice <= pos.maxPrice;
              return (
                <div
                  key={pos.id}
                  className="p-5 rounded-2xl bg-white dark:bg-[#151821] border border-neutral-300 dark:border-neutral-800 space-y-4 hover:border-neutral-400 dark:hover:border-neutral-600 transition-all shadow-xs"
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <span className="font-bold text-base text-neutral-900 dark:text-white">{pos.name}</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200">
                          {pos.pair}
                        </span>
                      </div>
                      <div className="font-mono text-[11px] text-neutral-500 mt-0.5">
                        {pos.id} · {pos.recyclesCount} Mirror Recycles Completed
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <TacticalBadge status={inRange ? 'in-range' : 'rebalancing'} />
                    </div>
                  </div>

                  {/* Mini-Bin Range Visualizer */}
                  <div className="p-3 rounded-xl bg-neutral-50 dark:bg-[#0e1017] border border-neutral-200 dark:border-neutral-800 space-y-1.5 font-mono">
                    <div className="flex justify-between text-[10px] text-neutral-500">
                      <span>Min: {pos.minPrice}</span>
                      <span className="text-sky-400 font-bold">Mid: {pos.currentPrice}</span>
                      <span>Max: {pos.maxPrice}</span>
                    </div>
                    <div className="h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 relative overflow-hidden">
                      <div
                        className="absolute top-0 bottom-0 bg-emerald-500 rounded-full"
                        style={{
                          left: '25%',
                          width: '50%',
                        }}
                      />
                      <div
                        className="absolute top-0 bottom-0 w-1 bg-white shadow-xs"
                        style={{ left: '48%' }}
                      />
                    </div>
                  </div>

                  {/* Metrics Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                    <div>
                      <div className="text-neutral-500 text-[10px] uppercase">Position Value</div>
                      <div className="font-bold text-neutral-900 dark:text-white">$${pos.valueUsd.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-neutral-500 text-[10px] uppercase">Deposited</div>
                      <div className="text-neutral-700 dark:text-neutral-300">
                        {pos.depositBch} BCH + {pos.depositTokens} {pos.tokenSymbol}
                      </div>
                    </div>
                    <div>
                      <div className="text-neutral-500 text-[10px] uppercase">Accrued Fees</div>
                      <div className="font-bold text-emerald-500">{pos.feesEarnedSats} sats</div>
                    </div>
                    <div>
                      <div className="text-neutral-500 text-[10px] uppercase">Net P&L</div>
                      <div className="font-bold text-emerald-500">+$${pos.pnlUsd.toFixed(2)}</div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-neutral-200 dark:border-neutral-800">
                    <TactileButton
                      size="sm"
                      variant="outline"
                      disabled={pos.feesEarnedSats === 0}
                      onClick={() => claimFees(pos.id)}
                    >
                      Sweep Fees ({pos.feesEarnedSats} sats)
                    </TactileButton>
                    <TactileButton
                      size="sm"
                      variant="destructive"
                      onClick={() => dockPosition(pos.id)}
                    >
                      Sovereign Dock Exit
                    </TactileButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
