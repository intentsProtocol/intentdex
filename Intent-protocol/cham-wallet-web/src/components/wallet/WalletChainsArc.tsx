import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Globe, Sparkles, Wand2, Zap, ArrowRight } from 'lucide-react';
import { Chameleon, type ChamMood } from '@/components/mascot/Chameleon';
import { useChamTheme } from '@/context/ChamThemeContext';

export interface ChainInfo {
  id: string;
  name: string;
  symbol: string;
  hexColor: string;
  logo: string;
  type: string;
  speed: string;
  fee: string;
  description: string;
  features: string[];
  // Orbital layout around Cham
  orbitX: number; // percentage (-50 to +50)
  orbitY: number; // percentage (-50 to +50)
}

const SUPPORTED_CHAINS: ChainInfo[] = [
  {
    id: 'bch',
    name: 'Bitcoin Cash',
    symbol: 'BCH',
    hexColor: '#00D18F',
    logo: '/logos/bitcoin-cash-bch-logo.svg',
    type: 'Native UTXO + CashTokens',
    speed: '~Instant (0-conf) / 10m',
    fee: '< $0.001',
    description: 'Native L1 blockchain for peer-to-peer cash with advanced CashScript smart covenants and native CashTokens.',
    features: ['Native CashTokens L1', 'CashScript Covenants', '0-Conf Proofs', 'Ultra-low Fees (<$0.001)'],
    orbitX: 42,
    orbitY: -22,
  },
  {
    id: 'sol',
    name: 'Solana',
    symbol: 'SOL',
    hexColor: '#9945FF',
    logo: '/logos/solana.svg',
    type: 'High-Throughput SVM',
    speed: '400ms Sub-second',
    fee: '< $0.005',
    description: 'Ultra-fast execution layer powering high-frequency intent settlements with escrow programs.',
    features: ['SPL Tokens', 'Escrow Relayer Support', 'Sub-second Finality', 'High-Frequency Oracles'],
    orbitX: 45,
    orbitY: 26,
  },
  {
    id: 'eth',
    name: 'Ethereum',
    symbol: 'ETH',
    hexColor: '#627EEA',
    logo: '/logos/ethereum-eth-logo.svg',
    type: 'EVM Mainnet',
    speed: '12s Finality',
    fee: 'Variable (~$0.80)',
    description: 'Decentralized smart contract settlement standard with automated HTLC and permit2 signatures.',
    features: ['ERC-20 & ERC-721', 'EIP-712 Intent Signing', 'Permit2 Gasless Swaps', 'Audited Covenants'],
    orbitX: 0,
    orbitY: 44,
  },
  {
    id: 'base',
    name: 'Base',
    symbol: 'BASE',
    hexColor: '#0052FF',
    logo: '/logos/Base_square_blue.svg',
    type: 'Coinbase OP Stack L2',
    speed: '< 1s',
    fee: '< $0.01',
    description: 'Fast, secure and low-cost Ethereum Layer 2 powered by OP Stack, built for mass adoption.',
    features: ['OP Stack Architecture', 'Low EVM Fees', 'Zero Bridge Risk', 'Deep USDC Liquidity'],
    orbitX: -42,
    orbitY: 28,
  },
  {
    id: 'arb',
    name: 'Arbitrum One',
    symbol: 'ARB',
    hexColor: '#28A0F0',
    logo: '/logos/arbitrum-arb-logo.svg',
    type: 'Ethereum Nitro L2',
    speed: '< 250ms',
    fee: '< $0.02',
    description: 'Leading Ethereum optimistic rollup with deep DeFi liquidity and fast atomic HTLC executions.',
    features: ['Full EVM Equivalence', 'Nitro Tech Stack', 'Deep Stablecoin Liquidity', 'Instant Swaps'],
    orbitX: -44,
    orbitY: -22,
  },
  {
    id: 'move',
    name: 'Movement Network',
    symbol: 'MOVE',
    hexColor: '#F59E0B',
    logo: '/logos/movement.svg',
    type: 'MoveVM Layer 2',
    speed: '< 1s Finality',
    fee: '< $0.001',
    description: 'High-performance MoveVM modular blockchain bringing formal verification and lightning speed to intents.',
    features: ['Move Language Security', 'Sub-second Batches', 'Formal Verification', 'Universal Bridge Free'],
    orbitX: -20,
    orbitY: -42,
  },
  {
    id: 'avax',
    name: 'Avalanche',
    symbol: 'AVAX',
    hexColor: '#E84142',
    logo: '/logos/avalanche-avax-logo.svg',
    type: 'Avalanche C-Chain',
    speed: '< 1s Finality',
    fee: '< $0.05',
    description: 'Sub-second finality EVM subnet architecture enabling high-capacity decentralized trade settlement.',
    features: ['Snowman Consensus', 'Sub-second Finality', 'EVM Native', 'Bridge-free HTLCs'],
    orbitX: 20,
    orbitY: -42,
  },
];

