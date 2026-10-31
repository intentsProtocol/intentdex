import { useChamTheme } from '@/context/ChamThemeContext';
import { ShieldCheck, Github, ExternalLink } from 'lucide-react';
import { ChamLogo } from './ChamLogo';

export function Footer() {
  const { activeColor } = useChamTheme();

  return (
    <footer className="relative bg-[#040406] border-t border-white/5 pt-16 pb-12 overflow-hidden">
      {/* Subtle top glow */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-[1px] opacity-40 blur-[1px]"
        style={{
          background: `linear-gradient(90deg, transparent 0%, ${activeColor.hex} 50%, transparent 100%)`,
        }}
      />

      <div className="container mx-auto px-4 max-w-7xl">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
          {/* Brand Info */}
          <div className="md:col-span-2 space-y-4">
            <div className="flex items-center gap-3">
              <ChamLogo size={48} glow={true} />
              <span className="font-heading font-bold text-2xl text-white tracking-tight">Cham Wallet</span>
            </div>
            <p className="text-sm text-zinc-400 max-w-sm leading-relaxed">
              The self-custody multi-chain wallet for Bitcoin Cash, EVM, and Solana. Native CashTokens,
              atomic intent swaps, and pure client-side cryptographic security.
            </p>
            <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>100% Non-Custodial • Zero Telemetry</span>
            </div>
          </div>

          {/* Protocols & Links */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Product</h4>
            <ul className="space-y-2 text-sm text-zinc-400">
              <li><a href="#overview" className="hover:text-white transition-colors">Overview</a></li>
              <li><a href="#local-ai" className="hover:text-emerald-400 text-emerald-400/90 transition-colors">Local AI (Flight Mode)</a></li>
              <li><a href="#chains" className="hover:text-white transition-colors">Supported Chains</a></li>
              <li><a href="#features" className="hover:text-white transition-colors">CashTokens</a></li>
              <li><a href="#security" className="hover:text-white transition-colors">Security Model</a></li>
              <li>
                <a href="https://champrotocol.vercel.app/" target="_blank" rel="noreferrer" className="hover:text-white transition-colors flex items-center gap-1">
                  <span>Web App</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
            </ul>
          </div>

          {/* Developers & Community */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Developers</h4>
            <ul className="space-y-2 text-sm text-zinc-400">
              <li>
                <a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-white transition-colors flex items-center gap-1.5">
                  <Github className="w-3.5 h-3.5" />
                  <span>GitHub Repository</span>
                </a>
              </li>
              <li><a href="#faq" className="hover:text-white transition-colors">Frequently Asked Questions</a></li>
              <li><a href="#" className="hover:text-white transition-colors">CashScript Covenants</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Electrum Fulcrum Nodes</a></li>
            </ul>
          </div>
        </div>

        {/* Disclaimer & Copyright */}
        <div className="pt-8 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
          <p>© {new Date().getFullYear()} Cham Wallet. Open source, permissionless software.</p>
          <p className="text-[11px] text-zinc-600 max-w-md text-center sm:text-right">
            Cham Wallet is currently in public alpha. Never invest more than you are willing to test with.
            Keys are strictly generated and stored on your local device.
          </p>
        </div>
      </div>
    </footer>
  );
}
