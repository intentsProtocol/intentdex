import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Play,
  Pause,
  RotateCcw,
  FileText,
  Grid,
  Sparkles,
  ShieldCheck,
  Layers,
  Cpu,
  Plane,
  WifiOff,
  Wifi,
  Coins,
  TrendingUp,
  ArrowRight,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Terminal,
  Sliders,
  HelpCircle,
  X,
  ExternalLink,
  Smartphone,
  Flame,
  Clock,
  Compass,
} from 'lucide-react';
import { ChamLogo } from '../common/ChamLogo';

export function PitchDeck() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [accentMode, setAccentMode] = useState<'bitcoin' | 'emerald'>('bitcoin');

  // Pitch Timer state
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Interactive slide states
  const [meshArchetype, setMeshArchetype] = useState<'accumulate' | 'takeprofit' | 'rangemm'>('accumulate');
  const [glassChip, setGlassChip] = useState<'25%' | '50%' | '75%' | 'MAX'>('25%');
  const [demoStep, setDemoStep] = useState(1);
  const [isAirplaneOn, setIsAirplaneOn] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);

  // Timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (timerRunning) {
      interval = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timerRunning]);

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  };

  const nextSlide = useCallback(() => {
    setCurrentSlide((prev) => Math.min(prev + 1, slides.length - 1));
  }, []);

  const prevSlide = useCallback(() => {
    setCurrentSlide((prev) => Math.max(prev - 1, 0));
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        nextSlide();
      } else if (e.key === 'ArrowLeft' || e.key === 'Backspace' || e.key === 'PageUp') {
        e.preventDefault();
        prevSlide();
      } else if (e.key === 'Home') {
        e.preventDefault();
        setCurrentSlide(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setCurrentSlide(slides.length - 1);
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setShowNotes((prev) => !prev);
      } else if (e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setShowGrid((prev) => !prev);
      } else if (e.key.toLowerCase() === 't') {
        e.preventDefault();
        setTimerRunning((prev) => !prev);
      } else if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setAccentMode((prev) => (prev === 'bitcoin' ? 'emerald' : 'bitcoin'));
      } else if (e.key === '?') {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
      } else if (e.key === 'Escape') {
        setShowNotes(false);
        setShowGrid(false);
        setShowShortcuts(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextSlide, prevSlide]);

  const primaryAccent = accentMode === 'bitcoin' ? '#F7931A' : '#10B981';
  const primaryGlow = accentMode === 'bitcoin' ? 'rgba(247, 147, 26, 0.35)' : 'rgba(16, 185, 129, 0.35)';

  // 6 Streamlined Master Slides
  const slides = [
    // SLIDE 1: Hook & Vision
    {
      id: 1,
      badge: 'SLIDE 1/6 · HOOK & VISION',
      title: 'Cham Wallet: The "Flight Mode" Financial Architect',
      subtitle: 'Autonomous On-Device Agentic Finance Powered by Tether’s QVAC & WDK',
      timeTarget: '0:00 - 0:30',
      notes: `Judges, imagine boarding a 9-hour flight from Nairobi to London with zero in-flight Wi-Fi. In today’s Web3, your tools are completely dead—balance queries fail, dApps freeze, and strategy dashboards won't even load. 

What if your phone was an autonomous financial workstation? One that allows you to audit your encrypted portfolio, simulate price swings, and craft sophisticated concentrated liquidity strategies at 35,000 feet—100% offline—and execute on-chain the moment your wheels touch down? 

That is Cham Wallet, powered by Tether’s QVAC and WDK.`,
      render: () => (
        <div className="flex flex-col items-center justify-center text-center h-full max-w-5xl mx-auto px-4">
          <div className="flex items-center gap-3 mb-6">
            <span
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-mono font-bold uppercase tracking-wider border shadow-lg"
              style={{
                backgroundColor: `${primaryAccent}15`,
                color: primaryAccent,
                borderColor: `${primaryAccent}40`,
                boxShadow: `0 0 20px ${primaryGlow}`,
              }}
            >
              <Flame size={14} />
              Tether × Node NBO AI Yako Hackathon
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono bg-white/5 text-gray-300 border border-white/10">
              <Plane size={13} className="text-amber-400" />
              100% Flight Mode
            </span>
          </div>

          <div className="relative mb-6">
            <div
              className="absolute -inset-10 rounded-full blur-3xl opacity-30 animate-pulse-glow"
              style={{ backgroundColor: primaryAccent }}
            />
            <div className="relative flex items-center justify-center">
              <ChamLogo size={90} glow={true} />
            </div>
          </div>

          <h1 className="text-4xl sm:text-6xl font-heading font-black tracking-tight text-white mb-4 leading-tight">
            Cham Wallet <br />
            <span
              className="bg-clip-text text-transparent bg-gradient-to-r"
              style={{
                backgroundImage:
                  accentMode === 'bitcoin'
                    ? 'linear-gradient(to right, #F7931A, #FBBF24, #F59E0B)'
                    : 'linear-gradient(to right, #10B981, #34D399, #059669)',
              }}
            >
              The "Flight Mode" Financial Architect
            </span>
          </h1>

          <p className="text-lg text-gray-300 max-w-2xl font-light mb-8 leading-relaxed">
            Design bespoke liquidity strategies, cross-chain swaps, and collateralized loans mid-flight. Review and
            authorize execution via Tether WDK the moment you touch down.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-3xl">
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 text-left hover:border-white/20 transition-all">
              <div className="text-xs font-mono text-gray-400 mb-1 flex items-center gap-1.5">
                <Plane size={13} className="text-amber-400" /> In the Air (Offline)
              </div>
              <div className="text-sm font-semibold text-white">QVAC On-Device AI</div>
              <div className="text-xs text-gray-400 mt-1">Local Qwen3 1.7B analyzes snapshot & plans Mesh bins.</div>
            </div>

            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 text-left hover:border-white/20 transition-all">
              <div className="text-xs font-mono text-gray-400 mb-1 flex items-center gap-1.5">
                <FileText size={13} style={{ color: primaryAccent }} /> Staged in Outbox
              </div>
              <div className="text-sm font-semibold text-white">Declarative Drafts</div>
              <div className="text-xs text-gray-400 mt-1">Client math computes bytecode with zero exposed keys.</div>
            </div>

            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 text-left hover:border-white/20 transition-all">
              <div className="text-xs font-mono text-gray-400 mb-1 flex items-center gap-1.5">
                <Wifi size={13} className="text-emerald-400" /> Touch Down (Online)
              </div>
              <div className="text-sm font-semibold text-white">WDK Isolated Sign</div>
              <div className="text-xs text-gray-400 mt-1">Biometric PinGate verifies quote & broadcasts on-chain.</div>
            </div>
          </div>
        </div>
      ),
    },

    // SLIDE 2: The Core Problem
    {
      id: 2,
      badge: 'SLIDE 2/6 · THE CORE PROBLEM',
      title: 'Why Cloud AI Wallets & Traditional AMMs Leave Users Stranded',
      subtitle: 'The Web3 Trilemma: Privacy Leakage, Calldata Fragility, and Extreme Impermanent Loss',
      timeTarget: '0:30 - 1:00',
      notes: `Why is this so hard today? Because existing tools leave users stranded in two bad directions. First, contemporary 'AI crypto wallets' are just thin wrappers sending prompts over the internet to OpenAI—leaking your balance, trading intent, and private IP address to cloud surveillance. Even worse, giving an AI direct access to your private key is an existential security risk. On the other side, standard decentralized exchanges force you through twenty confusing sliders and tick pickers—resulting in severe impermanent loss and fragile transactions that revert if price drifts by 0.1%. Cham Wallet replaces this entire fragile model by uniting on-device local intelligence with Tether's self-custodial WDK foundation.`,
      render: () => (
        <div className="flex flex-col h-full max-w-5xl mx-auto px-4 justify-center">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl bg-red-950/20 border border-red-500/20 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-red-400 font-mono text-xs uppercase tracking-wider mb-2">
                  <AlertTriangle size={15} /> Cloud AI Wallets
                </div>
                <h3 className="text-lg font-bold text-white mb-3">Privacy Leakage & Bot Hacks</h3>
                <ul className="space-y-2.5 text-xs text-gray-300">
                  <li className="flex items-start gap-2">
                    <span className="text-red-400 font-bold">✕</span> Prompts, balances, and IP addresses leak to cloud LLM APIs.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-400 font-bold">✕</span> Bot agents hold private keys directly, vulnerable to prompt injection exploits.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-400 font-bold">✕</span> Completely non-functional without continuous Wi-Fi/5G connection.
                  </li>
                </ul>
              </div>
              <div className="mt-6 pt-3 border-t border-red-500/10 text-[11px] font-mono text-red-300">
                Fragile & Centralized
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-amber-950/20 border border-amber-500/20 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-amber-400 font-mono text-xs uppercase tracking-wider mb-2">
                  <Sliders size={15} /> Traditional AMMs
                </div>
                <h3 className="text-lg font-bold text-white mb-3">Cognitive Overload & Slippage</h3>
                <ul className="space-y-2.5 text-xs text-gray-300">
                  <li className="flex items-start gap-2">
                    <span className="text-amber-400 font-bold">✕</span> Full-range passive liquidity leads to brutal impermanent loss.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-400 font-bold">✕</span> Manual concentrated LP requires adjusting 20+ tick sliders and price bands.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-400 font-bold">✕</span> Imperative calldata execution: 0.1% price drift reverts tx and wastes gas.
                  </li>
                </ul>
              </div>
              <div className="mt-6 pt-3 border-t border-amber-500/10 text-[11px] font-mono text-amber-300">
                Rigid & High IL
              </div>
            </div>

            <div
              className="p-6 rounded-2xl border flex flex-col justify-between shadow-xl"
              style={{
                backgroundColor: `${primaryAccent}0D`,
                borderColor: `${primaryAccent}50`,
                boxShadow: `0 0 30px ${primaryGlow}`,
              }}
            >
              <div>
                <div
                  className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider mb-2"
                  style={{ color: primaryAccent }}
                >
                  <ShieldCheck size={15} /> Cham Wallet Solution
                </div>
                <h3 className="text-lg font-bold text-white mb-3">On-Device Autonomy with WDK</h3>
                <ul className="space-y-2.5 text-xs text-gray-200">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>100% On-Device QVAC:</strong> Local Qwen3 1.7B runs on NPU/CPU. Zero data leaves phone.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>Intent-Centric:</strong> You declare desired outcomes; Dutch auction solvers compete to fill.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>WDK Air-Gapped Partition:</strong> AI has zero keys. Signing locked behind biometric PIN.</span>
                  </li>
                </ul>
              </div>
              <div
                className="mt-6 pt-3 border-t font-mono text-[11px] flex items-center justify-between"
                style={{ borderColor: `${primaryAccent}25`, color: primaryAccent }}
              >
                <span>Zero Surveillance</span>
                <span>Self-Custodial</span>
              </div>
            </div>
          </div>
        </div>
      ),
    },

    // SLIDE 3: The Engine (Intents + Mesh Math)
    {
      id: 3,
      badge: 'SLIDE 3/6 · THE ENGINE',
      title: 'Intents Protocol × Mesh Discrete Bins',
      subtitle: 'Outcome-driven AI compiled into discrete concentrated LP grid bytecode with pure client-side math',
      timeTarget: '1:00 - 1:45',
      notes: `Why are Intents and Local AI the perfect match? Because Large Language Models think in outcomes, not imperative calldata. When a human speaks to an AI, they declare intent: 'I want X for my Y' or 'Keep accumulating dips cheaply.' Our local agent translates that conversational nuance into a cryptographically sound intent schema. The AI never handles complex contract bytecode—off-chain solvers compete in Dutch auctions with optimal routing and zero MEV frontrunning. And for liquidity provision, we integrate Mesh Protocol—our discrete bin-based concentrated liquidity engine. During the hackathon, we built localPlanPosition—a pure client-side mathematical planner. It calculates price steps, BCMR token registries, and bytecode commitments completely on-device without any remote server.`,
      render: () => (
        <div className="flex flex-col h-full max-w-5xl mx-auto px-4 justify-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <button
              onClick={() => setMeshArchetype('accumulate')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all ${
                meshArchetype === 'accumulate'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                  : 'bg-white/5 text-gray-400 hover:text-white'
              }`}
            >
              Accumulate Ladder
            </button>
            <button
              onClick={() => setMeshArchetype('takeprofit')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all ${
                meshArchetype === 'takeprofit'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-white/5 text-gray-400 hover:text-white'
              }`}
            >
              Take-Profit Ladder
            </button>
            <button
              onClick={() => setMeshArchetype('rangemm')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all ${
                meshArchetype === 'rangemm'
                  ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                  : 'bg-white/5 text-gray-400 hover:text-white'
              }`}
            >
              Dynamic Range MM
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
            <div className="md:col-span-5 space-y-3">
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
                <div className="text-[11px] font-mono text-gray-400 mb-1">Human Strategy Prompt:</div>
                <div className="text-sm font-medium text-white italic">
                  {meshArchetype === 'accumulate' && '"Keep accumulating PUSDTEST cheaply with a quarter of my BCH."'}
                  {meshArchetype === 'takeprofit' && '"Take profit on my MESH tokens in 5% increments up to 2x."'}
                  {meshArchetype === 'rangemm' && '"Market make around current price with 0.1 BCH and half my tokens."'}
                </div>
              </div>

              <div
                className="p-4 rounded-xl border text-xs space-y-2 font-mono"
                style={{
                  backgroundColor: `${primaryAccent}08`,
                  borderColor: `${primaryAccent}30`,
                }}
              >
                <div className="text-gray-400">Offline Planner: <span className="text-white">localPlanPosition()</span></div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Bin Step BPS:</span>
                  <span className="text-emerald-400">25 bps (0.25%)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Calculated Bins:</span>
                  <span className="text-white font-bold">{meshArchetype === 'rangemm' ? '16 Bins (Bi-directional)' : '10 Bins (Single-sided)'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Server Required:</span>
                  <span className="text-emerald-400 font-bold">0% (Pure Client-Side Math)</span>
                </div>
              </div>
            </div>

            <div className="md:col-span-7 p-6 rounded-2xl bg-black/60 border border-white/10 flex flex-col justify-center">
              <div className="flex items-center justify-between text-xs font-mono text-gray-400 mb-4">
                <span>Concentrated Discrete Bin Spectrum (Mesh V4)</span>
                <span className="text-amber-400">Market Index: #1040</span>
              </div>

              <div className="flex items-end gap-1.5 h-32 w-full pt-4 px-2 bg-white/[0.02] rounded-lg border border-white/5">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((bin) => {
                  let isBuy = bin <= 7;
                  let isMarket = bin === 8;
                  let isSell = bin >= 9;

                  let heightPercent = 20;
                  let bg = 'bg-gray-800';

                  if (meshArchetype === 'accumulate') {
                    if (isBuy) {
                      heightPercent = 30 + (8 - bin) * 9;
                      bg = 'bg-amber-500 shadow-sm shadow-amber-500/50';
                    }
                  } else if (meshArchetype === 'takeprofit') {
                    if (isSell) {
                      heightPercent = 30 + (bin - 8) * 9;
                      bg = 'bg-emerald-500 shadow-sm shadow-emerald-500/50';
                    }
                  } else {
                    if (isBuy) {
                      heightPercent = 25 + (8 - bin) * 7;
                      bg = 'bg-amber-500';
                    } else if (isSell) {
                      heightPercent = 25 + (bin - 8) * 7;
                      bg = 'bg-emerald-500';
                    }
                  }

                  if (isMarket) {
                    heightPercent = 100;
                    bg = 'bg-white';
                  }

                  return (
                    <div key={bin} className="flex-1 flex flex-col items-center justify-end h-full">
                      <div
                        className={`w-full rounded-t transition-all duration-300 ${bg}`}
                        style={{ height: `${heightPercent}%` }}
                      />
                      <span className="text-[9px] font-mono text-gray-500 mt-1">
                        {isMarket ? '★' : bin}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono mt-3 text-gray-400">
                <span className="text-amber-400">◀ Bids (Accumulate)</span>
                <span className="text-white">Current Price</span>
                <span className="text-emerald-400">Asks (Take-Profit) ▶</span>
              </div>
            </div>
          </div>
        </div>
      ),
    },

    // SLIDE 4: Tether WDK Security Partition & Unified Passphrase
    {
      id: 4,
      badge: 'SLIDE 4/6 · THE SECURITY PARTITION',
      title: 'Tether WDK: Air-Gapped Security & Unified Passphrase',
      subtitle: 'The AI assistant runs in unprivileged userland with zero keys. Keys stay locked inside the isolated WDK worklet.',
      timeTarget: '1:45 - 2:30',
      notes: `Now, the billion-dollar question: is it safe to let an AI near your wallet? With Cham Wallet, the answer is mathematically yes—thanks to our strict Tether WDK Security Partition. The QVAC local AI assistant runs in unprivileged mobile userland. It has zero access to private keys or seed phrases. It cannot sign transactions, and it cannot drain funds. It only inspects sanitized local snapshots and places declarative drafts into your local Outbox. All key derivation and signing are sealed inside an isolated background worklet powered by Tether WDK. Transactions can only be unlocked when you enter your biometric PIN via PinGate. And thanks to Tether WDK’s unified architecture, the exact same 12-word recovery phrase seamlessly powers your wallet across three surfaces: our Web App for active trading, our Browser Extension for desktop dApps, and this Mobile App for daily offline intelligence.`,
      render: () => (
        <div className="flex flex-col h-full max-w-5xl mx-auto px-4 justify-center">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/10 space-y-4">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-400">
                <Smartphone size={16} /> Unified by Tether WDK
              </div>
              <h3 className="text-xl font-heading font-bold text-white">One Passphrase, Infinite Surfaces</h3>
              <p className="text-xs text-gray-300 leading-relaxed">
                The identical 12-word recovery phrase provides unified multi-chain self-custody across all platforms:
              </p>
              <div className="space-y-2 text-xs font-mono">
                <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 flex items-center justify-between">
                  <span className="text-gray-300">Cham Wallet Web App</span>
                  <span className="text-amber-400">Desktop Trading Desks</span>
                </div>
                <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 flex items-center justify-between">
                  <span className="text-gray-300">Browser Extension</span>
                  <span className="text-amber-400">Web3 dApp Connectivity</span>
                </div>
                <div
                  className="p-2.5 rounded-lg border flex items-center justify-between"
                  style={{ backgroundColor: `${primaryAccent}15`, borderColor: `${primaryAccent}40` }}
                >
                  <span className="text-white font-bold">Mobile App (QVAC AI)</span>
                  <span className="text-emerald-400">Pocket Offline Workstation</span>
                </div>
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-black/60 border border-white/10 space-y-4">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-emerald-400">
                <Lock size={15} /> The Strict WDK Security Boundary
              </div>

              <div className="p-3.5 rounded-xl bg-gray-900/80 border border-white/10">
                <div className="flex items-center justify-between text-xs font-mono text-gray-300 mb-1">
                  <span>UNPRIVILEGED USERLAND</span>
                  <span className="text-red-400 font-bold">NO KEYS ACCESS</span>
                </div>
                <div className="text-[11px] text-gray-400 font-mono">
                  React Native UI + QVAC Agent (@qvac/sdk 0.22.0)
                </div>
                <div className="text-[10px] text-gray-500 mt-1">Reads sanitized snapshot; drafts to Outbox.</div>
              </div>

              <div className="flex justify-center text-xs font-mono text-gray-400 py-0.5 flex-col items-center">
                <div className="h-4 w-px bg-white/20" />
                <span className="text-[10px] bg-black px-2 py-0.5 rounded border border-white/10 text-amber-300">
                  PinGate Biometric PIN Auth
                </span>
                <div className="h-4 w-px bg-white/20" />
              </div>

              <div
                className="p-3.5 rounded-xl border"
                style={{ backgroundColor: `${primaryAccent}10`, borderColor: `${primaryAccent}40` }}
              >
                <div className="flex items-center justify-between text-xs font-mono mb-1" style={{ color: primaryAccent }}>
                  <span>ISOLATED WDK WORKLET (Bare Kit)</span>
                  <span className="text-emerald-400 font-bold">SIGNING ENGINE</span>
                </div>
                <div className="text-[11px] text-gray-200 font-mono">
                  @tetherto/wdk + @bch-intents/wdk-wallet-bch
                </div>
                <div className="text-[10px] text-gray-400 mt-1">Derives keys, signs raw tx, and broadcasts on-chain.</div>
              </div>
            </div>
          </div>
        </div>
      ),
    },

    // SLIDE 5: Live Demo (The 4-Step Flight Mode)
    {
      id: 5,
      badge: 'SLIDE 5/6 · LIVE OFFLINE DEMO',
      title: 'The 4-Step Flight Mode Demo: Tested 100% Offline',
      subtitle: 'Liquid Glass Amount Editor, Underfunded Top-Up, and Biometric Outbox Execution',
      timeTarget: '2:30 - 3:15',
      notes: `Let’s see it live on this phone. Airplane mode is turned ON—zero Wi-Fi, zero cellular. I type: 'Keep accumulating PUSDTEST cheaply with a quarter of my BCH.' In milliseconds, running directly on this phone’s CPU, QVAC invokes plan_strategy. Our local client math builds the concentrated bins and renders an interactive Liquid Glass Amount Editor. Watch this: when I tap the preset chips—25%, 50%, or MAX—the bin allocations, deposit amounts, and liquidation ratios recalculate live on screen with zero latency! Even if my balance is low, our Underfunded Draft Engine never errors out—it computes the exact missing satoshis and renders a one-tap Top Up button. Now, our plane lands. I toggle Airplane Mode OFF. I tap Review and Approve, enter my PIN via PinGate, and Tether WDK signs and broadcasts the transaction on-chain.`,
      render: () => {
        const getBchAmount = () => {
          if (glassChip === '25%') return '0.25 BCH';
          if (glassChip === '50%') return '0.50 BCH';
          if (glassChip === '75%') return '0.75 BCH';
          return '1.00 BCH';
        };
        const getDepositTokens = () => {
          if (glassChip === '25%') return '250 PUSD';
          if (glassChip === '50%') return '500 PUSD';
          if (glassChip === '75%') return '750 PUSD';
          return '1,000 PUSD';
        };
        const getLtv = () => {
          if (glassChip === '25%') return '28%';
          if (glassChip === '50%') return '42%';
          if (glassChip === '75%') return '63%';
          return '79%';
        };

        return (
          <div className="flex flex-col h-full max-w-5xl mx-auto px-4 justify-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <button
                onClick={() => setIsAirplaneOn(!isAirplaneOn)}
                className={`px-4 py-1.5 rounded-xl text-xs font-mono font-bold flex items-center gap-2 transition-all ${
                  isAirplaneOn
                    ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/40'
                    : 'bg-white/10 text-gray-300 border border-white/10'
                }`}
              >
                {isAirplaneOn ? <WifiOff size={14} /> : <Wifi size={14} />}
                {isAirplaneOn ? 'Airplane Mode: ON (100% Offline)' : 'Airplane Mode: OFF (Online)'}
              </button>
              <span className="text-xs font-mono text-gray-400">
                {isAirplaneOn ? 'Local AI: Active on Phone' : 'Status: Ready to Broadcast'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              {/* Interactive Liquid Glass Card Mockup */}
              <div
                className="p-5 rounded-2xl border backdrop-blur-xl space-y-3.5 shadow-2xl"
                style={{
                  backgroundColor: 'rgba(20, 20, 25, 0.75)',
                  borderColor: `${primaryAccent}40`,
                  boxShadow: `0 0 35px ${primaryGlow}`,
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                    <Sparkles size={14} /> Liquid Glass Strategy Card
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/10 text-white">Draft #9281</span>
                </div>

                <div className="text-sm font-semibold text-white">Accumulate Ladder: PUSDTEST</div>

                {/* Preset Chips */}
                <div className="flex items-center gap-2 pt-1">
                  {(['25%', '50%', '75%', 'MAX'] as const).map((chip) => (
                    <button
                      key={chip}
                      onClick={() => setGlassChip(chip)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                        glassChip === chip
                          ? 'bg-amber-500 text-black shadow-md shadow-amber-500/40'
                          : 'bg-white/5 text-gray-400 hover:text-white border border-white/5'
                      }`}
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                {/* Live Recalculated Values */}
                <div className="p-3.5 rounded-xl bg-black/60 border border-white/5 space-y-2 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-gray-400">BCH Allocation:</span>
                    <span className="text-white font-bold">{getBchAmount()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Target Tokens:</span>
                    <span className="text-emerald-400 font-bold">{getDepositTokens()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Liquidation LTV:</span>
                    <span className="text-amber-400 font-bold">{getLtv()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button className="flex-1 py-2 rounded-xl bg-white/10 text-xs font-mono text-white hover:bg-white/20 transition-all">
                    Staged to Outbox
                  </button>
                  <button
                    className="flex-1 py-2 rounded-xl text-xs font-mono font-bold text-black transition-all"
                    style={{ backgroundColor: primaryAccent }}
                  >
                    1-Tap Top Up
                  </button>
                </div>
              </div>

              {/* Terminal / Live Prompt Simulator */}
              <div className="p-4 rounded-xl bg-black/80 border border-white/10 font-mono text-xs space-y-2">
                <div className="flex items-center justify-between text-gray-500 pb-2 border-b border-white/10">
                  <span className="flex items-center gap-1.5 text-gray-400">
                    <Terminal size={14} /> Terminal Trace
                  </span>
                  <span className="text-emerald-400">
                    {isAirplaneOn ? 'OFFLINE_FLIGHT_MODE' : 'NETWORK_RECONNECTED'}
                  </span>
                </div>
                <div className="space-y-1.5 text-gray-300 text-[11px]">
                  <div><span className="text-amber-400">&gt; user:</span> "Keep accumulating PUSDTEST cheaply with a quarter of my BCH"</div>
                  <div><span className="text-emerald-400">&gt; qvac:</span> tool: <strong className="text-white">plan_strategy</strong> (reasoning: 0)</div>
                  <div><span className="text-sky-400">&gt; core:</span> localPlanPosition() -&gt; 10 bins, 25,000,000 sats allocated</div>
                  <div><span className="text-purple-400">&gt; outbox:</span> declarative draft saved locally (ID #9281)</div>
                  {isAirplaneOn ? (
                    <div className="text-amber-400 animate-pulse">&gt; waiting: toggle Airplane Mode off to sign via WDK</div>
                  ) : (
                    <div className="text-emerald-400">&gt; pin: verified -&gt; WDK worklet broadcast to Chipnet tx: 0x8a7f...</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      },
    },

    // SLIDE 6: Deliverables & Credibility
    {
      id: 6,
      badge: 'SLIDE 6/6 · DELIVERABLES & CREDIBILITY',
      title: 'AI Yako Deliverables & Production Credibility',
      subtitle: 'Built October 24–30, 2026. Verified with 167 automated tests passing with a 100% pass rate.',
      timeTarget: '3:15 - 3:45',
      notes: `During AI Yako, we engineered real, production-ready infrastructure: integrating @qvac/sdk 0.22.0 into React Native Bare Kit, clocking over twenty tokens per second on CPU; building a deterministic suite of 10 agent tools from loan modeling to bin simulation; building pure client-side AMM bytecode planners; and verifying the entire codebase with 167 automated unit and integration tests passing at a 100% rate. In emerging markets like Kenya, spotty connectivity should never freeze your money. You don't need a cloud server to plan your financial future. You just need the device in your pocket. Cham Wallet: Real financial autonomy on hardware you own. Thank you, judges! We’re ready for your questions.`,
      render: () => (
        <div className="flex flex-col h-full max-w-5xl mx-auto px-4 justify-center">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 space-y-2">
              <div className="text-xs font-mono uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <Cpu size={15} /> Local AI Engine
              </div>
              <div className="space-y-1 text-xs font-mono text-gray-300">
                <div>SDK: <strong className="text-white">@qvac/sdk v0.22.0</strong></div>
                <div>Runtime: <strong className="text-white">bare-rpc Worker</strong></div>
                <div>Model: <strong className="text-amber-400">Qwen3 1.7B Q4 (~1.06GB)</strong></div>
                <div>Hardware: <strong className="text-white">Samsung S24 (CPU 20+ tps)</strong></div>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 space-y-2">
              <div className="text-xs font-mono uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <ShieldCheck size={15} /> Tether WDK Stack
              </div>
              <div className="space-y-1 text-xs font-mono text-gray-300">
                <div>WDK Core: <strong className="text-white">@tetherto/wdk v1.0.0</strong></div>
                <div>BCH Module: <strong className="text-emerald-400">@bch-intents/wdk-wallet-bch</strong></div>
                <div>Multi-Chain: <strong className="text-white">BCH, EVM, SOL, BTC</strong></div>
                <div>Security: <strong className="text-white">PinGate Biometric Auth</strong></div>
              </div>
            </div>

            <div
              className="p-4 rounded-2xl border space-y-2 shadow-xl"
              style={{
                backgroundColor: `${primaryAccent}0D`,
                borderColor: `${primaryAccent}40`,
                boxShadow: `0 0 25px ${primaryGlow}`,
              }}
            >
              <div className="text-xs font-mono uppercase tracking-wider flex items-center justify-between" style={{ color: primaryAccent }}>
                <span className="flex items-center gap-1.5"><CheckCircle2 size={15} /> Test Suite Scorecard</span>
                <span className="font-bold">100% PASS</span>
              </div>
              <div className="text-center py-1">
                <div className="text-2xl font-heading font-black text-white">167 / 167 Tests Passing</div>
                <div className="text-[11px] font-mono text-emerald-400">104 wallet-core · 63 wallet-app</div>
              </div>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-left space-y-1">
              <h4 className="text-base font-heading font-bold text-white flex items-center gap-2">
                <Compass size={16} className="text-amber-400" /> Financial Sovereignty for Emerging Markets
              </h4>
              <p className="text-xs text-gray-300 font-light max-w-xl">
                Intermittent connectivity in Nairobi or rural transit should never freeze your money.
                Cham Wallet turns everyday phones into autonomous financial workstations.
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <a
                href="https://github.com/intentsProtocol/intentdex"
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 rounded-xl font-mono text-xs font-bold text-black flex items-center gap-1.5 shadow-lg hover:opacity-90 transition-all"
                style={{ backgroundColor: primaryAccent }}
              >
                <ExternalLink size={13} /> GitHub Repo
              </a>
              <a
                href="/"
                className="px-4 py-2 rounded-xl font-mono text-xs text-white bg-white/10 hover:bg-white/20 border border-white/10 transition-all"
              >
                Back to Wallet
              </a>
            </div>
          </div>
        </div>
      ),
    },
  ];

  const activeSlideData = slides[currentSlide];

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col w-screen h-screen bg-[#070709] text-foreground overflow-hidden select-none"
      style={{
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* Dynamic Background Glow */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] rounded-full blur-[140px] pointer-events-none opacity-20"
        style={{ backgroundColor: primaryAccent }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(#ffffff08_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none" />

      {/* Top Presentation Bar */}
      <header className="relative z-20 flex items-center justify-between px-6 py-3 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <a href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <ChamLogo size={28} glow={true} />
            <span className="font-heading font-bold text-sm text-white">Cham Wallet</span>
          </a>
          <span className="text-gray-600">|</span>
          <span className="text-xs font-mono font-medium text-gray-400">
            Master Deck <span style={{ color: primaryAccent }}>· 6 Slides</span>
          </span>
        </div>

        {/* Slide Tracker & Controls */}
        <div className="flex items-center gap-3">
          {/* Pitch Timer */}
          <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-white/5 border border-white/10 font-mono text-xs">
            <Clock size={13} className="text-gray-400" />
            <span className={elapsedSeconds > 225 ? 'text-red-400 font-bold' : 'text-gray-200'}>
              {formatTimer(elapsedSeconds)}
            </span>
            <span className="text-gray-500">/ 03:45</span>
            <button
              onClick={() => setTimerRunning(!timerRunning)}
              className="text-gray-400 hover:text-white transition-colors ml-1"
              title={timerRunning ? 'Pause Timer (T)' : 'Start Timer (T)'}
            >
              {timerRunning ? <Pause size={12} /> : <Play size={12} />}
            </button>
            <button
              onClick={() => {
                setTimerRunning(false);
                setElapsedSeconds(0);
              }}
              className="text-gray-400 hover:text-white transition-colors"
              title="Reset Timer"
            >
              <RotateCcw size={12} />
            </button>
          </div>

          {/* Bitcoin / Emerald Accent Mode Switcher */}
          <button
            onClick={() => setAccentMode(accentMode === 'bitcoin' ? 'emerald' : 'bitcoin')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono border transition-all"
            style={{
              backgroundColor: `${primaryAccent}15`,
              color: primaryAccent,
              borderColor: `${primaryAccent}40`,
            }}
            title="Toggle Bitcoin Gold / Emerald Tone (B)"
          >
            <Coins size={13} />
            {accentMode === 'bitcoin' ? 'Bitcoin Gold' : 'Cham Emerald'}
          </button>

          {/* Speaker Notes Toggle */}
          <button
            onClick={() => setShowNotes(!showNotes)}
            className={`p-1.5 rounded-lg border transition-all ${
              showNotes
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                : 'bg-white/5 text-gray-400 hover:text-white border-white/10'
            }`}
            title="Toggle Speaker Voice-Over Notes (N)"
          >
            <FileText size={16} />
          </button>

          {/* Slide Grid Overview */}
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`p-1.5 rounded-lg border transition-all ${
              showGrid
                ? 'bg-white/20 text-white border-white/30'
                : 'bg-white/5 text-gray-400 hover:text-white border-white/10'
            }`}
            title="Slide Grid Overview (G)"
          >
            <Grid size={16} />
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/10 transition-all"
            title="Toggle Fullscreen (F)"
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>

          {/* Keyboard Shortcuts Help */}
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/10 transition-all"
            title="Shortcuts (?)"
          >
            <HelpCircle size={16} />
          </button>
        </div>
      </header>

      {/* Main Slide Presentation Stage */}
      <main className="relative z-10 flex-1 flex flex-col justify-between p-6 sm:p-10 overflow-hidden">
        {/* Slide Header metadata */}
        <div className="flex items-center justify-between text-xs font-mono text-gray-400 mb-2">
          <div className="flex items-center gap-2">
            <span
              className="px-2.5 py-0.5 rounded text-[11px] font-bold uppercase"
              style={{
                backgroundColor: `${primaryAccent}20`,
                color: primaryAccent,
              }}
            >
              {activeSlideData.badge}
            </span>
            <span className="hidden sm:inline text-gray-500">·</span>
            <span className="hidden sm:inline text-gray-400">{activeSlideData.subtitle}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-gray-500">Pace: {activeSlideData.timeTarget}</span>
            <span className="text-white font-bold">
              {String(currentSlide + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}
            </span>
          </div>
        </div>

        {/* Dynamic Slide Canvas */}
        <div className="flex-1 flex items-center justify-center overflow-y-auto py-2">
          {activeSlideData.render()}
        </div>

        {/* Bottom Slide Navigation Bar */}
        <div className="flex items-center justify-between pt-4 border-t border-white/10">
          <button
            onClick={prevSlide}
            disabled={currentSlide === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-gray-300 hover:text-white border border-white/10 transition-all"
          >
            <ChevronLeft size={16} /> Previous
          </button>

          {/* Visual Dot Steppers */}
          <div className="flex items-center gap-2 overflow-x-auto max-w-md px-2">
            {slides.map((slide, idx) => (
              <button
                key={slide.id}
                onClick={() => setCurrentSlide(idx)}
                className={`h-2.5 rounded-full transition-all ${
                  currentSlide === idx
                    ? 'w-8 shadow-md'
                    : 'w-2.5 bg-white/20 hover:bg-white/40'
                }`}
                style={{
                  backgroundColor: currentSlide === idx ? primaryAccent : undefined,
                  boxShadow: currentSlide === idx ? `0 0 10px ${primaryGlow}` : undefined,
                }}
                title={`Slide ${idx + 1}: ${slide.title}`}
              />
            ))}
          </div>

          <button
            onClick={nextSlide}
            disabled={currentSlide === slides.length - 1}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold text-black disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg"
            style={{ backgroundColor: primaryAccent }}
          >
            Next <ChevronRight size={16} />
          </button>
        </div>
      </main>

      {/* Speaker Notes Drawer (Toggled with 'N') */}
      {showNotes && (
        <div className="absolute bottom-16 right-6 w-96 max-h-[380px] p-5 rounded-2xl bg-[#0e0e13]/95 border border-amber-500/30 backdrop-blur-xl shadow-2xl z-30 flex flex-col justify-between overflow-hidden">
          <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
            <span className="text-xs font-mono text-amber-400 uppercase tracking-wider flex items-center gap-1.5 font-bold">
              <FileText size={14} /> Speaker Notes (Slide {currentSlide + 1})
            </span>
            <button
              onClick={() => setShowNotes(false)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <X size={15} />
            </button>
          </div>
          <div className="text-xs text-gray-200 overflow-y-auto leading-relaxed space-y-2 pr-1 font-sans">
            {activeSlideData.notes.split('\n\n').map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
          <div className="pt-3 mt-3 border-t border-white/10 text-[10px] font-mono text-gray-400 flex justify-between">
            <span>Target: {activeSlideData.timeTarget}</span>
            <span className="text-amber-400">Press 'N' to dismiss</span>
          </div>
        </div>
      )}

      {/* Slide Grid Overview Overlay (Toggled with 'G') */}
      {showGrid && (
        <div className="absolute inset-0 bg-black/90 backdrop-blur-md z-40 p-10 overflow-y-auto">
          <div className="flex items-center justify-between mb-8 max-w-5xl mx-auto">
            <h2 className="text-2xl font-heading font-bold text-white flex items-center gap-3">
              <Grid size={22} style={{ color: primaryAccent }} />
              Slide Overview (Jump to Slide)
            </h2>
            <button
              onClick={() => setShowGrid(false)}
              className="px-4 py-2 rounded-xl text-xs font-mono bg-white/10 text-white hover:bg-white/20 transition-all flex items-center gap-2"
            >
              <X size={16} /> Close Grid
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {slides.map((slide, idx) => (
              <div
                key={slide.id}
                onClick={() => {
                  setCurrentSlide(idx);
                  setShowGrid(false);
                }}
                className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                  currentSlide === idx
                    ? 'border-amber-400 bg-white/[0.08] shadow-lg shadow-amber-500/20'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-mono text-gray-400 mb-2">
                  <span>Slide {String(idx + 1).padStart(2, '0')}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-white/5">{slide.timeTarget}</span>
                </div>
                <h4 className="text-sm font-bold text-white mb-1.5">{slide.title}</h4>
                <p className="text-xs text-gray-400 line-clamp-2">{slide.subtitle}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Legend Modal (Toggled with '?') */}
      {showShortcuts && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="p-6 rounded-2xl bg-[#101015] border border-white/20 max-w-md w-full shadow-2xl">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/10">
              <h3 className="text-base font-bold text-white flex items-center gap-2 font-heading">
                <HelpCircle size={18} style={{ color: primaryAccent }} /> Keyboard Shortcuts
              </h3>
              <button onClick={() => setShowShortcuts(false)} className="text-gray-400 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-2.5 text-xs font-mono text-gray-300">
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-white">Next Slide:</span>
                <span className="text-amber-400">Right Arrow / Space / PageDown</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-white">Previous Slide:</span>
                <span className="text-amber-400">Left Arrow / Backspace / PageUp</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-white">Speaker Notes:</span>
                <span className="text-amber-400">N</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-white">Slide Grid Overview:</span>
                <span className="text-amber-400">G</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-white">Toggle Fullscreen:</span>
                <span className="text-amber-400">F</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-white">Toggle Timer:</span>
                <span className="text-amber-400">T</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-white">Toggle Bitcoin / Emerald Theme:</span>
                <span className="text-amber-400">B</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
