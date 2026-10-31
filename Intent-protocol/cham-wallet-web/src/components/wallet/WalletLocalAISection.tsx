import { motion } from 'framer-motion';
import {
  Cpu,
  Plane,
  ShieldCheck,
  Sparkles,
  Smartphone,
  ArrowRight,
  WifiOff,
  CheckCircle2,
} from 'lucide-react';
import { useChamTheme } from '@/context/ChamThemeContext';

const APK_URL = 'https://expo.dev/artifacts/eas/wHYSIbjjZ3l9FerNSQk5oCxkBVeyjWrWVaq00aA4o8M.apk';

export function WalletLocalAISection() {
  const { activeColor } = useChamTheme();

  return (
    <section id="local-ai" className="relative py-20 sm:py-28 bg-[#050507] text-white overflow-hidden">
      {/* Dynamic Ambient Background Glows */}
      <div
        className="absolute top-1/3 left-0 w-[550px] h-[550px] rounded-full blur-[200px] pointer-events-none opacity-15 transition-all duration-1000"
        style={{ background: activeColor.hex }}
      />
      <div className="absolute bottom-1/4 right-0 w-[500px] h-[500px] bg-sky-500/10 rounded-full blur-[180px] pointer-events-none" />

      <div className="container mx-auto px-4 max-w-7xl relative z-10">
        {/* Seamless Half-Screen Split Display with Zero Box Borders */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-center">
          {/* LEFT HALF (6 cols): Top-Back Perspective In-Flight Visual with Minimalist Floating Details */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="lg:col-span-6 relative w-full"
          >
            {/* Visual Frame - Seamlessly fills height & width with smooth rounded corners */}
            <div className="relative w-full h-[460px] sm:h-[540px] lg:h-[560px] rounded-[2.5rem] overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.85)] bg-zinc-950 group">
              <img
                src="/assets/in-flight-bch-traveler-v2.jpg"
                alt="Crypto traveler in green Bitcoin Cash shirt browsing Cham Wallet offline mid-flight"
                className="w-full h-full object-cover object-center filter brightness-[0.95] group-hover:scale-102 transition-transform duration-700"
              />

              {/* Ambient Vignette Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-black/25 pointer-events-none" />

              {/* Minimalist Floating Badge: Top Left */}
              <div className="absolute top-6 left-6 z-20 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/60 backdrop-blur-xl text-xs font-mono shadow-2xl">
                <Plane className="w-3.5 h-3.5 text-sky-400" />
                <span className="text-white font-bold">100% Airplane Mode</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping ml-0.5" />
                <span className="text-emerald-400 font-semibold text-[11px]">QVAC Active</span>
              </div>

              {/* Minimalist Floating Card: Bottom Glass Overlay */}
              <div className="absolute bottom-6 inset-x-6 z-20 p-5 rounded-2xl bg-black/75 backdrop-blur-2xl shadow-2xl space-y-2.5">
                <div className="flex items-center justify-between text-[11px] text-zinc-400 pb-1.5 border-b border-white/10 font-mono">
                  <div className="flex items-center gap-1.5">
                    <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-zinc-300">0 In-Flight Wi-Fi · 0 Cloud Calls</span>
                  </div>
                  <span className="text-emerald-400 font-semibold">Local NPU</span>
                </div>

                <div className="space-y-1.5 text-xs font-mono">
                  <div className="text-zinc-400 flex items-center gap-1.5 truncate">
                    <span className="text-emerald-400 font-bold shrink-0">Traveler:</span>
                    <span className="text-zinc-200">"Keep accumulating PUSDTEST cheaply with 25% of my BCH"</span>
                  </div>
                  <div className="text-zinc-300 bg-white/5 p-2.5 rounded-xl flex items-start gap-2 text-[11px] leading-relaxed">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>8 discrete buy bins computed offline via localPlanPosition · Drafted to Outbox</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 pt-0.5">
                  <span>Encrypted Outbox</span>
                  <span className="text-zinc-200 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    1-Tap Biometric Broadcast on Landing
                  </span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* RIGHT HALF (6 cols): Clean Story & Direct Download */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="lg:col-span-6 flex flex-col justify-center space-y-6"
          >
            {/* Minimalist Eyebrow */}
            <div className="flex items-center gap-2.5 text-xs font-mono tracking-wider text-emerald-400">
              <Cpu className="w-4 h-4" />
              <span className="font-bold uppercase tracking-widest">
                Tether QVAC × Qwen3 1.7B • 100% On-Device AI
              </span>
            </div>

            {/* Headline */}
            <h2 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.06]">
              The Flight Mode Breakthrough. <br />
              <span
                className="text-transparent bg-clip-text"
                style={{
                  backgroundImage: `linear-gradient(to right, ${activeColor.hex}, #38bdf8, #a78bfa)`,
                }}
              >
                Financial Autonomy at 35,000 Feet.
              </span>
            </h2>

            {/* Story Paragraph */}
            <p className="text-zinc-400 text-base sm:text-lg leading-relaxed">
              Imagine boarding a flight to the next global Bitcoin & Bitcoin Cash conference with zero in-flight Wi-Fi.
              Traditional dApps freeze and wallets fail. With Cham Wallet, your on-device AI financial architect plans
              Mesh liquidity grids, models collateral loans, and queues intent trades entirely in Airplane Mode.
            </p>

            {/* Action Button: Download Android APK */}
            <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
              <a
                href={APK_URL}
                download="cham-wallet-v1.0.apk"
                target="_blank"
                rel="noreferrer"
                className="h-14 px-8 rounded-2xl font-bold text-base text-black flex items-center justify-center gap-3 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] shadow-2xl cursor-pointer"
                style={{
                  background: activeColor.hex,
                  boxShadow: `0 8px 30px ${activeColor.hex}40`,
                }}
              >
                <Smartphone className="w-5 h-5 stroke-[2.5]" />
                <span>Download Android APK</span>
                <ArrowRight className="w-4 h-4" />
              </a>

              <div className="text-xs font-mono text-zinc-400 flex items-center gap-2 px-1">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Direct EAS Release APK · Android 12+</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

export default WalletLocalAISection;