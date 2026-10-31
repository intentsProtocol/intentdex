import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck,
  Lock,
  Fingerprint,
  FileCode,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { useChamTheme } from '@/context/ChamThemeContext';
import { Chameleon, type ChamMood } from '@/components/mascot/Chameleon';
import { cn } from '@/lib/utils';

/* ─── Security Card Data ─── */
const SECURITY_CARDS = [
  {
    icon: Fingerprint,
    title: 'Client Keystore & PBKDF2',
    badge: 'Zero-Knowledge',
    edition: 'CARD #01',
    rarity: 'LEGENDARY',
    description: 'Private keys are generated strictly on your local machine and encrypted with salted PBKDF2 & AES-256-GCM. Keys never touch a server.',
    chamMood: 'shy' as ChamMood,
    chamAction: 'Cham shuts its eye — your keys are sacred & hidden',
    color: '#f59e0b', // amber
    holoBg: 'from-amber-500/25 via-orange-500/10 to-yellow-500/25',
    borderGlow: 'rgba(245, 158, 11, 0.4)',
  },
  {
    icon: ShieldCheck,
    title: 'SIGHASH_UTXOS Verification',
    badge: 'Commitment Guard',
    edition: 'CARD #02',
    rarity: 'EPIC',
    description: 'Mathematical UTXO introspection guarantees payout covenants. Malicious orders or altered outputs are invalidated onchain before broadcast.',
    chamMood: 'busy' as ChamMood,
    chamAction: 'Cham spins its tail in flight — inspecting covenants',
    color: '#3b82f6', // blue
    holoBg: 'from-blue-500/25 via-indigo-500/10 to-cyan-500/25',
    borderGlow: 'rgba(59, 130, 246, 0.4)',
  },
  {
    icon: FileCode,
    title: 'Audited CashScript Covenants',
    badge: 'Mathematically Proven',
    edition: 'CARD #03',
    rarity: 'RARE',
    description: 'Hash Time-Locked Contracts (HTLCs) written in native CashScript. Atomic peer-to-peer settlement with zero wrapped bridge custody.',
    chamMood: 'happy' as ChamMood,
    chamAction: 'Cham flicks its tongue — covenant verified onchain!',
    color: '#10b981', // emerald
    holoBg: 'from-emerald-500/25 via-teal-500/10 to-green-500/25',
    borderGlow: 'rgba(16, 185, 129, 0.4)',
  },
  {
    icon: EyeOff,
    title: 'Zero Tracking & No KYC',
    badge: 'Privacy Sovereign',
    edition: 'CARD #04',
    rarity: 'MYTHIC',
    description: 'No telemetry, no tracking scripts, no personal data, and no KYC gates. Orders are broadcasted over encrypted Nostr relays directly.',
    chamMood: 'shy' as ChamMood,
    chamAction: 'Cham blends with the shadows — sovereign stealth',
    color: '#a855f7', // purple
    holoBg: 'from-purple-500/25 via-violet-500/10 to-fuchsia-500/25',
    borderGlow: 'rgba(168, 85, 247, 0.4)',
  },
];