export function WalletChainsArc() {
  const { activeColor } = useChamTheme();
  const [activeChain, setActiveChain] = useState<ChainInfo>(SUPPORTED_CHAINS[0]);
  const [chamTone, setChamTone] = useState<string>(SUPPORTED_CHAINS[0].hexColor);
  const [chamMood, setChamMood] = useState<ChamMood>('idle');
  const [touchingChain, setTouchingChain] = useState<ChainInfo | null>(SUPPORTED_CHAINS[0]);
  const [autoHunt, setAutoHunt] = useState<boolean>(true);
  const arenaRef = useRef<HTMLDivElement>(null);

  // Smoothly touch and camouflage transition to target chain
  const triggerCamouflage = (chain: ChainInfo) => {
    setActiveChain(chain);
    setTouchingChain(chain);
    setChamMood('happy');
    setChamTone(chain.hexColor);

    setTimeout(() => {
      setChamMood('idle');
    }, 1200);
  };

  // Auto-cycle: Chains smoothly float close, touching Cham and shifting colors
  useEffect(() => {
    if (!autoHunt) return;
    const interval = setInterval(() => {
      const remaining = SUPPORTED_CHAINS.filter((c) => c.id !== activeChain.id);
      const randomChain = remaining[Math.floor(Math.random() * remaining.length)];
      triggerCamouflage(randomChain);
    }, 4000);

    return () => clearInterval(interval);
  }, [autoHunt, activeChain]);

  return (
    <section id="chains" className="relative py-28 bg-[#050505] text-white overflow-hidden border-t border-white/5">
      {/* Dynamic Ambient Background Aura morphing with Cham's camouflage */}
      <div
        className="absolute top-1/3 right-10 w-[600px] h-[600px] rounded-full blur-[180px] pointer-events-none opacity-25 transition-all duration-1000"
        style={{ background: chamTone }}
      />
      <div
        className="absolute bottom-10 left-10 w-[500px] h-[500px] rounded-full blur-[160px] pointer-events-none opacity-20 transition-all duration-1000"
        style={{ background: chamTone }}
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
            <Globe className="w-3.5 h-3.5" style={{ color: chamTone }} />
            <span style={{ color: chamTone }}>Interoperability</span>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="font-heading text-3xl sm:text-4xl md:text-5xl font-black tracking-tight"
          >
            Multi-Chain Sovereignty. One Interface.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-zinc-400 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed"
          >
            Floating chain tokens orbit seamlessly around Cham. As they drift and brush against Cham, its skin
            smoothly shifts color to match each network in real time. Click or hover any token to attract it close.
          </motion.p>
        </div>

        {/* Camouflage Arena & Details Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* Left Column: Interactive Cham Camouflage Arena (7 cols) */}
          <div className="lg:col-span-7 flex flex-col items-center">
            {/* Arena Card */}
            <div
              ref={arenaRef}
              className="relative w-full max-w-2xl aspect-[4/3] rounded-[2.5rem] bg-gradient-to-b from-zinc-950/90 to-black border border-white/10 p-6 flex items-center justify-center overflow-hidden shadow-2xl group"
            >
              {/* Radial grid background */}
              <div
                className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none opacity-40"
              />

              {/* Pulsing ring aura matching Cham's active camouflage */}
              <div
                className="absolute w-80 h-80 rounded-full blur-3xl opacity-35 pointer-events-none transition-all duration-1000 animate-pulse"
                style={{ background: chamTone }}
              />

              {/* Soft ethereal space ripple that smoothly radiates when touching */}
              <motion.div
                key={activeChain.id}
                initial={{ scale: 0.6, opacity: 0.6 }}
                animate={{ scale: 1.6, opacity: 0 }}
                transition={{ duration: 2, ease: 'easeOut' }}
                className="absolute w-56 h-56 rounded-full pointer-events-none border border-current"
                style={{ color: chamTone }}
              />

              {/* Orbital guide circles */}
              <div className="absolute w-[82%] h-[82%] rounded-full border border-dashed border-white/10 pointer-events-none animate-spin-very-slow" />
              <div className="absolute w-[56%] h-[56%] rounded-full border border-white/5 pointer-events-none" />

              {/* Center Chameleon Mascot Perched */}
              <div className="relative z-20 flex flex-col items-center select-none pointer-events-auto">
                <Chameleon
                  size={240}
                  tone={chamTone}
                  mood={chamMood}
                  track={true}
                  className="transition-transform duration-500 hover:scale-105 drop-shadow-[0_15px_35px_rgba(0,0,0,0.85)]"
                />

                {/* Live camouflage status pill */}
                <div className="mt-[-8px] flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/85 border border-white/15 backdrop-blur-md text-[11px] font-mono shadow-xl transition-all duration-500">
                  <span
                    className="w-2.5 h-2.5 rounded-full animate-ping transition-colors duration-500"
                    style={{ background: chamTone }}
                  />
                  <span className="text-zinc-300">
                    Active Camouflage: <strong style={{ color: chamTone }}>{activeChain.name}</strong>
                  </span>
                </div>
              </div>

              {/* Floating Chain Token Orbs Orbiting Smoothly Around Cham */}
              {SUPPORTED_CHAINS.map((chain, index) => {
                const isSelected = activeChain.id === chain.id;

                // When selected/touching, orb glides closer to touch Cham (reducing orbit radius by 45%)
                const posX = isSelected ? chain.orbitX * 0.55 : chain.orbitX;
                const posY = isSelected ? chain.orbitY * 0.55 : chain.orbitY;

                return (
                  <motion.div
                    key={chain.id}
                    onClick={() => triggerCamouflage(chain)}
                    onMouseEnter={() => triggerCamouflage(chain)}
                    className="absolute cursor-pointer z-25 group"
                    style={{
                      left: `${50 + posX}%`,
                      top: `${50 + posY}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                    animate={{
                      x: [0, (index % 2 === 0 ? 6 : -6), 0],
                      y: [0, (index % 3 === 0 ? -10 : 8), 0],
                    }}
                    transition={{
                      duration: 4 + (index % 3) * 1.2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  >
                    {/* Glowing Token Orb */}
                    <div
                      className={`relative w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center p-2.5 transition-all duration-500 backdrop-blur-md ${
                        isSelected
                          ? 'scale-125 shadow-2xl border-2'
                          : 'scale-100 hover:scale-115 border hover:border-white/40'
                      }`}
                      style={{
                        background: isSelected ? `${chain.hexColor}30` : 'rgba(20, 20, 25, 0.75)',
                        borderColor: isSelected ? chain.hexColor : 'rgba(255, 255, 255, 0.12)',
                        boxShadow: isSelected
                          ? `0 0 30px ${chain.hexColor}80, 0 0 10px ${chain.hexColor}40`
                          : undefined,
                      }}
                    >
                      <img
                        src={chain.logo}
                        alt={chain.name}
                        className="w-full h-full object-contain filter drop-shadow transition-transform duration-300 group-hover:scale-110"
                        onError={(e) => {
                          const target = e.currentTarget;
                          target.style.display = 'none';
                          const parent = target.parentElement;
                          if (parent && !parent.querySelector('.fallback-symbol')) {
                            const fallback = document.createElement('span');
                            fallback.className = 'fallback-symbol text-xs font-mono font-bold text-white';
                            fallback.innerText = chain.symbol.slice(0, 3);
                            parent.appendChild(fallback);
                          }
                        }}
                      />

                      {/* Touching Halo Pulse Indicator */}
                      {isSelected && (
                        <span
                          className="absolute -inset-1 rounded-2xl border animate-ping pointer-events-none opacity-40"
                          style={{ borderColor: chain.hexColor }}
                        />
                      )}
                    </div>

                    {/* Mini tooltip on hover/select */}
                    <div
                      className={`absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md text-[10px] font-mono whitespace-nowrap transition-all duration-300 pointer-events-none ${
                        isSelected
                          ? 'opacity-100 bg-black/90 border border-white/20 text-white shadow-lg'
                          : 'opacity-0 group-hover:opacity-100 bg-black/70 border border-white/10 text-zinc-300'
                      }`}
                    >
                      {chain.symbol}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Arena Controls Bar */}
            <div className="mt-4 flex items-center justify-between w-full max-w-2xl px-2 text-xs font-mono text-zinc-400">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: chamTone }} />
                <span>Hover or tap any token to bring it close to Cham</span>
              </div>
              <button
                onClick={() => setAutoHunt(!autoHunt)}
                className="px-3 py-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Wand2 className="w-3 h-3" style={{ color: chamTone }} />
                <span>Auto Camouflage: {autoHunt ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </div>

          {/* Right Column: Selected Chain Deep-Dive & Capabilities (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeChain.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.35 }}
                className="p-8 rounded-[2rem] lg-panel border border-white/10 space-y-6 relative overflow-hidden shadow-2xl"
              >
                {/* Accent top gradient bar matching chain color */}
                <div
                  className="absolute top-0 inset-x-0 h-1.5 transition-colors duration-700"
                  style={{ background: activeChain.hexColor }}
                />

                {/* Header with real SVG logo */}
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-4">
                    <div
                      className="w-14 h-14 rounded-2xl p-2.5 flex items-center justify-center backdrop-blur-md border transition-all duration-500"
                      style={{
                        background: `${activeChain.hexColor}20`,
                        borderColor: `${activeChain.hexColor}40`,
                        boxShadow: `0 0 20px ${activeChain.hexColor}30`,
                      }}
                    >
                      <img
                        src={activeChain.logo}
                        alt={activeChain.name}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div>
                      <h3 className="font-heading text-2xl font-bold text-white tracking-tight">
                        {activeChain.name}
                      </h3>
                      <span className="text-xs font-mono text-zinc-400">{activeChain.type}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1 font-mono text-xs">
                    <span
                      className="px-3 py-1 rounded-full font-bold"
                      style={{
                        background: `${activeChain.hexColor}20`,
                        color: activeChain.hexColor,
                      }}
                    >
                      {activeChain.symbol}
                    </span>
                  </div>
                </div>

                {/* Description */}
                <p className="text-sm text-zinc-300 leading-relaxed">{activeChain.description}</p>

                {/* Performance Metrics */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-0.5">
                      Settlement Speed
                    </div>
                    <div className="text-sm font-bold text-white flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5" style={{ color: activeChain.hexColor }} />
                      <span>{activeChain.speed}</span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-0.5">
                      Typical Network Fee
                    </div>
                    <div className="text-sm font-bold text-white flex items-center gap-1.5">
                      <span>⛽</span>
                      <span>{activeChain.fee}</span>
                    </div>
                  </div>
                </div>

                {/* Capabilities Feature Checklist */}
                <div className="space-y-2.5 pt-2 border-t border-white/10">
                  <div className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold mb-2">
                    Covenant & Execution Features
                  </div>
                  {activeChain.features.map((feature, i) => (
                    <div key={i} className="flex items-center gap-2.5 text-xs text-zinc-300">
                      <CheckCircle2
                        className="w-4 h-4 shrink-0 transition-colors duration-500"
                        style={{ color: activeChain.hexColor }}
                      />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Quick Chain Switcher Chips */}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <span className="text-xs font-mono uppercase tracking-wider text-zinc-500 mr-1">Direct Zap:</span>
              {SUPPORTED_CHAINS.map((chain) => {
                const isSelected = activeChain.id === chain.id;
                return (
                  <button
                    key={chain.id}
                    onClick={() => triggerCamouflage(chain)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono flex items-center gap-1.5 border transition-all cursor-pointer ${
                      isSelected
                        ? 'font-bold text-black shadow-md'
                        : 'bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white border-white/10'
                    }`}
                    style={{
                      background: isSelected ? chain.hexColor : undefined,
                      borderColor: isSelected ? chain.hexColor : undefined,
                    }}
                  >
                    <img src={chain.logo} alt="" className="w-3.5 h-3.5 object-contain" />
                    <span>{chain.symbol}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default WalletChainsArc;
