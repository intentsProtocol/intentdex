import { useState } from 'react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Chrome, Smartphone, Apple, Download, ExternalLink, ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import { useChamTheme } from '@/context/ChamThemeContext';
import { ChamLogo } from '@/components/common/ChamLogo';

type Platform = 'extension' | 'web' | 'mobile';

interface WalletDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PLATFORMS: { id: Platform; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'extension', label: 'Chrome Extension', icon: Chrome },
  { id: 'web', label: 'Web Wallet', icon: Sparkles },
  { id: 'mobile', label: 'Mobile App', icon: Smartphone },
];

export function WalletDownloadModal({ isOpen, onClose }: WalletDownloadModalProps) {
  const [activePlatform, setActivePlatform] = useState<Platform>('extension');
  const { activeColor } = useChamTheme();

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-md"
        />

        {/* Modal Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ type: 'spring', stiffness: 350, damping: 25 }}
          className="relative w-full max-w-lg lg-panel rounded-3xl p-6 sm:p-8 border border-white/10 shadow-2xl z-10 overflow-hidden"
        >
          {/* Ambient Corner Glow */}
          <div
            className="absolute -top-20 -right-20 w-44 h-44 rounded-full blur-[80px] pointer-events-none opacity-40"
            style={{ background: activeColor.hex }}
          />

          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Title */}
          <div className="flex items-center gap-3.5 mb-6">
            <ChamLogo size={48} glow={true} />
            <div>
              <h3 className="font-heading font-bold text-lg text-white">Get Cham Wallet</h3>
              <p className="text-xs text-zinc-400">Choose your preferred client environment</p>
            </div>
          </div>

          {/* Platform Tabs */}
          <div className="flex p-1 rounded-2xl bg-zinc-900/80 border border-white/5 mb-6">
            {PLATFORMS.map((p) => {
              const Icon = p.icon;
              const selected = activePlatform === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setActivePlatform(p.id)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200',
                    selected ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                  )}
                  style={selected ? { borderBottom: `2px solid ${activeColor.hex}` } : undefined}
                >
                  <Icon className="w-4 h-4" />
                  <span>{p.label}</span>
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          {activePlatform === 'extension' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-zinc-900/60 border border-white/5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white">Chromium Extension (Alpha)</span>
                  <span
                    className="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold uppercase"
                    style={{ background: `${activeColor.hex}25`, color: activeColor.hex }}
                  >
                    v0.2.0 Release
                  </span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Self-custodial multi-chain wallet for Google Chrome, Brave, and Microsoft Edge. One seed across Bitcoin Cash, EVM, and Solana with side-panel trading.
                </p>
                <div className="text-[11px] font-mono text-zinc-500 pt-1 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Local PBKDF2/AES-GCM Encryption · Zero Cloud Leaks</span>
                </div>
              </div>

              <div className="space-y-2">
                <a
                  href="/downloads/cham-wallet-extension.zip"
                  download="cham-wallet-extension.zip"
                  className="w-full py-3.5 rounded-2xl font-bold text-sm text-black flex items-center justify-center gap-2 transition-transform hover:scale-[1.01] active:scale-[0.99] shadow-lg cursor-pointer"
                  style={{ background: activeColor.hex, boxShadow: `0 4px 20px ${activeColor.hex}40` }}
                >
                  <Download className="w-4 h-4 stroke-[2.5]" />
                  <span>Download Extension (ZIP Bundle)</span>
                </a>

                {/* Sideload install helper */}
                <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 text-[11px] text-zinc-400 space-y-1.5">
                  <span className="text-zinc-200 font-semibold block">How to Install in Chrome / Brave / Edge:</span>
                  <p><span className="text-zinc-300 font-medium">1.</span> Download and extract <code className="text-emerald-400 font-mono bg-black/40 px-1 py-0.5 rounded">cham-wallet-extension.zip</code> to a local folder.</p>
                  <p><span className="text-zinc-300 font-medium">2.</span> In Chrome or Brave, navigate to <code className="text-emerald-400 font-mono bg-black/40 px-1 py-0.5 rounded">chrome://extensions</code>.</p>
                  <p><span className="text-zinc-300 font-medium">3.</span> Enable <strong className="text-white">Developer mode</strong> in the top-right corner.</p>
                  <p><span className="text-zinc-300 font-medium">4.</span> Click <strong className="text-white">Load unpacked</strong> and select the extracted folder.</p>
                </div>
              </div>
            </div>
          )}

          {activePlatform === 'web' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-zinc-900/60 border border-white/5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white">Instant In-Browser Web Wallet</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-400">
                    LIVE NOW
                  </span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  No install required. Full self-custody wallet running directly inside the trading dApp with instant key derivation.
                </p>
              </div>

              <a
                href="https://champrotocol.vercel.app/"
                target="_blank"
                rel="noreferrer"
                className="w-full py-3.5 rounded-2xl font-bold text-sm text-black flex items-center justify-center gap-2 transition-transform hover:scale-[1.01] active:scale-[0.99] shadow-lg"
                style={{ background: activeColor.hex, boxShadow: `0 4px 20px ${activeColor.hex}40` }}
              >
                <span>Launch Web Wallet in Browser</span>
                <ExternalLink className="w-4 h-4 stroke-[2.5]" />
              </a>
            </div>
          )}

          {activePlatform === 'mobile' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-zinc-900/60 border border-white/5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white">Cham Wallet for Android (EAS APK)</span>
                  <span
                    className="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold uppercase"
                    style={{ background: `${activeColor.hex}25`, color: activeColor.hex }}
                  >
                    AI Yako Release
                  </span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Standalone production APK powered by Tether's WDK and on-device QVAC Local AI (Qwen3 1.7B). Runs
                  100% offline in Airplane Mode.
                </p>
                <div className="text-[11px] font-mono text-zinc-500 pt-1 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Direct Expo EAS Build · Android 12+ Recommended</span>
                </div>
              </div>

              <div className="space-y-2">
                <a
                  href="https://expo.dev/artifacts/eas/wHYSIbjjZ3l9FerNSQk5oCxkBVeyjWrWVaq00aA4o8M.apk"
                  download="cham-wallet-v1.0.apk"
                  target="_blank"
                  rel="noreferrer"
                  className="w-full py-3.5 rounded-2xl font-bold text-sm text-black flex items-center justify-center gap-2 transition-transform hover:scale-[1.01] active:scale-[0.99] shadow-lg"
                  style={{ background: activeColor.hex, boxShadow: `0 4px 20px ${activeColor.hex}40` }}
                >
                  <Download className="w-4 h-4 stroke-[2.5]" />
                  <span>Download Android APK (Direct Install)</span>
                </a>

                {/* Sideload install helper */}
                <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-[11px] text-zinc-400 space-y-1">
                  <span className="text-zinc-200 font-semibold block">Quick Install Guide:</span>
                  <p>1. Tap Download APK above on your Android phone.</p>
                  <p>2. Tap the downloaded file and select "Install" (Allow unknown apps if prompted).</p>
                  <p>3. Launch Cham Wallet, turn on Airplane Mode, and chat with your local AI!</p>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export default WalletDownloadModal;
