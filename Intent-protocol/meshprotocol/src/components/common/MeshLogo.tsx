import React from 'react';
import { cn } from '@/lib/utils';
import { useMesh } from '@/context/MeshContext';

interface MeshLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
  variant?: 'icon' | 'full' | 'badge';
}

export function MeshLogo({
  size = 36,
  className,
  showText = true,
  variant = 'full',
}: MeshLogoProps) {
  const { theme } = useMesh();
  const isDark = theme === 'dark';

  return (
    <div className={cn("inline-flex items-center gap-2.5 select-none cursor-pointer group", className)}>
      {/* The MF Monogram Icon Badge */}
      <div
        className="relative shrink-0 flex items-center justify-center transition-transform duration-200 group-hover:scale-105"
        style={{ width: size, height: size }}
      >
        {/* Glowing backdrop in dark mode */}
        {isDark && (
          <div className="absolute inset-0 rounded-2xl bg-emerald-500/20 blur-md pointer-events-none group-hover:bg-emerald-400/35 transition-colors" />
        )}

        <svg
          viewBox="0 0 120 120"
          className="w-full h-full drop-shadow-sm"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="compMfGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#10B981" />
              <stop offset="45%" stopColor="#00F298" />
              <stop offset="100%" stopColor="#06B6D4" />
            </linearGradient>
            <linearGradient id="compPlateGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={isDark ? "#171D2B" : "#F8FAFC"} />
              <stop offset="100%" stopColor={isDark ? "#0A0D15" : "#E2E8F0"} />
            </linearGradient>
            <linearGradient id="compBorderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#2DD4BF" stopOpacity="0.8" />
              <stop offset="50%" stopColor="#06B6D4" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#10B981" stopOpacity="0.8" />
            </linearGradient>
            <filter id="compGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Chamfered Squircle Shield */}
          <rect
            x="6"
            y="6"
            width="108"
            height="108"
            rx="26"
            fill="url(#compPlateGrad)"
            stroke="url(#compBorderGrad)"
            strokeWidth="2.5"
          />

          {/* Internal Matrix Guidelines */}
          <path
            d="M24 60 H96 M60 24 V96 M34 34 L86 86 M86 34 L34 86"
            stroke={isDark ? "#222C40" : "#CBD5E1"}
            strokeWidth="1"
            strokeDasharray="2 3"
            opacity="0.5"
          />

          {/* Left Leg of M */}
          <path
            d="M30 84 V36"
            stroke="url(#compMfGrad)"
            strokeWidth="6.5"
            strokeLinecap="round"
          />

          {/* M Diagonal Down */}
          <path
            d="M30 36 L56 62"
            stroke="url(#compMfGrad)"
            strokeWidth="6.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* M Diagonal Up / Stem of F */}
          <path
            d="M56 62 L78 36"
            stroke="url(#compMfGrad)"
            strokeWidth="6.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stem of F descending */}
          <path
            d="M78 36 V84"
            stroke="url(#compMfGrad)"
            strokeWidth="6.5"
            strokeLinecap="round"
          />

          {/* Top Bar of F */}
          <path
            d="M78 36 H96"
            stroke="url(#compMfGrad)"
            strokeWidth="6.5"
            strokeLinecap="round"
          />

          {/* Mid Bar of F */}
          <path
            d="M78 58 H92"
            stroke="url(#compMfGrad)"
            strokeWidth="6"
            strokeLinecap="round"
          />

          {/* Diagonal Cross-Lattice */}
          <path
            d="M30 60 L56 62 M56 62 L78 84"
            stroke="#06B6D4"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.65"
          />

          {/* Constellation Nodes */}
          <circle cx="30" cy="36" r="4.5" fill="#10B981" />
          <circle cx="30" cy="84" r="4.5" fill="#10B981" />
          <circle cx="56" cy="62" r="6" fill="#00F298" filter="url(#compGlow)" />
          <circle cx="78" cy="36" r="5" fill="#00D8F6" />
          <circle cx="78" cy="84" r="4.5" fill="#06B6D4" />
          <circle cx="96" cy="36" r="4" fill="#38BDF8" />
          <circle cx="92" cy="58" r="4" fill="#34D399" />
        </svg>
      </div>

      {/* Typography: Mesh Finance */}
      {showText && (
        <div className="flex flex-col leading-none">
          <div className="font-extrabold text-base sm:text-lg tracking-tight flex items-center gap-1.5">
            <span className={isDark ? "text-white" : "text-slate-900"}>Mesh</span>
            <span className="bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 bg-clip-text text-transparent font-black">
              Finance
            </span>
          </div>
          <span className="text-[9px] font-mono tracking-widest uppercase font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
            UTXO DEFI PROTOCOL
          </span>
        </div>
      )}
    </div>
  );
}
