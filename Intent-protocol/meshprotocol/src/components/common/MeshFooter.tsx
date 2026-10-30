import React from 'react';
import { useMesh } from '@/context/MeshContext';
import { CornerCrosshair } from './MeshWireframeBox';
import { MeshLogo } from './MeshLogo';
import { ArrowUpRight } from 'lucide-react';

export function MeshFooter() {
  const { language, setActiveTab } = useMesh();
  const isZh = language === 'zh';

  return (
    <footer className="border-b border-[#cbd5e1] dark:border-[#262e42] px-4 sm:px-6 relative bg-white dark:bg-[#090d14] transition-colors duration-200">
      <div className="border-x border-[#cbd5e1] dark:border-[#262e42] relative max-w-7xl mx-auto pt-16 sm:pt-20 pb-0 px-6 sm:px-10 lg:px-12 overflow-hidden">
        <CornerCrosshair className="-left-3 -top-3" />
        <CornerCrosshair className="-right-3 -top-3" />
        <CornerCrosshair className="-left-3 -bottom-3" />
        <CornerCrosshair className="-right-3 -bottom-3" />

        {/* 5-Column Navigation Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 sm:gap-10 pb-16 text-left">
          {/* Col 1: Brand & Ethos */}
          <div className="col-span-2 md:col-span-1 space-y-3.5">
            <MeshLogo size={36} showText={true} />
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed pr-2">
              Sovereign discrete liquidity protocol and autonomous strategy engine engineered natively on Bitcoin Cash UTXO covenants.
            </p>
          </div>

          {/* Col 2: Navigation */}
          <div className="space-y-3">
            <h4 className="font-semibold text-xs text-slate-900 dark:text-slate-100 tracking-tight uppercase font-mono">
              Terminal
            </h4>
            <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400 font-medium">
              <li>
                <button
                  onClick={() => { setActiveTab('landing'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer text-left"
                >
                  Overview
                </button>
              </li>
              <li>
                <button
                  onClick={() => { setActiveTab('app'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer text-left"
                >
                  Liquidity Pools
                </button>
              </li>
              <li>
                <button
                  onClick={() => { setActiveTab('app'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer text-left"
                >
                  Strategy Studio
                </button>
              </li>
              <li>
                <button
                  onClick={() => { setActiveTab('docs'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer text-left"
                >
                  Developer Docs
                </button>
              </li>
            </ul>
          </div>

          {/* Col 3: Architecture */}
          <div className="space-y-3">
            <h4 className="font-semibold text-xs text-slate-900 dark:text-slate-100 tracking-tight uppercase font-mono">
              Technology
            </h4>
            <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400 font-medium">
              <li><span className="text-slate-600 dark:text-slate-400">MeshPoolV3 Covenants</span></li>
              <li><span className="text-slate-600 dark:text-slate-400">CashScript v0.10</span></li>
              <li><span className="text-slate-600 dark:text-slate-400">CashTokens Standard</span></li>
              <li><span className="text-slate-600 dark:text-slate-400">Nostr NIP-90 Intents</span></li>
            </ul>
          </div>

          {/* Col 4: Ecosystem */}
          <div className="space-y-3">
            <h4 className="font-semibold text-xs text-slate-900 dark:text-slate-100 tracking-tight uppercase font-mono">
              Ecosystem
            </h4>
            <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400 font-medium">
              <li><a href="https://bitcoincash.org" target="_blank" rel="noreferrer" className="hover:text-slate-900 dark:hover:text-white">Bitcoin Cash L1</a></li>
              <li><a href="https://cashtokens.org" target="_blank" rel="noreferrer" className="hover:text-slate-900 dark:hover:text-white">CashTokens.org</a></li>
              <li><a href="https://cashscript.org" target="_blank" rel="noreferrer" className="hover:text-slate-900 dark:hover:text-white">CashScript.org</a></li>
              <li><a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-slate-900 dark:hover:text-white">GitHub Sources</a></li>
            </ul>
          </div>

          {/* Col 5: Legal & Security */}
          <div className="space-y-3">
            <h4 className="font-semibold text-xs text-slate-900 dark:text-slate-100 tracking-tight uppercase font-mono">
              Security
            </h4>
            <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400 font-medium">
              <li><span className="text-emerald-500 font-bold">100% Non-Custodial</span></li>
              <li><span className="text-slate-600 dark:text-slate-400">Apache 2.0 Open Source</span></li>
              <li><span className="text-slate-600 dark:text-slate-400">Chipnet Audited</span></li>
            </ul>
          </div>
        </div>

        {/* GIANT WATERMARK DISPLAY */}
        <div className="relative pt-6 pb-2 select-none pointer-events-none flex items-center justify-center">
          <div className="w-full text-center">
            <span className="font-black text-[16vw] tracking-tighter uppercase leading-none font-mono block text-slate-900/[0.04] dark:text-white/[0.05] bg-gradient-to-b from-slate-900/[0.08] to-transparent dark:from-white/10 dark:to-transparent bg-clip-text text-transparent transform translate-y-3">
              MESH FINANCE
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
