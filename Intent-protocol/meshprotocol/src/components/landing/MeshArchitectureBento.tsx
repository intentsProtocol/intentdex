import React from 'react';
import { useMesh } from '@/context/MeshContext';
import { CornerCrosshair } from '@/components/common/MeshWireframeBox';
import { ShieldCheck, Cpu, Radio, Coins, Zap, CheckCircle2, XCircle } from 'lucide-react';

export function MeshArchitectureBento() {
  const { t } = useMesh();

  return (
    <section id="architecture" className="border-b border-[#c0c2c4] dark:border-neutral-800 px-4 sm:px-6 relative">
      <div className="border-x border-[#c0c2c4] dark:border-neutral-800 relative max-w-7xl mx-auto py-16 sm:py-24 px-6 sm:px-10 lg:px-12 text-center">
        <CornerCrosshair className="-left-3 -top-3" />
        <CornerCrosshair className="-right-3 -top-3" />
        <CornerCrosshair className="-left-3 -bottom-3" />
        <CornerCrosshair className="-right-3 -bottom-3" />

        {/* Pill Tag */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-300 dark:border-neutral-700 bg-neutral-100/80 dark:bg-neutral-800/60 text-xs text-neutral-600 dark:text-neutral-400 font-medium mb-3">
          <Cpu className="w-3.5 h-3.5" />
          <span>{t.architecture.kicker}</span>
        </div>

        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 mb-3 max-w-3xl mx-auto">
          {t.architecture.title}
        </h2>
        <p className="text-neutral-600 dark:text-neutral-400 text-sm sm:text-base max-w-2xl mx-auto mb-12">
          {t.architecture.subtitle}
        </p>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-left">
          {/* Card 1: Zero Pool Contagion (Large 2 Cols) */}
          <div className="lg:col-span-2 p-7 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#121215] shadow-xs flex flex-col justify-between">
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-800 dark:text-neutral-200 mb-4">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-lg text-neutral-900 dark:text-neutral-100">
                {t.architecture.card1Title}
              </h3>
              <p className="text-neutral-500 dark:text-neutral-400 text-xs sm:text-sm leading-relaxed max-w-xl">
                {t.architecture.card1Desc}
              </p>
            </div>

            {/* Comparison */}
            <div className="grid sm:grid-cols-2 gap-3 mt-6 pt-5 border-t border-neutral-100 dark:border-neutral-800">
              <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 space-y-1">
                <div className="flex items-center gap-1.5 text-neutral-500 font-mono text-xs font-semibold">
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Pooled AMM (Uniswap/Raydium)</span>
                </div>
                <p className="text-[11px] text-neutral-500 leading-snug">
                  Shared smart contract state. Vulnerable to reentrancy, oracle drainage, and sandwich bot frontrunning.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 space-y-1">
                <div className="flex items-center gap-1.5 text-neutral-900 dark:text-white font-mono text-xs font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>BCHMesh Protocol</span>
                </div>
                <p className="text-[11px] text-neutral-500 leading-snug">
                  Every position is its own discrete UTXO. 0% pool drainage risk. Only creator key can release capital.
                </p>
              </div>
            </div>
          </div>

          {/* Card 2: Nostr P2P Gossip */}
          <div className="p-7 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#121215] shadow-xs flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-800 dark:text-neutral-200 mb-4">
                <Radio className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-base text-neutral-900 dark:text-neutral-100 mb-2">
                {t.architecture.card2Title}
              </h3>
              <p className="text-neutral-500 dark:text-neutral-400 text-xs sm:text-sm leading-relaxed mb-4">
                {t.architecture.card2Desc}
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 font-mono text-[11px] text-neutral-500">
              <span className="font-semibold text-neutral-800 dark:text-neutral-200">Nostr NIP-90: </span>
              Off-chain encrypted intent broadcast with zero public mempool exposure.
            </div>
          </div>

          {/* Card 3: Native CashTokens BCMR */}
          <div className="p-7 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#121215] shadow-xs flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-800 dark:text-neutral-200 mb-4">
                <Coins className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-base text-neutral-900 dark:text-neutral-100 mb-2">
                {t.architecture.card3Title}
              </h3>
              <p className="text-neutral-500 dark:text-neutral-400 text-xs sm:text-sm leading-relaxed mb-4">
                {t.architecture.card3Desc}
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 font-mono text-[11px] text-neutral-500">
              <span className="font-semibold text-neutral-800 dark:text-neutral-200">CHIP-2022-02: </span>
              L1 native token introspection with zero EVM wrapped overhead.
            </div>
          </div>

          {/* Card 4: Sub-Penny Gas Execution (Large 2 Cols) */}
          <div className="lg:col-span-2 p-7 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#121215] shadow-xs flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-800 dark:text-neutral-200 mb-4">
                <Zap className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-lg text-neutral-900 dark:text-neutral-100 mb-2">
                {t.architecture.card4Title}
              </h3>
              <p className="text-neutral-500 dark:text-neutral-400 text-xs sm:text-sm leading-relaxed max-w-xl">
                {t.architecture.card4Desc}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-neutral-100 dark:border-neutral-800 font-mono text-xs">
              <span className="px-2.5 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200">
                1 Sat/Byte Flat Rate
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200">
                Direct UTXO Settlement
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200">
                Predictable Scalability
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
