import React, { useState } from 'react';
import { useMeshApp } from '@/context/MeshAppContext';
import { ARCHETYPES, type StrategyArchetype } from '@/lib/meshApi';
import { TactileInput } from '@/components/ui/TactileInput';
import { TactileButton } from '@/components/ui/TactileButton';
import { TacticalBadge } from '@/components/ui/TacticalBadge';
import {
  Sparkles,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Repeat,
  Zap,
  Scale,
  Flame,
  SlidersHorizontal,
  ChevronDown,
  Info,
  BookOpen,
} from 'lucide-react';

export function MeshStrategyStudio() {
  const { selectedTemplate, setSelectedTemplate, bchBalance, tokenBalances, addPosition, setSubTab } = useMeshApp();

  const [activeTab, setActiveTab] = useState<'gallery' | 'builder'>(selectedTemplate ? 'builder' : 'gallery');
  const [templateId, setTemplateId] = useState<string>(selectedTemplate ?? 'recycling-pair');

  // Builder form inputs
  const [tokenSymbol, setTokenSymbol] = useState('pUSD');
  const [price, setPrice] = useState('357.25');
  const [feeBps, setFeeBps] = useState('30');
  const [proceeds, setProceeds] = useState<'recycle' | 'wallet'>('recycle');
  const [depositBch, setDepositBch] = useState('2.50');
  const [depositToken, setDepositToken] = useState('893.12');
  const [preset, setPreset] = useState<'tight' | 'balanced' | 'wide' | 'custom'>('balanced');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const currentArch = ARCHETYPES.find(a => a.id === templateId) ?? ARCHETYPES[0];

  const handlePick = (id: string) => {
    setTemplateId(id);
    setSelectedTemplate(id);
    setActiveTab('builder');
  };

  const applyPreset = (p: 'tight' | 'balanced' | 'wide') => {
    setPreset(p);
    const mid = 357.25;
    const pct = p === 'tight' ? 1.5 : p === 'balanced' ? 5.0 : 15.0;
    setPrice((mid * (1 + pct / 100)).toFixed(2));
  };

  const handleDeploy = () => {
    setLoading(true);
    setTimeout(() => {
      addPosition({
        name: `${currentArch.name} (${tokenSymbol})`,
        template: templateId,
        pair: `BCH / ${tokenSymbol}`,
        depositBch: parseFloat(depositBch) || 0,
        depositTokens: parseFloat(depositToken) || 0,
        tokenSymbol,
        valueUsd: (parseFloat(depositBch) || 0) * 357.5 + (parseFloat(depositToken) || 0),
        status: 'optimal',
        minPrice: parseFloat(price) * 0.95,
        maxPrice: parseFloat(price) * 1.05,
        currentPrice: 357.25,
      });
      setLoading(false);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setSubTab('portfolio');
      }, 1000);
    }, 600);
  };

  return (
    <div className="space-y-6">
      {/* Top Studio Switcher */}
      <div className="flex items-center justify-between border-b border-neutral-300 dark:border-neutral-800 pb-4">
        <div className="flex items-center gap-2">
          <TactileButton
            size="sm"
            variant={activeTab === 'gallery' ? 'primary' : 'outline'}
            onClick={() => setActiveTab('gallery')}
          >
            Curated Archetypes ({ARCHETYPES.length})
          </TactileButton>
          <TactileButton
            size="sm"
            variant={activeTab === 'builder' ? 'primary' : 'outline'}
            onClick={() => setActiveTab('builder')}
          >
            Custom Strategy Studio
          </TactileButton>
        </div>

        <a
          href="/docs/mesh/strategies/configuration-guide"
          target="_blank"
          className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 hover:text-emerald-500 transition-colors flex items-center gap-1.5 font-mono"
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Strategy Design Docs</span>
        </a>
      </div>

      {activeTab === 'gallery' ? (
        /* Archetypes Gallery View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {ARCHETYPES.map(arch => (
            <div
              key={arch.id}
              className="p-5 rounded-2xl bg-white dark:bg-[#151821] border border-neutral-300 dark:border-neutral-800 space-y-3.5 hover:border-neutral-400 dark:hover:border-neutral-600 transition-all flex flex-col justify-between shadow-xs"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-extrabold text-base text-neutral-900 dark:text-white">{arch.name}</h3>
                  <div className="flex items-center gap-1.5">
                    {arch.recycles && (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1 font-bold">
                        <Repeat className="w-2.5 h-2.5" /> Recycles
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-neutral-500 uppercase font-semibold">{arch.category}</span>
                  </div>
                </div>
                <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">{arch.summary}</p>
              </div>

              <div className="space-y-2 pt-2 border-t border-neutral-200 dark:border-neutral-800 text-[11px] font-mono">
                <div className="flex justify-between text-neutral-500">
                  <span>Est. APY:</span>
                  <span className="text-emerald-500 font-bold">{arch.estApy}</span>
                </div>
                <div className="flex justify-between text-neutral-500">
                  <span>Deposit:</span>
                  <span className="text-neutral-800 dark:text-neutral-200">{arch.deposit}</span>
                </div>
                <div className="flex justify-between text-neutral-500">
                  <span>Risk Level:</span>
                  <span className="text-amber-500 font-semibold">{arch.risk}</span>
                </div>
              </div>

              <TactileButton
                variant="primary"
                size="md"
                className="w-full"
                onClick={() => handlePick(arch.id)}
              >
                <span>Configure Strategy</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </TactileButton>
            </div>
          ))}
        </div>
      ) : (
        /* Interactive Strategy Builder View */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Form & Presets */}
          <div className="lg:col-span-7 space-y-4">
            <div className="p-5 rounded-2xl bg-white dark:bg-[#151821] border border-neutral-300 dark:border-neutral-800 space-y-4 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-neutral-200 dark:border-neutral-800">
                <div>
                  <h3 className="font-bold text-lg text-neutral-900 dark:text-white">{currentArch.name}</h3>
                  <p className="text-xs text-neutral-500 font-mono mt-0.5">{currentArch.summary}</p>
                </div>
                <TacticalBadge status="optimal" label="Sovereign Covenant" />
              </div>

              {/* Range Presets Selector */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 font-mono uppercase tracking-wider">
                  Range & Volatility Presets
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => applyPreset('tight')}
                    className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                      preset === 'tight' ? 'border-emerald-500 bg-emerald-950/20 text-white ring-1 ring-emerald-500/30' : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-[#0e1017] text-neutral-500 hover:border-neutral-400'
                    }`}
                  >
                    <div className="text-xs font-bold flex items-center gap-1 text-neutral-900 dark:text-white"><Zap className="w-3 h-3 text-emerald-400" /> Tight (±1.5%)</div>
                    <div className="text-[10px] text-neutral-500 font-mono">Max fee velocity</div>
                  </button>
                  <button
                    onClick={() => applyPreset('balanced')}
                    className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                      preset === 'balanced' ? 'border-emerald-500 bg-emerald-950/20 text-white ring-1 ring-emerald-500/30' : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-[#0e1017] text-neutral-500 hover:border-neutral-400'
                    }`}
                  >
                    <div className="text-xs font-bold flex items-center gap-1 text-neutral-900 dark:text-white"><Scale className="w-3 h-3 text-emerald-400" /> Balanced (±5%)</div>
                    <div className="text-[10px] text-neutral-500 font-mono">Recommended</div>
                  </button>
                  <button
                    onClick={() => applyPreset('wide')}
                    className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                      preset === 'wide' ? 'border-emerald-500 bg-emerald-950/20 text-white ring-1 ring-emerald-500/30' : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-[#0e1017] text-neutral-500 hover:border-neutral-400'
                    }`}
                  >
                    <div className="text-xs font-bold flex items-center gap-1 text-neutral-900 dark:text-white"><Flame className="w-3 h-3 text-emerald-400" /> Wide (±15%)</div>
                    <div className="text-[10px] text-neutral-500 font-mono">Low maintenance</div>
                  </button>
                </div>
              </div>

              {/* Fee Tier Selector */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 font-mono uppercase tracking-wider">
                  Fee Tier Selector
                </span>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { bps: '5', label: '0.05%', name: 'Pegged' },
                    { bps: '30', label: '0.30%', name: 'Standard' },
                    { bps: '50', label: '0.50%', name: 'Volatile' },
                    { bps: '100', label: '1.00%', name: 'Exotic' },
                  ].map(t => (
                    <button
                      key={t.bps}
                      onClick={() => setFeeBps(t.bps)}
                      className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                        feeBps === t.bps ? 'border-emerald-500 bg-emerald-950/20 text-white ring-1 ring-emerald-500/30' : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-[#0e1017] text-neutral-500 hover:border-neutral-400'
                      }`}
                    >
                      <div className="font-mono text-xs font-bold text-emerald-500">{t.label}</div>
                      <div className="text-[10px] text-neutral-500">{t.name}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Proceeds Mode */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 font-mono uppercase tracking-wider">
                  Proceeds Destination
                </span>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    onClick={() => setProceeds('recycle')}
                    className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all ${
                      proceeds === 'recycle' ? 'border-emerald-500 bg-emerald-950/20 text-white ring-1 ring-emerald-500/30' : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-[#0e1017] text-neutral-500 hover:border-neutral-400'
                    }`}
                  >
                    <div className="text-xs font-bold flex items-center gap-1.5 text-neutral-900 dark:text-white">
                      <Repeat className="w-3.5 h-3.5 text-emerald-400" /> Keep in Mesh (Recycle)
                    </div>
                    <div className="text-[10px] text-neutral-500 mt-1">Fills fund reverse mirror pool automatically</div>
                  </button>
                  <button
                    onClick={() => setProceeds('wallet')}
                    className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all ${
                      proceeds === 'wallet' ? 'border-emerald-500 bg-emerald-950/20 text-white ring-1 ring-emerald-500/30' : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-[#0e1017] text-neutral-500 hover:border-neutral-400'
                    }`}
                  >
                    <div className="text-xs font-bold flex items-center gap-1.5 text-neutral-900 dark:text-white">
                      Pay to My Wallet
                    </div>
                    <div className="text-[10px] text-neutral-500 mt-1">Direct sweep to CashAddress</div>
                  </button>
                </div>
              </div>

              {/* Deposit Inputs */}
              <div className="space-y-3 pt-1">
                <TactileInput
                  label="Target Execution Price (1 BCH = P tokens)"
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  suffix={tokenSymbol}
                />

                <TactileInput
                  label="BCH Deposit Amount"
                  balanceHint={`Bal: ${bchBalance.toFixed(4)} BCH`}
                  value={depositBch}
                  onChange={e => setDepositBch(e.target.value)}
                  suffix="BCH"
                  onMax={() => setDepositBch(Math.max(0, bchBalance - 0.001).toFixed(4))}
                  onFraction={f => setDepositBch((bchBalance * f).toFixed(4))}
                />

                <TactileInput
                  label={`${tokenSymbol} Deposit Amount`}
                  balanceHint={`Bal: ${(tokenBalances[tokenSymbol] ?? 0).toLocaleString()} ${tokenSymbol}`}
                  value={depositToken}
                  onChange={e => setDepositToken(e.target.value)}
                  suffix={tokenSymbol}
                  onMax={() => setDepositToken(String(tokenBalances[tokenSymbol] ?? 0))}
                  onFraction={f => setDepositToken(String(Math.floor((tokenBalances[tokenSymbol] ?? 0) * f)))}
                />
              </div>
            </div>
          </div>

          {/* Right Column: Pre-Flight Verification & Deploy */}
          <div className="lg:col-span-5 space-y-4">
            <div className="p-5 rounded-2xl bg-white dark:bg-[#151821] border border-neutral-300 dark:border-neutral-800 space-y-4 shadow-xs">
              <h3 className="font-bold text-base text-neutral-900 dark:text-white font-mono uppercase tracking-wider">
                Pre-Flight Contract Verification
              </h3>

              <div className="space-y-2 text-xs font-mono">
                <div className="p-3 rounded-xl bg-neutral-50 dark:bg-[#0e1017] border border-neutral-200 dark:border-neutral-800 space-y-1">
                  <div className="text-neutral-500">Contract Bytecode:</div>
                  <div className="text-neutral-900 dark:text-white font-bold">MeshPoolV3.cash (Verified)</div>
                </div>
                <div className="p-3 rounded-xl bg-neutral-50 dark:bg-[#0e1017] border border-neutral-200 dark:border-neutral-800 space-y-1">
                  <div className="text-neutral-500">Target Pools to Open:</div>
                  <div className="text-neutral-900 dark:text-white font-bold">2 Autonomous Covenants (Bid + Mirror Ask)</div>
                </div>
                <div className="p-3 rounded-xl bg-neutral-50 dark:bg-[#0e1017] border border-neutral-200 dark:border-neutral-800 space-y-1">
                  <div className="text-neutral-500">Estimated Gas Fee:</div>
                  <div className="text-emerald-500 font-bold">250 sats (1 sat/byte)</div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-500" />
                <span>100% Non-Custodial: Only your private key can execute sovereign dock spend path.</span>
              </div>

              <TactileButton
                variant="emerald"
                size="lg"
                className="w-full h-12"
                loading={loading}
                onClick={handleDeploy}
              >
                {success ? 'Deploying Strategy Covenants...' : 'Deploy Strategy (1 Sat Fee)'}
              </TactileButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
