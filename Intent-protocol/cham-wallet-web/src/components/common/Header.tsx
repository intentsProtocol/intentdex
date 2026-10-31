import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useChamTheme } from '@/context/ChamThemeContext';
import { ExternalLink, Download, Sparkles, Check, Menu, X } from 'lucide-react';
import { ChamLogo } from './ChamLogo';

interface HeaderProps {
  onOpenDownload: () => void;
}

export function Header({ onOpenDownload }: HeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { activeColor, setColor, colors } = useChamTheme();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
        scrolled ? 'py-3' : 'py-5'
      )}
    >
      <div className="container mx-auto px-4 max-w-7xl">
        <div
          className={cn(
            'flex items-center justify-between px-4 sm:px-6 py-2.5 rounded-2xl transition-all duration-300',
            scrolled ? 'lg-panel shadow-2xl shadow-black/80' : 'bg-[#0a0a0e]/40 backdrop-blur-md border border-white/5'
          )}
        >
          {/* Brand */}
          <a href="#" className="flex items-center gap-3 group">
            {/* Unboxed Brand Spiral Logo - adapts dynamically to active color */}
            <ChamLogo size={46} glow={true} className="transition-transform group-hover:scale-105" />
            <div className="flex items-center gap-2">
              <span className="font-heading font-bold text-lg text-white tracking-tight">Cham Wallet</span>
              <span
                className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full font-bold transition-colors duration-300"
                style={{
                  background: `${activeColor.hex}20`,
                  color: activeColor.hex,
                  border: `1px solid ${activeColor.hex}40`,
                }}
              >
                ALPHA
              </span>
            </div>
          </a>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-400">
            <a href="#overview" className="hover:text-white transition-colors">Overview</a>
            <a href="#local-ai" className="hover:text-white transition-colors flex items-center gap-1.5 text-emerald-400 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Local AI</span>
            </a>
            <a
              href="/pitch"
              onClick={(e) => {
                e.preventDefault();
                window.history.pushState({}, '', '/pitch');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="hover:text-white transition-colors flex items-center gap-1.5 text-amber-400 font-semibold px-2 py-0.5 rounded-lg bg-amber-400/10 border border-amber-400/20 shadow-sm shadow-amber-400/10"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Pitch Deck</span>
            </a>
            <a href="#chains" className="hover:text-white transition-colors">Chains</a>
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#security" className="hover:text-white transition-colors">Security</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          </nav>

          {/* Right actions: Cham Tone Picker & CTAs */}
          <div className="hidden lg:flex items-center gap-4">
            {/* Tone Switcher Dots */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/5 border border-white/10">
              <Sparkles className="w-3.5 h-3.5 text-zinc-400 mr-1" />
              {colors.map((c) => {
                const selected = activeColor.id === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setColor(c)}
                    title={c.name}
                    aria-label={`Select ${c.name} theme`}
                    className={cn(
                      'w-4 h-4 rounded-full transition-transform duration-150 flex items-center justify-center',
                      selected ? 'scale-125 ring-2 ring-white/50' : 'hover:scale-110 opacity-70 hover:opacity-100'
                    )}
                    style={{ background: c.hex }}
                  >
                    {selected && <Check className="w-2.5 h-2.5 text-black stroke-[3]" />}
                  </button>
                );
              })}
            </div>

            {/* Launch Web Wallet */}
            <a
              href="https://champrotocol.vercel.app/"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-zinc-300 hover:text-white transition-colors flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-white/5"
            >
              <span>Launch App</span>
              <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
            </a>

            {/* Download CTA */}
            <button
              onClick={onOpenDownload}
              className="text-xs font-bold px-4 py-2 rounded-xl transition-all duration-300 flex items-center gap-2 shadow-lg"
              style={{
                background: activeColor.hex,
                color: '#050505',
                boxShadow: `0 4px 15px ${activeColor.hex}40`,
              }}
            >
              <Download className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Get Cham</span>
            </button>
          </div>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-2 lg:hidden">
            <button
              onClick={onOpenDownload}
              className="text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5"
              style={{ background: activeColor.hex, color: '#050505' }}
            >
              <Download className="w-3 h-3 stroke-[2.5]" />
              <span>Get</span>
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden mt-2 p-4 rounded-2xl lg-panel border border-white/10 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex flex-col gap-3 text-sm font-medium text-zinc-300">
              <a href="#overview" onClick={() => setMobileMenuOpen(false)} className="hover:text-white">Overview</a>
              <a href="#local-ai" onClick={() => setMobileMenuOpen(false)} className="text-emerald-400 font-semibold hover:text-white flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>Local AI (Flight Mode)</span>
              </a>
              <a
                href="/pitch"
                onClick={(e) => {
                  e.preventDefault();
                  setMobileMenuOpen(false);
                  window.history.pushState({}, '', '/pitch');
                  window.dispatchEvent(new PopStateEvent('popstate'));
                }}
                className="text-amber-400 font-semibold hover:text-white flex items-center gap-1.5"
              >
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Pitch Deck (Presentation View)</span>
              </a>
              <a href="#chains" onClick={() => setMobileMenuOpen(false)} className="hover:text-white">Supported Chains</a>
              <a href="#features" onClick={() => setMobileMenuOpen(false)} className="hover:text-white">Features</a>
              <a href="#security" onClick={() => setMobileMenuOpen(false)} className="hover:text-white">Security & Cryptography</a>
              <a href="#faq" onClick={() => setMobileMenuOpen(false)} className="hover:text-white">FAQ</a>
            </div>

            <div className="pt-3 border-t border-white/10 flex items-center justify-between">
              <span className="text-xs text-zinc-400 font-medium">Theme Color:</span>
              <div className="flex items-center gap-1.5">
                {colors.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setColor(c)}
                    className={cn(
                      'w-5 h-5 rounded-full transition-transform',
                      activeColor.id === c.id ? 'scale-125 ring-2 ring-white' : 'opacity-70'
                    )}
                    style={{ background: c.hex }}
                  />
                ))}
              </div>
            </div>

            <a
              href="https://champrotocol.vercel.app/"
              target="_blank"
              rel="noreferrer"
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/10 text-white text-xs font-semibold"
            >
              <span>Launch Web Wallet</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </div>
    </header>
  );
}
