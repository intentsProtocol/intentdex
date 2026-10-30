import React from 'react';
import { useMeshApp } from '@/context/MeshAppContext';
import { CornerCrosshair } from '@/components/common/MeshWireframeBox';
import { MeshLogo } from '@/components/common/MeshLogo';
import { Wallet, ShieldCheck, CheckCircle2, X, ExternalLink, Zap } from 'lucide-react';

export function MeshWalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connectWallet, walletConnected, walletAddress, disconnectWallet } = useMeshApp();

  if (!open) return null;

  const WALLETS = [
    {
      id: 'cham',
      name: 'Cham Wallet Extension',
      desc: 'Native CashTokens & Intent Swarm Web3 Extension',
      popular: true,
      logo: '/logos/cham-wallet.svg',
    },
    {
      id: 'cashonize',
      name: 'Cashonize Web Wallet',
      desc: 'Popular open-source web wallet for BCH & CashTokens',
      popular: false,
      logo: '/logos/wallets/cashonize.svg',
    },
    {
      id: 'paytaca',
      name: 'Paytaca Mobile',
      desc: 'Mobile-first BCH CashTokens wallet with WalletConnect',
      popular: false,
      logo: '/logos/wallets/paytaca.svg',
    },
    {
      id: 'demo',
      name: 'Interactive Chipnet Sandbox',
      desc: 'Pre-loaded 12.50 BCH & 45k pUSD simulation sandbox',
      popular: true,
      isDemo: true,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in-50">
      <div className="relative w-full max-w-md bg-white dark:bg-[#131722] border border-slate-300 dark:border-[#262e42] rounded-3xl p-6 text-slate-900 dark:text-slate-100 shadow-2xl">
        <CornerCrosshair className="-left-2 -top-2" />
        <CornerCrosshair className="-right-2 -top-2" />
        <CornerCrosshair className="-left-2 -bottom-2" />
        <CornerCrosshair className="-right-2 -bottom-2" />

        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-[#262e42] mb-4">
          <div className="flex items-center gap-2.5">
            <MeshLogo size={32} showText={false} />
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">Connect BCH Wallet</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">Mesh Finance V3 • Sovereign Web3</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {walletConnected ? (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#0f131d] border border-emerald-500/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">Status</span>
                <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                </span>
              </div>
              <div className="font-mono text-xs text-slate-900 dark:text-white truncate bg-white dark:bg-black/40 p-2.5 rounded-lg border border-slate-300 dark:border-slate-800">
                {walletAddress}
              </div>
            </div>
            <button
              onClick={() => { disconnectWallet(); onClose(); }}
              className="w-full py-2.5 rounded-xl border border-rose-500/40 text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-xs font-semibold cursor-pointer transition-colors"
            >
              Disconnect Wallet
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {WALLETS.map(w => (
              <button
                key={w.id}
                onClick={() => { connectWallet(w.name); onClose(); }}
                className="w-full p-3 rounded-2xl border border-slate-300 dark:border-[#262e42] hover:border-slate-500 dark:hover:border-slate-500 bg-slate-50 dark:bg-[#1a2030] hover:bg-slate-100 dark:hover:bg-[#20273a] transition-all flex items-center justify-between group text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center overflow-hidden p-1.5">
                    {w.logo ? (
                      <img src={w.logo} alt={w.name} className="w-full h-full object-contain" />
                    ) : (
                      <MeshLogo size={20} showText={false} />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-emerald-500 transition-colors">{w.name}</span>
                      {w.popular && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">{w.desc}</p>
                  </div>
                </div>
                <Zap className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 pt-3 border-t border-slate-200 dark:border-[#262e42] flex items-center justify-between text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Non-Custodial Protocol
          </span>
          <span className="font-mono text-[10px]">Chipnet & Mainnet</span>
        </div>
      </div>
    </div>
  );
}
