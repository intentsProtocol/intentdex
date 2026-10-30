import React from 'react';
import { CheckCircle2, AlertTriangle, ShieldCheck, Repeat, Clock, Radio } from 'lucide-react';

export type BadgeStatus = 'optimal' | 'in-range' | 'rebalancing' | 'warning' | 'idle' | 'recycled';

interface TacticalBadgeProps {
  status: BadgeStatus;
  label?: string;
  className?: string;
}

interface BadgeConfig {
  bg: string;
  dot?: string;
  icon?: React.ReactNode;
  text: string;
}

export function TacticalBadge({ status, label, className = '' }: TacticalBadgeProps) {
  const configs: Record<BadgeStatus, BadgeConfig> = {
    optimal: {
      bg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
      dot: 'bg-emerald-400 animate-pulse',
      text: 'OPTIMAL',
    },
    'in-range': {
      bg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
      dot: 'bg-emerald-400',
      text: 'IN RANGE',
    },
    rebalancing: {
      bg: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30',
      dot: 'bg-amber-400 animate-ping',
      text: 'REBALANCING',
    },
    warning: {
      bg: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30',
      dot: 'bg-rose-400',
      text: 'OUT OF RANGE',
    },
    idle: {
      bg: 'bg-slate-200/60 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700',
      dot: 'bg-slate-400',
      text: 'DOCKED / IDLE',
    },
    recycled: {
      bg: 'bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/30',
      icon: <Repeat className="w-2.5 h-2.5 text-sky-400" />,
      text: 'RECYCLED',
    },
  };

  const c = configs[status] || configs.optimal;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[10px] font-mono font-bold uppercase tracking-wider ${c.bg} ${className}`}>
      {c.dot && <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />}
      {c.icon}
      <span>{label || c.text}</span>
    </span>
  );
}
