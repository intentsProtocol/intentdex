import React, { useState } from 'react';
import { useMesh } from '@/context/MeshContext';
import { CornerCrosshair } from '@/components/common/MeshWireframeBox';
import { FileCode, Shield, Terminal } from 'lucide-react';

export function MeshCovenantVisualizer() {
  const { t } = useMesh();
  const [activePath, setActivePath] = useState<'dock' | 'fill'>('dock');

  const dockCode = `// Spend Path 1: Sovereign Exit (dock)
contract StrategyCovenantV3(pubkey ownerKey, bytes20 tokenCategory, int priceNum, int priceDenom) {
    function dock(sig ownerSig) {
        // Only the creator's key can trigger sovereign refund
        require(checkSig(ownerSig, ownerKey));
        // 100% of remaining BCH and CashTokens returned to owner UTXO
    }
}`;

  const fillCode = `// Spend Path 2: Atomic Intent Settlement & Perpetual Recycling (fill)
contract StrategyCovenantV3(pubkey ownerKey, bytes20 tokenCategory, int priceNum, int priceDenom) {
    function fill(int inputBch, int outputTokens) {
        // Enforce deterministic price curve on-chain:
        require(inputBch * priceDenom >= outputTokens * priceNum);
        // Direct proceeds into counter-mirror covenant in same tx loop:
        require(tx.outputs[0].lockingBytecode == tx.inputs[this.activeInputIndex].lockingBytecode);
    }
}`;

  return (
    <section id="covenant" className="border-b border-[#c0c2c4] dark:border-neutral-800 px-4 sm:px-6 relative">
      <div className="border-x border-[#c0c2c4] dark:border-neutral-800 relative max-w-7xl mx-auto py-16 sm:py-24 px-6 sm:px-10 lg:px-12 text-center">
        <CornerCrosshair className="-left-3 -top-3" />
        <CornerCrosshair className="-right-3 -top-3" />
        <CornerCrosshair className="-left-3 -bottom-3" />
        <CornerCrosshair className="-right-3 -bottom-3" />

        {/* Pill Tag */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-300 dark:border-neutral-700 bg-neutral-100/80 dark:bg-neutral-800/60 text-xs text-neutral-600 dark:text-neutral-400 font-medium mb-3">
          <FileCode className="w-3.5 h-3.5" />
          <span>{t.covenant.kicker}</span>
        </div>

        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 mb-3 max-w-3xl mx-auto">
          {t.covenant.title}
        </h2>
        <p className="text-neutral-600 dark:text-neutral-400 text-sm sm:text-base max-w-2xl mx-auto mb-10">
          {t.covenant.subtitle}
        </p>

        {/* Code Visualizer Box */}
        <div className="max-w-4xl mx-auto rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#121215] shadow-xs p-6 sm:p-8 text-left space-y-5">
          {/* Spend Path Tabs */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActivePath('dock')}
              className={`px-4 py-2 rounded-xl text-xs font-mono font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                activePath === 'dock'
                  ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-xs'
                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>{t.covenant.dockPath}</span>
            </button>
            <button
              onClick={() => setActivePath('fill')}
              className={`px-4 py-2 rounded-xl text-xs font-mono font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                activePath === 'fill'
                  ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-xs'
                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>{t.covenant.fillPath}</span>
            </button>
          </div>

          {/* Description */}
          <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed font-mono">
            <span className="font-semibold text-neutral-900 dark:text-white uppercase block mb-1">
              {activePath === 'dock' ? 'Sovereign Guarantee' : 'Mathematical Constraint'}
            </span>
            {activePath === 'dock' ? t.covenant.dockDesc : t.covenant.fillDesc}
          </div>

          {/* CashScript Code Block */}
          <div className="rounded-xl bg-neutral-950 text-neutral-200 border border-neutral-800 p-4 sm:p-5 overflow-x-auto text-xs font-mono">
            <pre>
              <code>{activePath === 'dock' ? dockCode : fillCode}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
