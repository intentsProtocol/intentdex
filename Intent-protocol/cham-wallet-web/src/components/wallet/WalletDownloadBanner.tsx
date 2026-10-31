import { motion } from 'framer-motion';
import { Chrome, ArrowRight, ShieldCheck, Zap, Sparkles, Smartphone, Download } from 'lucide-react';
import { Chameleon } from '@/components/mascot/Chameleon';
import { useChamTheme } from '@/context/ChamThemeContext';

interface WalletDownloadBannerProps {
  onOpenDownload: () => void;
}

export function WalletDownloadBanner({ onOpenDownload }: WalletDownloadBannerProps) {
  const { activeColor } = useChamTheme();

  return (
    <section className="relative py-24 bg-black overflow-hidden border-t border-white/5">
      {/* Gradient Background Aura */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-zinc-950/40 to-black pointer-events-none" />
      <div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[350px] rounded-full blur-[160px] pointer-events-none opacity-20 transition-colors duration-1000"
        style={{ background: activeColor.hex }}
      />

      <div className="container mx-auto px-4 max-w-7xl relative z-10">
        <div className="max-w-5xl mx-auto rounded-[2.5rem] lg-panel border border-white/10 p-8 sm:p-12 md:p-16 relative overflow-hidden shadow-2xl text-center">
          {/* Glowing highlight accents */}
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-1 transition-colors duration-1000"
            style={{
              background: `linear-gradient(90deg, transparent, ${activeColor.hex}, transparent)`,
            }}
          />

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="space-y-6 max-w-2xl mx-auto flex flex-col items-center"
          >
            {/* Happy Cham Mascot - Prominent and Lively */}
            <div className="relative mb-2 flex items-center justify-center">
              <div
                className="absolute inset-0 rounded-full blur-2xl opacity-40 pointer-events-none"
                style={{ background: activeColor.hex }}
              />
              <Chameleon
                size={180}
                tone={activeColor.hex}
                mood="happy"
                track={true}
                className="relative z-10 transition-transform hover:scale-105"
              />
            </div>

            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-bold uppercase tracking-wider">
              <Zap className="w-3.5 h-3.5" style={{ color: activeColor.hex }} />
              <span style={{ color: activeColor.hex }}>Start Exploring Onchain Sovereignty</span>
            </div>

            <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight">
              Experience the future of <br />
              <span
                className="text-transparent bg-clip-text"
                style={{
                  backgroundImage: `linear-gradient(to right, ${activeColor.hex}, #38bdf8, #a78bfa)`,
                }}
              >
                cross-chain intents.
              </span>
            </h2>

            <p className="text-zinc-400 text-base sm:text-lg leading-relaxed">
              Join the next generation of self-custody traders. Native CashTokens, Dutch auction price discovery,
              and atomic settlement across Bitcoin Cash, EVM, and Solana.
            </p>

            {/* CTA Buttons */}
            <div className="pt-4 flex flex-wrap items-center justify-center gap-4">
              <motion.a
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                href="https://expo.dev/artifacts/eas/wHYSIbjjZ3l9FerNSQk5oCxkBVeyjWrWVaq00aA4o8M.apk"
                download="cham-wallet-v1.0.apk"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-sm text-black transition-all shadow-xl"
                style={{
                  background: activeColor.hex,
                  boxShadow: `0 8px 30px ${activeColor.hex}40`,
                }}
              >
                <Smartphone className="w-5 h-5 stroke-[2.5]" />
                <div className="text-left">
                  <span className="text-[10px] font-semibold text-black/70 block leading-tight">Download Android</span>
                  <span className="text-sm font-bold leading-tight">Direct APK</span>
                </div>
              </motion.a>

              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={onOpenDownload}
                className="flex items-center gap-3 px-7 py-4 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/15 text-white font-bold text-sm transition-all shadow-xl"
              >
                <Chrome className="w-5 h-5" />
                <div className="text-left">
                  <span className="text-[10px] font-semibold text-zinc-400 block leading-tight">Browser Extension</span>
                  <span className="text-sm font-bold leading-tight">Chromium Alpha</span>
                </div>
              </motion.button>

              <motion.a
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                href="https://champrotocol.vercel.app/"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 px-7 py-4 rounded-2xl bg-white text-black font-bold text-sm hover:bg-zinc-100 transition-all shadow-xl"
              >
                <Sparkles className="w-5 h-5" />
                <div className="text-left">
                  <span className="text-[10px] font-semibold text-zinc-600 block leading-tight">Launch Instant</span>
                  <span className="text-sm font-bold leading-tight">Web Wallet</span>
                </div>
              </motion.a>
            </div>

            {/* Security check footer */}
            <div className="pt-6 flex items-center justify-center gap-6 text-xs text-zinc-500 font-medium flex-wrap">
              <span className="flex items-center gap-1.5 text-zinc-400">
                <ShieldCheck className="w-4 h-4 text-emerald-400" /> 100% Non-Custodial
              </span>
              <span>•</span>
              <span>Open Source Verification</span>
              <span>•</span>
              <span>Zero Bridge Custody</span>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

export default WalletDownloadBanner;
