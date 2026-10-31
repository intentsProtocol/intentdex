import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, HelpCircle, Sparkles, MessageCircle, Heart, Zap, Shield, Key } from 'lucide-react';
import { useChamTheme } from '@/context/ChamThemeContext';
import { Chameleon, type ChamMood } from '@/components/mascot/Chameleon';

interface FAQItem {
  question: string;
  answer: string;
  category: string;
  chamMood: ChamMood;
  chamComment: string;
}

const FAQS: FAQItem[] = [
  {
    question: 'What is Cham Wallet and how does it differ from traditional crypto wallets?',
    category: 'Architecture',
    chamMood: 'happy',
    chamComment: 'No bridges, no gas math! Just declare what you want.',
    answer:
      'Cham Wallet is a multi-chain, self-custodial mobile app and browser extension built for declarative onchain finance. Instead of manually bridging tokens, calculating slippage, and signing multiple approval transactions across disparate networks, you simply express what you want (e.g. "Swap 5 BCH for SOL at current market price"). Decentralized solvers compete to fulfill your order atomically with zero lockup bridges.',
  },
  {
    question: 'How do cross-chain swaps work without wrapped token bridges?',
    category: 'Swaps & Intents',
    chamMood: 'busy',
    chamComment: 'HTLC covenants ensure atomic settlement on both chains!',
    answer:
      'Cham Wallet uses Hash Time-Locked Contracts (HTLCs) and CashScript smart covenants. When you submit an intent, solvers lock funds on the destination chain (e.g., Solana SPL) and you lock on the origin chain (e.g., Bitcoin Cash). Once cryptographic pre-images are revealed, settlement executes simultaneously. If a counterparty fails to fulfill, your funds automatically refund upon timeout with zero risk of bridge exploit.',
  },
  {
    question: 'Which blockchains and token standards are supported?',
    category: 'Networks',
    chamMood: 'happy',
    chamComment: 'I adapt my skin color to whichever chain you select!',
    answer:
      'Cham Wallet supports Bitcoin Cash (Native UTXO & CashTokens), Solana (SPL tokens), Ethereum (ERC-20), Movement Network (MoveVM), BNB Chain (BEP-20), Arbitrum One, Base, and Monero (XMR via atomic scriptless scripts). New chains are continually added via modular relayer integrations.',
  },
  {
    question: 'Does Cham Wallet have full support for Bitcoin Cash CashTokens?',
    category: 'CashTokens',
    chamMood: 'happy',
    chamComment: 'Sub-penny fees (<$0.001) and native UTXO commitment inspection!',
    answer:
      'Yes! Cham Wallet is one of the few mobile & extension wallets with native, first-class CashTokens support. You can store, send, receive, and mint both Fungible Tokens (FT) and Non-Fungible Tokens (NFT) on Bitcoin Cash, complete with BCMR onchain metadata resolution and UTXO commitment inspection.',
  },
  {
    question: 'How can I earn yield using BCH Mesh inside the wallet?',
    category: 'DeFi & Yield',
    chamMood: 'busy',
    chamComment: 'Deposit idle funds to earn real solver transaction swap fees!',
    answer:
      'Cham Wallet integrates directly with the BCH Mesh peer-to-peer liquidity protocol. You can deposit idle BCH, CashTokens, or stablecoins into decentralized mesh pools with a single tap. Liquidity providers earn real transaction swap fees paid by active solvers and arbitrageurs.',
  },
  {
    question: 'Is Cham Wallet non-custodial? Who owns the private keys?',
    category: 'Security',
    chamMood: 'shy',
    chamComment: 'I shut my eye! Your keys never leave your device.',
    answer:
      'Cham Wallet is 100% self-custodial. Your private keys and 12/24-word recovery seed are encrypted locally on your device using salted PBKDF2 and AES-256-GCM, and stored inside your hardware Secure Enclave or Keychain. No server, developer, or relayer ever has access to your keys.',
  },
  {
    question: 'How does Cham Wallet Local AI work 100% offline in Airplane Mode?',
    category: 'Local AI & Privacy',
    chamMood: 'busy',
    chamComment: "Tether QVAC runs Qwen3 1.7B locally on your phone's NPU with zero cloud calls!",
    answer:
      "Cham Wallet embeds Tether's QVAC runtime running an optimized Qwen3 1.7B model directly on your smartphone's hardware (NPU/CPU). Whether you are cruising at 35,000 feet with zero Wi-Fi or off-grid, the AI analyzes your local encrypted portfolio snapshots, models collateralized loan ratios, and calculates discrete Mesh V4 liquidity bin grids offline. Transactions are queued safely in your Outbox and broadcast via Tether WDK once your device reconnects.",
  },
  {
    question: 'How do I install Cham Wallet on my Android phone or desktop browser?',
    category: 'Download',
    chamMood: 'happy',
    chamComment: 'Direct APK available now for Android, plus Chrome Extension ZIP & Web App!',
    answer:
      'Cham Wallet offers three convenient options: 1) Download the direct standalone Android APK (EAS Release) directly from our website for 100% offline QVAC Local AI; 2) Download our Chromium extension ZIP bundle directly from the landing page and load it unpacked via chrome://extensions in Developer mode; or 3) Launch the instant web dApp at champrotocol.vercel.app with zero installation needed.',
  },
  {
    question: 'Can I test Cham Wallet on chipnet / testnet before using real funds?',
    category: 'Testing',
    chamMood: 'busy',
    chamComment: 'Test freely on Chipnet (testnet4) with zero real money risk!',
    answer:
      'Absolutely. Cham Wallet supports both Bitcoin Cash mainnet and chipnet (testnet4), as well as testnets for connected EVM and Solana networks. We strongly encourage users to test on chipnet first during the public alpha.',
  },
  {
    question: 'Who is Cham the chameleon mascot?',
    category: 'Mascot',
    chamMood: 'happy',
    chamComment: 'That is me! I am your loyal companion across the multi-chain!',
    answer:
      "Cham is the wallet's loyal companion mascot! Cham lives right on your screen, adapts its skin color to match whichever chain or theme you are using, looks around attentively while you navigate, shuts its eye protectively when you handle recovery phrases or PINs, and flicks its tongue happily whenever an intent or swap confirms.",
  },
];