/* ─── Premium Square Collectible Card ─── */
function SecurityCollectibleCard({
  card,
  isActive,
}: {
  card: (typeof SECURITY_CARDS)[number];
  isActive: boolean;
}) {
  const Icon = card.icon;

  return (
    <div
      className={cn(
        'relative w-full max-w-[460px] aspect-square sm:aspect-square rounded-[32px] overflow-hidden transition-all duration-500 shadow-2xl flex flex-col justify-between p-6 sm:p-7',
        isActive ? 'scale-100 opacity-100' : 'scale-90 opacity-40'
      )}
      style={{
        boxShadow: `0 20px 60px -15px ${card.color}35, 0 0 0 1px ${card.borderGlow}`,
      }}
    >
      {/* Holo foil animated background */}
      <div
        className={cn(
          'absolute inset-0 bg-gradient-to-br opacity-70 transition-all duration-700',
          card.holoBg
        )}
      />
      <div
        className="absolute inset-0 opacity-25"
        style={{
          background: `conic-gradient(from 180deg at 50% 50%, transparent, ${card.color}40, transparent, ${card.color}20, transparent)`,
        }}
      />

      {/* Dark frosted glass backing */}
      <div className="absolute inset-0 rounded-[32px] bg-black/75 backdrop-blur-md" />

      {/* Subtle holo foil grid pattern */}
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 2px 2px, white 1px, transparent 0)`,
          backgroundSize: '16px 16px',
        }}
      />

      {/* Top Header Row */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-mono font-black px-3 py-1 rounded-full border tracking-wide uppercase shadow-sm"
            style={{
              color: card.color,
              borderColor: `${card.color}60`,
              background: `${card.color}18`,
            }}
          >
            {card.badge}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-mono font-bold text-zinc-400">{card.edition}</span>
          <span
            className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full border"
            style={{
              color: card.color,
              background: `${card.color}25`,
              borderColor: `${card.color}40`,
            }}
          >
            {card.rarity}
          </span>
        </div>
      </div>

      {/* Centerpiece: Big Prominent Chameleon Mascot */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center my-2">
        {/* Radiant Glow Orb behind Cham */}
        <div
          className="absolute w-[220px] h-[220px] rounded-full blur-[70px] opacity-50 pointer-events-none"
          style={{ background: card.color }}
        />

        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
          className="relative z-10"
        >
          <Chameleon
            size={230}
            tone={card.color}
            mood={card.chamMood}
            track={true}
            className="drop-shadow-[0_20px_40px_rgba(0,0,0,0.7)]"
          />
        </motion.div>

        {/* Mascot Action Pill */}
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 mt-1 px-3.5 py-1 rounded-full text-[11px] font-semibold border flex items-center gap-1.5 backdrop-blur-md"
          style={{
            borderColor: `${card.color}40`,
            background: `${card.color}15`,
            color: card.color,
          }}
        >
          <Sparkles className="w-3 h-3" />
          <span>{card.chamAction}</span>
        </motion.div>
      </div>

      {/* Bottom Metadata & Description */}
      <div className="relative z-10 pt-3 border-t border-white/10 space-y-1.5">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: `${card.color}25`,
              border: `1px solid ${card.color}50`,
              color: card.color,
            }}
          >
            <Icon className="w-3.5 h-3.5" />
          </div>
          <h3 className="font-heading text-base sm:text-lg font-black text-white tracking-tight leading-snug">
            {card.title}
          </h3>
        </div>
        <p className="text-zinc-300 text-xs sm:text-[13px] leading-relaxed line-clamp-2">
          {card.description}
        </p>
      </div>

      {/* Holographic Border Sheen */}
      <div
        className="absolute inset-0 rounded-[32px] pointer-events-none"
        style={{
          background: `linear-gradient(135deg, ${card.color}20, transparent 40%, transparent 60%, ${card.color}15)`,
        }}
      />
    </div>
  );
}

/* ─── Main Section ─── */
export function WalletSecuritySection() {
  const { activeColor } = useChamTheme();
  const [activeIdx, setActiveIdx] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);

  // Auto-rotate cards
  useEffect(() => {
    if (!autoPlay) return;
    const timer = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % SECURITY_CARDS.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [autoPlay]);

  const goTo = (idx: number) => {
    setActiveIdx(idx);
    setAutoPlay(false);
    setTimeout(() => setAutoPlay(true), 9000);
  };

  const goPrev = () => goTo((activeIdx - 1 + SECURITY_CARDS.length) % SECURITY_CARDS.length);
  const goNext = () => goTo((activeIdx + 1) % SECURITY_CARDS.length);

  const card = SECURITY_CARDS[activeIdx];

  return (
    <section id="security" className="relative py-28 bg-[#040404] text-white overflow-hidden border-t border-white/5">
      {/* Ambient Lighting */}
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full blur-[220px] pointer-events-none opacity-15 transition-colors duration-1000"
        style={{ background: card.color }}
      />

      <div className="container mx-auto px-4 max-w-7xl relative z-10">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-semibold uppercase tracking-wider"
          >
            <Lock className="w-3.5 h-3.5" style={{ color: activeColor.hex }} />
            <span style={{ color: activeColor.hex }}>Institutional-Grade Self-Custody</span>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="font-heading text-3xl sm:text-4xl md:text-5xl font-black tracking-tight"
          >
            Security-first mindset. <br className="hidden sm:inline" />
            <span
              className="text-transparent bg-clip-text"
              style={{
                backgroundImage: `linear-gradient(to right, ${card.color}, #38bdf8, #a78bfa)`,
              }}
            >
              Engineered for sovereign finance.
            </span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-zinc-400 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed"
          >
            In DeFi, true security means removing intermediaries and unverified bridges entirely. Cham Wallet enforces cryptographic guarantees at every layer.
          </motion.p>
        </div>

        {/* Collectible Card Slideshow Display */}
        <div className="flex flex-col items-center gap-8">
          {/* Card Presentation Container with responsive arrows */}
          <div className="relative w-full max-w-[480px] mx-auto flex items-center justify-center">
            {/* Prev button */}
            <button
              onClick={goPrev}
              aria-label="Previous card"
              className="absolute -left-4 sm:-left-16 z-20 w-11 h-11 sm:w-13 sm:h-13 rounded-2xl bg-black/60 hover:bg-black/90 border border-white/20 flex items-center justify-center transition-all hover:scale-110 cursor-pointer shadow-xl backdrop-blur-md text-white"
            >
              <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>

            {/* Square Collectible Card */}
            <div className="w-full flex justify-center px-4 sm:px-0">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeIdx}
                  initial={{ opacity: 0, scale: 0.92, rotateY: 15 }}
                  animate={{ opacity: 1, scale: 1, rotateY: 0 }}
                  exit={{ opacity: 0, scale: 0.92, rotateY: -15 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  className="w-full flex justify-center"
                >
                  <SecurityCollectibleCard card={card} isActive={true} />
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Next button */}
            <button
              onClick={goNext}
              aria-label="Next card"
              className="absolute -right-4 sm:-right-16 z-20 w-11 h-11 sm:w-13 sm:h-13 rounded-2xl bg-black/60 hover:bg-black/90 border border-white/20 flex items-center justify-center transition-all hover:scale-110 cursor-pointer shadow-xl backdrop-blur-md text-white"
            >
              <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </div>

          {/* Card Indicator Dots */}
          <div className="flex items-center gap-3">
            {SECURITY_CARDS.map((c, idx) => (
              <button
                key={idx}
                onClick={() => goTo(idx)}
                aria-label={`Go to card ${idx + 1}`}
                className={cn(
                  'transition-all duration-300 rounded-full cursor-pointer',
                  activeIdx === idx
                    ? 'w-8 h-3 shadow-lg'
                    : 'w-3 h-3 bg-white/15 hover:bg-white/35'
                )}
                style={activeIdx === idx ? { background: c.color } : undefined}
              />
            ))}
          </div>

          {/* Collection Bar */}
          <div className="flex items-center gap-3 sm:gap-4 px-5 py-2.5 rounded-2xl bg-white/5 border border-white/10 shadow-lg">
            <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider font-semibold">Cards</span>
            <div className="flex items-center gap-1.5 sm:gap-2">
              {SECURITY_CARDS.map((c, idx) => {
                const Icon = c.icon;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => goTo(idx)}
                    className={cn(
                      'w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-300 cursor-pointer',
                      activeIdx === idx ? 'scale-110 shadow-lg' : 'opacity-40 hover:opacity-75'
                    )}
                    style={{
                      background: `${c.color}25`,
                      border: `1px solid ${c.color}60`,
                      color: c.color,
                    }}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                );
              })}
            </div>
            <span className="text-xs font-mono text-zinc-400">
              <span className="text-white font-black">{activeIdx + 1}</span>
              <span className="text-zinc-600"> / {SECURITY_CARDS.length}</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export default WalletSecuritySection;
