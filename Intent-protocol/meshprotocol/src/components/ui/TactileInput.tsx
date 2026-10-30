import React from 'react';

export interface TactileInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  subLabel?: string;
  suffix?: string;
  prefix?: string;
  balanceHint?: string;
  onMax?: () => void;
  onFraction?: (fraction: number) => void;
  error?: string;
}

export function TactileInput({
  label,
  subLabel,
  suffix,
  prefix,
  balanceHint,
  onMax,
  onFraction,
  error,
  className = '',
  ...props
}: TactileInputProps) {
  return (
    <div className="space-y-1.5 text-xs">
      {(label || balanceHint) && (
        <div className="flex items-center justify-between font-mono text-[11px]">
          {label && <span className="font-semibold text-neutral-700 dark:text-neutral-300 uppercase tracking-wider">{label}</span>}
          {balanceHint && (
            <div className="flex items-center gap-1.5 text-neutral-500">
              <span>{balanceHint}</span>
              {onMax && (
                <button
                  type="button"
                  onClick={onMax}
                  className="px-1.5 py-0.2 rounded bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 text-[10px] font-bold text-neutral-700 dark:text-neutral-300 cursor-pointer"
                >
                  MAX
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className={`flex items-center gap-2 p-3 rounded-xl bg-white dark:bg-[#0e1017] border ${
        error
          ? 'border-rose-500/80 ring-1 ring-rose-500/20'
          : 'border-neutral-300 dark:border-neutral-700/80 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500/30'
      } transition-all ${className}`}>
        {prefix && <span className="font-mono text-neutral-500 shrink-0 font-semibold">{prefix}</span>}
        <input
          className="flex-1 bg-transparent font-mono text-sm font-bold text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-600 focus:outline-none"
          {...props}
        />
        {suffix && (
          <span className="font-mono text-xs font-semibold text-neutral-600 dark:text-neutral-300 px-1 shrink-0">
            {suffix}
          </span>
        )}
      </div>

      {onFraction && (
        <div className="flex items-center justify-end gap-1 pt-0.5">
          {[0.25, 0.5, 0.75].map(frac => (
            <button
              key={frac}
              type="button"
              onClick={() => onFraction(frac)}
              className="px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800/80 hover:bg-neutral-200 dark:hover:bg-neutral-700 font-mono text-[10px] text-neutral-600 dark:text-neutral-400 cursor-pointer"
            >
              {frac * 100}%
            </button>
          ))}
        </div>
      )}

      {error && <div className="text-[11px] text-rose-500 font-mono">{error}</div>}
      {subLabel && !error && <div className="text-[10px] text-neutral-500 leading-normal">{subLabel}</div>}
    </div>
  );
}