export function WalletFAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const [manualMood, setManualMood] = useState<ChamMood | null>(null);
  const { activeColor } = useChamTheme();

  const activeFAQ = openIndex !== null ? FAQS[openIndex] : FAQS[0];
  const currentMood: ChamMood = manualMood || (openIndex !== null ? activeFAQ.chamMood : 'idle');

  const toggle = (idx: number) => {
    setManualMood(null);
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <section id="faq" className="relative py-28 bg-[#050505] text-white overflow-hidden border-t border-white/5">
      {/* Background glow orb */}
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full blur-[180px] pointer-events-none opacity-10 transition-colors duration-1000"
        style={{ background: activeColor.hex }}
      />

      <div className="container mx-auto px-4 max-w-6xl relative z-10">
        {/* Section Header */}
        <div className="text-center mb-16 space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-semibold uppercase tracking-wider">
            <HelpCircle className="w-3.5 h-3.5" style={{ color: activeColor.hex }} />
            <span style={{ color: activeColor.hex }}>Knowledge Base</span>
          </div>
          <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-black tracking-tight">
            Frequently Asked Questions
          </h2>
          <p className="text-zinc-400 text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
            Everything you need to know about Cham Wallet, non-custodial security, and intent swaps.
          </p>
        </div>

        {/* Content Layout: Mascot Card on Left/Top + Accordion on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Mascot Companion Column (4 cols) */}
          <div className="lg:col-span-4 lg:sticky lg:top-28">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="rounded-3xl p-6 lg-panel border border-white/10 relative overflow-hidden text-center shadow-2xl flex flex-col items-center"
            >
              {/* Radial backdrop */}
              <div
                className="absolute inset-0 opacity-20 pointer-events-none"
                style={{
                  background: `radial-gradient(circle at 50% 35%, ${activeColor.hex}40, transparent 70%)`,
                }}
              />

              {/* Speech bubble */}
              <div className="relative z-10 mb-4 w-full">
                <div className="relative inline-block max-w-[280px] px-4 py-2.5 rounded-2xl bg-zinc-900/90 border border-white/15 text-xs text-zinc-200 font-medium shadow-lg">
                  <div className="flex items-center gap-1.5 justify-center mb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    <Sparkles className="w-3 h-3" style={{ color: activeColor.hex }} />
                    <span>Cham says</span>
                  </div>
                  <p className="text-white text-xs leading-snug">
                    "{activeFAQ.chamComment}"
                  </p>
                  {/* Bubble tail pointer */}
                  <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-zinc-900/90 border-r border-b border-white/15 rotate-45" />
                </div>
              </div>

              {/* Chameleon Mascot */}
              <div className="relative z-10 my-2 cursor-pointer group" onClick={() => setManualMood(manualMood === 'happy' ? 'busy' : 'happy')}>
                <motion.div
                  animate={{ y: [0, -4, 0] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Chameleon
                    size={170}
                    tone={activeColor.hex}
                    mood={currentMood}
                    track={true}
                    className="drop-shadow-[0_16px_35px_rgba(0,0,0,0.5)] transition-transform duration-300 group-hover:scale-105"
                  />
                </motion.div>
                <div className="mt-2 text-[11px] font-semibold text-zinc-400 group-hover:text-zinc-200 transition-colors">
                  Mood: <span className="text-white font-bold capitalize">{currentMood}</span>
                </div>
              </div>

              {/* Interactive Mood Buttons */}
              <div className="relative z-10 mt-4 flex items-center justify-center gap-1.5 bg-black/40 p-1.5 rounded-xl border border-white/5 w-full">
                <button
                  type="button"
                  onClick={() => setManualMood('happy')}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1 ${currentMood === 'happy'
                      ? 'bg-white/15 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                >
                  <Heart className="w-3 h-3 text-pink-400" />
                  Happy
                </button>
                <button
                  type="button"
                  onClick={() => setManualMood('busy')}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1 ${currentMood === 'busy'
                      ? 'bg-white/15 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                >
                  <Zap className="w-3 h-3 text-amber-400" />
                  Busy
                </button>
                <button
                  type="button"
                  onClick={() => setManualMood('shy')}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1 ${currentMood === 'shy'
                      ? 'bg-white/15 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                >
                  <Shield className="w-3 h-3 text-cyan-400" />
                  Safe
                </button>
              </div>

              {/* Help Prompt */}
              <div className="relative z-10 mt-4 pt-4 border-t border-white/5 w-full text-center">
                <p className="text-[11px] text-zinc-400">
                  Have more questions? Ask our community on{' '}
                  <a
                    href="https://t.me"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold underline hover:text-white"
                    style={{ color: activeColor.hex }}
                  >
                    Telegram
                  </a>{' '}
                  or{' '}
                  <a
                    href="https://x.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold underline hover:text-white"
                    style={{ color: activeColor.hex }}
                  >
                    X
                  </a>
                  .
                </p>
              </div>
            </motion.div>
          </div>

          {/* FAQ Accordion List (8 cols) */}
          <div className="lg:col-span-8 space-y-3.5">
            {FAQS.map((faq, idx) => {
              const isOpen = openIndex === idx;
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 15 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.35, delay: idx * 0.04 }}
                  className={`rounded-2xl lg-panel border transition-all duration-300 overflow-hidden ${isOpen
                      ? 'border-white/20 bg-zinc-900/60 shadow-lg'
                      : 'border-white/5 hover:border-white/15 bg-zinc-950/40'
                    }`}
                >
                  <button
                    onClick={() => toggle(idx)}
                    className="w-full p-5 sm:p-6 text-left flex items-start sm:items-center justify-between gap-4 group cursor-pointer"
                  >
                    <div className="flex-1 pr-2">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                          style={{
                            background: isOpen ? `${activeColor.hex}25` : 'rgba(255,255,255,0.05)',
                            color: isOpen ? activeColor.hex : '#71717a',
                          }}
                        >
                          {faq.category}
                        </span>
                      </div>
                      <span
                        className={`font-heading font-bold text-base sm:text-lg transition-colors leading-snug block ${isOpen ? 'text-white' : 'text-zinc-200 group-hover:text-white'
                          }`}
                      >
                        {faq.question}
                      </span>
                    </div>

                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 mt-1 sm:mt-0"
                      style={{
                        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                        background: isOpen ? `${activeColor.hex}20` : 'rgba(255,255,255,0.05)',
                        color: isOpen ? activeColor.hex : '#a1a1aa',
                      }}
                    >
                      <ChevronDown className="w-4 h-4" />
                    </div>
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: 'easeInOut' }}
                      >
                        <div className="px-5 pb-6 sm:px-6 sm:pb-6 text-sm text-zinc-300 leading-relaxed border-t border-white/5 pt-4">
                          {faq.answer}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export default WalletFAQ;
