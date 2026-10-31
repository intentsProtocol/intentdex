import { useState } from 'react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
  Chrome,
  ArrowRight,
  Sparkles,
  ExternalLink,
  Eye,
  Smile,
  Flame,
  EyeOff,
  ArrowUpRight,
  ArrowDownLeft,
  Shuffle,
  Shield,
  Coins,
  ChevronDown,
  Smartphone,
  Download,
  Plane,
  Cpu,
} from 'lucide-react';
import { WalletPhoneModel } from './WalletPhoneModel';
import { Chameleon, type ChamMood } from '@/components/mascot/Chameleon';
import { ChamLogo } from '@/components/common/ChamLogo';
import { useChamTheme } from '@/context/ChamThemeContext';

interface WalletHeroProps {
  onOpenDownload: () => void;
}

/* ─── Screen inside the phone: Cham Mascot Interactive Companion ─── */
function PhoneMascotScreen({
  mood,
  onMoodChange,
}: {
  mood: ChamMood;
  onMoodChange: (m: ChamMood) => void;
}) {
  const { activeColor } = useChamTheme();

  const cycleMood = () => {
    const moods: ChamMood[] = ['idle', 'happy', 'busy', 'shy'];
    const next = moods[(moods.indexOf(mood) + 1) % moods.length];
    onMoodChange(next);
  };

  return (
    <div className="flex-1 flex flex-col justify-between p-4 pt-8 pb-6 relative overflow-hidden bg-[#060608] select-none">
      {/* Radial glow directly behind the mascot */}
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[280px] h-[280px] rounded-full blur-[80px] pointer-events-none opacity-35 transition-colors duration-700"
        style={{ background: activeColor.hex }}
      />

      {/* Top Phone Header: Status & Network */}
      <div className="relative z-10 flex items-center justify-between pb-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <ChamLogo size={24} glow />
          <div>
            <div className="text-[11px] font-black text-white leading-none">Cham Vault</div>
            <div className="text-[9px] font-mono text-zinc-400 mt-0.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: activeColor.hex }} />
              <span>Multi-Chain L1</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-mono text-emerald-300">
          <Plane className="w-2.5 h-2.5 text-emerald-400" />
          <span>Airplane Mode: QVAC</span>
        </div>
      </div>

      {/* Centerpiece: Big Interactive Mascot inside the phone */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center my-1 cursor-pointer group" onClick={cycleMood}>
        {/* Floating status pill above Cham */}
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-2 px-3 py-1 rounded-full text-[10px] font-mono border backdrop-blur-md flex items-center gap-1.5 shadow-md"
          style={{
            borderColor: `${activeColor.hex}40`,
            background: `${activeColor.hex}15`,
            color: activeColor.hex,
          }}
        >
          <Sparkles className="w-2.5 h-2.5" />
          <span>
            {mood === 'happy' && 'Cham is thrilled!'}
            {mood === 'busy' && 'Curling tail • Resolving intents'}
            {mood === 'shy' && 'Eyes closed • Keys guarded'}
            {mood === 'idle' && 'Cham is tracking your cursor'}
          </span>
        </motion.div>

        {/* Large Chameleon inside the phone */}
        <motion.div
          animate={{ y: [0, -5, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
          className="relative"
        >
          <Chameleon
            size={220}
            tone={activeColor.hex}
            mood={mood}
            track={true}
            className="drop-shadow-[0_16px_30px_rgba(0,0,0,0.7)] group-hover:scale-105 transition-transform duration-300"
          />
        </motion.div>

        {/* Tap hint below mascot */}
        <div className="mt-1 text-[9px] font-mono text-zinc-500 group-hover:text-zinc-300 transition-colors">
          Tap Cham to switch mood
        </div>
      </div>

      {/* Bottom Area: Portfolio Card & Quick Action Pills */}
      <div className="relative z-10 space-y-3">
        {/* Balance Card */}
        <div className="p-3.5 rounded-2xl bg-black/60 border border-white/10 backdrop-blur-md shadow-lg">
          <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
            <span>TOTAL BALANCE</span>
            <span className="text-emerald-400 font-bold">+8.4% 24h</span>
          </div>
          <div className="text-xl font-black text-white font-heading mt-0.5 tracking-tight">
            $14,820.50 <span className="text-xs text-zinc-400 font-normal font-mono">USD</span>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Send', icon: ArrowUpRight },
            { label: 'Receive', icon: ArrowDownLeft },
            { label: 'Intent', icon: Shuffle, highlight: true },
            { label: 'Tokens', icon: Coins },
          ].map((action, i) => {
            const Icon = action.icon;
            return (
              <button
                key={i}
                type="button"
                onClick={cycleMood}
                className={cn(
                  'py-2 px-1 rounded-xl flex flex-col items-center justify-center gap-1 transition-all text-center',
                  action.highlight
                    ? 'text-black font-bold shadow-md'
                    : 'bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/5'
                )}
                style={
                  action.highlight
                    ? { background: activeColor.hex }
                    : undefined
                }
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="text-[9px] font-medium leading-none">{action.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function WalletHero({ onOpenDownload }: WalletHeroProps) {
  const { activeColor } = useChamTheme();
  const [chamMood, setChamMood] = useState<ChamMood>('idle');

  return (
    <section className="relative min-h-[95vh] flex items-center pt-32 pb-24 overflow-hidden">
      {/* Background obsidian base */}
      <div className="absolute inset-0 bg-[#050505] z-0" />

      {/* Morphic Gradient Orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div
          className="absolute top-[-15%] left-[5%] w-[60vw] h-[60vw] rounded-full blur-[180px] animate-pulse-glow transition-colors duration-1000 opacity-25"
          style={{ background: activeColor.hex }}
        />
        <div className="absolute bottom-[-15%] right-[5%] w-[50vw] h-[50vw] bg-violet-600/10 rounded-full blur-[160px] animate-pulse-glow delay-1000" />
        <div className="absolute inset-0 bg-[url('/noise.svg')] opacity-15 mix-blend-overlay" />
      </div>

      <div className="container mx-auto px-4 max-w-7xl relative z-10">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          {/* Left Column: Typography & CTAs (7 cols) */}
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="lg:col-span-7 space-y-8"
          >
            {/* Massive Display Title */}
            <div className="space-y-1">
              <h1 className="font-heading text-5xl sm:text-7xl lg:text-8xl font-black tracking-tighter leading-[0.9]">
                <span className="text-white block">ONE WALLET.</span>
                <span
                  className="text-transparent bg-clip-text transition-all duration-700 block"
                  style={{
                    backgroundImage: `linear-gradient(to right, ${activeColor.hex}, #38bdf8, #a78bfa)`,
                  }}
                >
                  EVERY INTENT.
                </span>
                <span className="text-white/90 block text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight mt-2">
                  ZERO BRIDGES.
                </span>
              </h1>
            </div>

            {/* Sub-headline */}
            <p className="text-lg sm:text-xl text-zinc-400 max-w-xl leading-relaxed">
              The self-custody multi-chain wallet built for Bitcoin Cash, EVM, and Solana. Chat with an on-device local
              AI financial architect that works 100% offline in Airplane Mode, swap native assets with Dutch Auction covenants,
              and keep absolute sovereignty over your keys.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              {/* Direct APK Download Button */}
              <a
                href="https://expo.dev/artifacts/eas/wHYSIbjjZ3l9FerNSQk5oCxkBVeyjWrWVaq00aA4o8M.apk"
                download="cham-wallet-v1.0.apk"
                target="_blank"
                rel="noreferrer"
                onMouseEnter={() => setChamMood('happy')}
                onMouseLeave={() => setChamMood('idle')}
                className="h-14 px-8 rounded-2xl font-bold text-base text-black flex items-center gap-3 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] shadow-xl cursor-pointer"
                style={{
                  background: activeColor.hex,
                  boxShadow: `0 8px 30px ${activeColor.hex}50`,
                }}
              >
                <Smartphone className="w-5 h-5 stroke-[2.5]" />
                <span>Download Android APK</span>
                <ArrowRight className="w-4 h-4" />
              </a>

              {/* Web App Launch Button */}
              <a
                href="https://champrotocol.vercel.app/"
                target="_blank"
                rel="noreferrer"
                onMouseEnter={() => setChamMood('busy')}
                onMouseLeave={() => setChamMood('idle')}
                className="h-14 px-7 rounded-2xl font-bold text-base text-white border-2 border-white/20 hover:border-white/50 bg-white/5 hover:bg-white/10 flex items-center gap-2.5 transition-all duration-300"
              >
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span>Launch Web App</span>
                <ExternalLink className="w-4 h-4 text-zinc-400" />
              </a>

              {/* Extension Modal Trigger */}
              <button
                onClick={onOpenDownload}
                className="h-14 px-6 rounded-2xl font-semibold text-sm text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 flex items-center gap-2 transition-all duration-300 cursor-pointer"
              >
                <Chrome className="w-4 h-4 text-emerald-400" />
                <span>Chrome Extension</span>
              </button>
            </div>

            {/* Interactive Cham Mood Selector */}
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <span className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                Cham's Mood in Phone:
              </span>
              <div className="flex items-center gap-2">
                {[
                  { id: 'idle', label: 'Idle', icon: Eye },
                  { id: 'happy', label: 'Happy', icon: Smile },
                  { id: 'shy', label: 'Shy', icon: EyeOff },
                  { id: 'busy', label: 'Busy', icon: Flame },
                ].map((item) => {
                  const Icon = item.icon;
                  const isActive = chamMood === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setChamMood(item.id as ChamMood)}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-xs font-mono flex items-center gap-1.5 transition-all duration-200 cursor-pointer',
                        isActive
                          ? 'text-black font-bold shadow-md'
                          : 'bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white border border-white/10'
                      )}
                      style={{
                        background: isActive ? activeColor.hex : undefined,
                      }}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>

          {/* Right Column: Phone with Chameleon Mascot Displayed Directly Inside */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
            className="lg:col-span-5 flex flex-col items-center justify-center relative"
          >
            {/* Ambient Behind-Phone Glow */}
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[680px] rounded-[3rem] blur-[120px] pointer-events-none opacity-30 transition-colors duration-1000"
              style={{ background: activeColor.hex }}
            />

            {/* 3D Tilt Phone displaying Cham directly inside the screen */}
            <WalletPhoneModel size="xl" className="relative z-10 shadow-2xl">
              <PhoneMascotScreen
                mood={chamMood}
                onMoodChange={setChamMood}
              />
            </WalletPhoneModel>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

export default WalletHero;
