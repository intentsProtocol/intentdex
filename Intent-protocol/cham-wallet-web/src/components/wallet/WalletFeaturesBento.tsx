import { motion } from 'framer-motion';
import {
  ShieldCheck,
  KeyRound,
  Shuffle,
  QrCode,
  Sparkles,
  Check,
} from 'lucide-react';
import { useChamTheme } from '@/context/ChamThemeContext';
import { Chameleon } from '@/components/mascot/Chameleon';

export function WalletFeaturesBento() {
  const { activeColor } = useChamTheme();

  return (
    <section id="features" className="relative py-28 bg-[#060608] text-white overflow-hidden border-t border-white/5">
      {/* Background Lighting */}
      <div
        className="absolute top-1/4 left-10 w-[500px] h-[500px] rounded-full blur-[170px] pointer-events-none opacity-10 transition-colors duration-1000"
        style={{ background: activeColor.hex }}
      />
      <div className="absolute bottom-1/4 right-10 w-[500px] h-[500px] bg-violet-500/5 rounded-full blur-[170px] pointer-events-none" />

      <div className="container mx-auto px-4 max-w-7xl relative z-10">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-20 space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-semibold uppercase tracking-wider"
          >
            <Sparkles className="w-3.5 h-3.5" style={{ color: activeColor.hex }} />
            <span style={{ color: activeColor.hex }}>Architecture & Feature Matrix</span>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="font-heading text-3xl sm:text-4xl md:text-5xl font-black tracking-tight"
          >
            Built different. <br className="hidden sm:inline" />
            <span
              className="text-transparent bg-clip-text"
              style={{
                backgroundImage: `linear-gradient(to right, ${activeColor.hex}, #38bdf8, #a78bfa)`,
              }}
            >
              Engineered without compromise.
            </span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-zinc-400 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed"
          >
            From peer-to-peer intent gossip to HTLC settlement, every layer is designed for
            power users, CashToken holders, and multi-chain sovereigns.
          </motion.p>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {/* Feature 1: MEV & Front-Running Protection — Hero card (2 cols) */}
          <motion.div
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="md:col-span-2 rounded-3xl p-8 lg-panel border border-white/10 hover:border-white/20 transition-all duration-300 relative overflow-hidden group shadow-xl"
          >
            <div className="flex flex-col sm:flex-row h-full gap-6">
              <div className="flex-1 flex flex-col justify-between gap-4">
                <div>
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5"
                    style={{
                      background: `${activeColor.hex}15`,
                      border: `1px solid ${activeColor.hex}30`,
                      color: activeColor.hex,
                    }}
                  >
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-bold uppercase tracking-widest" style={{ color: activeColor.hex }}>
                    Zero Toxic MEV
                  </span>
                  <h3 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight text-white mt-1 mb-2">
                    Protected Intent Gossip via Nostr
                  </h3>
                  <p className="text-zinc-400 text-sm sm:text-base max-w-xl leading-relaxed">
                    Orders are broadcasted over encrypted Nostr relays directly to authorized solvers. There is no public
                    mempool for predatory sandwich bots to front-run or extract slippage from your transaction.
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-3 pt-4 border-t border-white/10">
                  <div className="p-3.5 rounded-2xl bg-black/40 border border-white/5">
                    <div className="font-bold text-sm flex items-center gap-1.5" style={{ color: activeColor.hex }}>
                      <Check className="w-4 h-4 stroke-[3]" /> 100% Dutch Auction
                    </div>
                    <div className="text-xs text-zinc-400 mt-1">Price improves continuously until best solver fills</div>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-black/40 border border-white/5">
                    <div className="font-bold text-sm flex items-center gap-1.5" style={{ color: activeColor.hex }}>
                      <Check className="w-4 h-4 stroke-[3]" /> Zero Slippage Shock
                    </div>
                    <div className="text-xs text-zinc-400 mt-1">Guaranteed minimum output or full refund</div>
                  </div>
                </div>
              </div>

              {/* Chameleon mascot — busy mode scanning for MEV */}
              <div className="shrink-0 flex items-center justify-center relative">
                <div
                  className="absolute w-[140px] h-[140px] rounded-full blur-[40px] opacity-25"
                  style={{ background: activeColor.hex }}
                />
                <Chameleon
                  size={140}
                  tone={activeColor.hex}
                  mood="busy"
                  track={false}
                  className="relative z-10 drop-shadow-[0_8px_20px_rgba(0,0,0,0.5)] group-hover:scale-105 transition-transform duration-300"
                />
              </div>
            </div>
          </motion.div>

          {/* Feature 2: Universal 1-Seed Multi-Chain */}
          <motion.div
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="rounded-3xl p-8 lg-panel border border-white/10 hover:border-white/20 transition-all duration-300 relative overflow-hidden group shadow-xl flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-5">
                <div className="w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
                  <KeyRound className="w-6 h-6" />
                </div>
                {/* Small chameleon peeking */}
                <Chameleon
                  size={48}
                  tone="#8b5cf6"
                  mood="shy"
                  track={false}
                  className="opacity-60 group-hover:opacity-100 transition-opacity duration-300"
                />
              </div>
              <span className="text-xs font-bold text-violet-400 uppercase tracking-widest">BIP-44 & SLIP-0044</span>
              <h3 className="font-heading text-2xl font-bold tracking-tight text-white mt-1 mb-2">
                Universal Seed
              </h3>
              <p className="text-zinc-400 text-sm leading-relaxed">
                One single 12 or 24-word seed phrase derives standard CashAddr for Bitcoin Cash, 0x for Ethereum/EVM,
                and Base58 for Solana.
              </p>
            </div>

            <div className="mt-6 p-3 rounded-2xl bg-black/50 border border-white/5 font-mono text-[11px] text-zinc-400 space-y-1.5">
              <div className="font-bold" style={{ color: activeColor.hex }}>m/44'/145'/0' (BCH CashAddr)</div>
              <div className="text-blue-400 font-bold">m/44'/60'/0' (EVM / ETH)</div>
              <div className="text-purple-400 font-bold">m/44'/501'/0' (Solana SPL)</div>
            </div>
          </motion.div>

          {/* Feature 3: Universal DApp Connect */}
          <motion.div
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="rounded-3xl p-8 lg-panel border border-white/10 hover:border-white/20 transition-all duration-300 relative overflow-hidden group shadow-xl flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-5">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                  <QrCode className="w-6 h-6" />
                </div>
                {/* Cham happily connecting */}
                <Chameleon
                  size={48}
                  tone="#06b6d4"
                  mood="happy"
                  track={false}
                  className="opacity-60 group-hover:opacity-100 transition-opacity duration-300"
                />
              </div>
              <span className="text-xs font-bold text-cyan-400 uppercase tracking-widest">DApp Connectivity</span>
              <h3 className="font-heading text-2xl font-bold tracking-tight text-white mt-1 mb-2">
                Injected Provider
              </h3>
              <p className="text-zinc-400 text-sm leading-relaxed">
                Connect seamlessly to web applications with the injected provider. Sign and verify messages, inspect
                contract spending, and approve intents safely.
              </p>
            </div>

            <div className="mt-6 flex items-center justify-between text-xs text-zinc-400 pt-4 border-t border-white/10">
              <span>Standard RPC</span>
              <span className="font-mono font-bold" style={{ color: activeColor.hex }}>window.bchIntents</span>
            </div>
          </motion.div>

          {/* Feature 4: Atomic HTLC Settlement — Hero card (2 cols) */}
          <motion.div
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="md:col-span-2 rounded-3xl p-8 lg-panel border border-white/10 hover:border-white/20 transition-all duration-300 relative overflow-hidden group shadow-xl"
          >
            <div className="flex flex-col sm:flex-row h-full gap-6">
              {/* Chameleon celebrating atomic swap */}
              <div className="shrink-0 flex items-center justify-center relative order-1 sm:order-none">
                <div
                  className="absolute w-[130px] h-[130px] rounded-full blur-[40px] opacity-25 bg-teal-500"
                />
                <Chameleon
                  size={130}
                  tone="#14b8a6"
                  mood="happy"
                  track={false}
                  className="relative z-10 drop-shadow-[0_8px_20px_rgba(0,0,0,0.5)] group-hover:scale-105 transition-transform duration-300"
                />
              </div>

              <div className="flex-1 flex flex-col justify-between gap-4">
                <div>
                  <div className="w-12 h-12 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 mb-5">
                    <Shuffle className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-bold text-teal-400 uppercase tracking-widest">Non-Custodial Architecture</span>
                  <h3 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight text-white mt-1 mb-2">
                    Atomic HTLC & CashScript Covenants
                  </h3>
                  <p className="text-zinc-400 text-sm sm:text-base max-w-xl leading-relaxed">
                    Cross-chain transactions rely on mathematical guarantees: Hash Time-Locked Contracts (HTLC) and
                    CashScript covenants ensure you either receive the target token, or your original funds automatically
                    refund upon timeout.
                  </p>
                </div>

                <div className="flex items-center gap-3 text-xs font-mono text-zinc-400 flex-wrap">
                  <span className="px-3 py-1.5 rounded-xl bg-black/60 border border-white/10 text-teal-300">
                    SHA256 Hash Locks
                  </span>
                  <span className="px-3 py-1.5 rounded-xl bg-black/60 border border-white/10 text-teal-300">
                    OP_CHECKLOCKTIMEVERIFY
                  </span>
                  <span className="px-3 py-1.5 rounded-xl bg-black/60 border border-white/10 text-teal-300">
                    Zero Bridge Exploit Surface
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

export default WalletFeaturesBento;
