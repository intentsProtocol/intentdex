import React from 'react';
import { CornerCrosshair } from '@/components/common/MeshWireframeBox';

export interface MetricCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  delta?: { value: string; isPositive: boolean };
  icon?: React.ReactNode;
  className?: string;
}

export function MetricCard({ label, value, subValue, delta, icon, className = '' }: MetricCardProps) {
  return (
    <div className={`p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#151821] border border-neutral-200/90 dark:border-neutral-800/90 relative overflow-hidden shadow-xs hover:border-neutral-400 dark:hover:border-neutral-600 transition-all ${className}`}>
      <CornerCrosshair className="-left-1.5 -top-1.5" />
      <CornerCrosshair className="-right-1.5 -top-1.5" />
      <CornerCrosshair className="-left-1.5 -bottom-1.5" />
      <CornerCrosshair className="-right-1.5 -bottom-1.5" />

      <div className="flex items-center justify-between text-neutral-500 font-mono text-[10px] uppercase tracking-wider mb-1">
        <span>{label}</span>
        {icon}
      </div>

      <div className="text-xl sm:text-2xl font-black font-mono tracking-tight text-neutral-900 dark:text-white">
        {value}
      </div>

      {(subValue || delta) && (
        <div className="flex items-center gap-2 mt-1 font-mono text-[11px]">
          {delta && (
            <span className={`font-bold ${delta.isPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
              {delta.isPositive ? '+' : ''}{delta.value}
            </span>
          )}
          {subValue && <span className="text-neutral-500">{subValue}</span>}
        </div>
      )}
    </div>
  );
}
