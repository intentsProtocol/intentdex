import React, { useState } from 'react';
import { useMesh } from '@/context/MeshContext';
import { CornerCrosshair } from '@/components/common/MeshWireframeBox';
import { Route, ShieldCheck, ArrowRight } from 'lucide-react';

export function MeshTriRouteSection() {
  const { t, language } = useMesh();
  const [activeRoute, setActiveRoute] = useState<1 | 2 | 3>(1);

  const isZh = language === 'zh';

  return (
    <section id="tri-route" className="border-b border-[#c0c2c4] dark:border-neutral-800 px-4 sm:px-6 relative">
      <div className="border-x border-[#c0c2c4] dark:border-neutral-800 relative max-w-7xl mx-auto py-16 sm:py-24 px-6 sm:px-10 lg:px-12 text-center">
        <CornerCrosshair className="-left-3 -top-3" />
        <CornerCrosshair className="-right-3 -top-3" />
        <CornerCrosshair className="-left-3 -bottom-3" />
        <CornerCrosshair className="-right-3 -bottom-3" />

        {/* Pill Tag */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-300 dark:border-neutral-700 bg-neutral-100/80 dark:bg-neutral-800/60 text-xs text-neutral-600 dark:text-neutral-400 font-medium mb-3">
          <Route className="w-3.5 h-3.5" />
          <span>{t.triRoute.kicker}</span>
        </div>

        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 mb-3 max-w-3xl mx-auto">
          {t.triRoute.title}
        </h2>
        <p className="text-neutral-600 dark:text-neutral-400 text-sm sm:text-base max-w-2xl mx-auto mb-12">
          {t.triRoute.subtitle}
        </p>

        {/* 3 Routes Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          {/* Priority 1 */}
          <div
            onClick={() => setActiveRoute(1)}
            className={`rounded-2xl border p-7 transition-all cursor-pointer flex flex-col justify-between shadow-xs ${
              activeRoute === 1
                ? 'border-neutral-900 dark:border-white bg-white dark:bg-[#121215]'
                : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#121215] opacity-75 hover:opacity-100 hover:border-neutral-300 dark:hover:border-neutral-700'
            }`}
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 font-mono font-bold text-sm flex items-center justify-center text-neutral-800 dark:text-neutral-200 mb-5">
                01
              </div>
              <span className="text-[10px] font-mono font-semibold uppercase text-neutral-500 block mb-1">
                Priority 1 • Zero Slippage
              </span>
              <h3 className="font-semibold text-base text-neutral-900 dark:text-neutral-100 mb-2">
                {t.triRoute.route1Title}
              </h3>
              <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                {t.triRoute.route1Desc}
              </p>
            </div>
          </div>

          {/* Priority 2 */}
          <div
            onClick={() => setActiveRoute(2)}
            className={`rounded-2xl border p-7 transition-all cursor-pointer flex flex-col justify-between shadow-xs ${
              activeRoute === 2
                ? 'border-neutral-900 dark:border-white bg-white dark:bg-[#121215]'
                : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#121215] opacity-75 hover:opacity-100 hover:border-neutral-300 dark:hover:border-neutral-700'
            }`}
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 font-mono font-bold text-sm flex items-center justify-center text-neutral-800 dark:text-neutral-200 mb-5">
                02
              </div>
              <span className="text-[10px] font-mono font-semibold uppercase text-neutral-500 block mb-1">
                Priority 2 • Residual Sweep
              </span>
              <h3 className="font-semibold text-base text-neutral-900 dark:text-neutral-100 mb-2">
                {t.triRoute.route2Title}
              </h3>
              <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                {t.triRoute.route2Desc}
              </p>
            </div>
          </div>

          {/* Priority 3 */}
          <div
            onClick={() => setActiveRoute(3)}
            className={`rounded-2xl border p-7 transition-all cursor-pointer flex flex-col justify-between shadow-xs ${
              activeRoute === 3
                ? 'border-neutral-900 dark:border-white bg-white dark:bg-[#121215]'
                : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#121215] opacity-75 hover:opacity-100 hover:border-neutral-300 dark:hover:border-neutral-700'
            }`}
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 font-mono font-bold text-sm flex items-center justify-center text-neutral-800 dark:text-neutral-200 mb-5">
                03
              </div>
              <span className="text-[10px] font-mono font-semibold uppercase text-neutral-500 block mb-1">
                Priority 3 • Guaranteed Fill
              </span>
              <h3 className="font-semibold text-base text-neutral-900 dark:text-neutral-100 mb-2">
                {t.triRoute.route3Title}
              </h3>
              <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                {t.triRoute.route3Desc}
              </p>
            </div>
          </div>
        </div>

        {/* Guarantee Banner */}
        <div className="mt-8 p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60 flex items-center justify-center gap-3 text-xs font-mono text-neutral-600 dark:text-neutral-400">
          <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{t.triRoute.atomicGuarantee}</span>
        </div>
      </div>
    </section>
  );
}
