import React, { useState } from 'react';
import { useMesh } from '@/context/MeshContext';
import { useMeshApp, type AppSubTab } from '@/context/MeshAppContext';
import { MeshLogo } from './MeshLogo';
import { TactileButton } from '@/components/ui/TactileButton';
import {
  Sun,
  Moon,
  Menu,
  X,
  ArrowUpRight,
  Wallet,
  Layers,
  Sliders,
  Sparkles,
  PieChart,
  Radio,
  FileCode2,
  BookOpen,
  ChevronRight,
  CheckCircle2,
  Copy,
  ExternalLink,
} from 'lucide-react';

export function MeshHeader() {
  const { theme, toggleTheme, language, setLanguage, activeTab, setActiveTab, t } = useMesh();
  const {
    subTab,
    setSubTab,
    isDemoMode,
    toggleDemoMode,
    walletConnected,
    walletAddress,
    bchBalance,
    connectWallet,
    positions,
  } = useMeshApp();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const isZh = language === 'zh';
  const isAppMode = activeTab === 'app';

  // Landing Page smooth navigation anchors
  const LANDING_LINKS = [
    { id: 'features', label: isZh ? '核心特性' : 'Features', targetId: 'features' },
    { id: 'recycling', label: isZh ? '再循环引擎' : 'Recycling', targetId: 'recycling' },
    { id: 'strategies', label: isZh ? '策略模版' : 'Strategies', targetId: 'strategies' },
    { id: 'tri-route', label: isZh ? '三路路由' : 'Tri-Route', targetId: 'tri-route' },
    { id: 'simulator', label: isZh ? '收益模拟' : 'Simulator', targetId: 'simulator' },
    { id: 'architecture', label: isZh ? '技术架构' : 'Architecture', targetId: 'architecture' },
    { id: 'covenants', label: isZh ? '契约验证' : 'Covenants', targetId: 'covenants' },
    { id: 'faq', label: isZh ? '常见问题' : 'FAQ', targetId: 'faq' },
    { id: 'docs', label: isZh ? '开发者文档' : 'Docs', isTab: true, tabName: 'docs' as const },
  ];

  // App Terminal Tabs
  const APP_TABS: Array<{ id: AppSubTab; label: string; labelZh: string; icon: any; count?: number; pulse?: boolean }> = [
    { id: 'pools', label: 'Pools', labelZh: '流动性池', icon: Layers },
    { id: 'liquidity', label: 'DLMM Terminal', labelZh: '做市终端', icon: Sliders },
    { id: 'strategies', label: 'Strategy Studio', labelZh: '策略工坊', icon: Sparkles },
    { id: 'portfolio', label: 'Portfolio', labelZh: '我的持仓', icon: PieChart, count: positions.length },
    { id: 'intents', label: 'Nostr Swarm', labelZh: '意图流动', icon: Radio, pulse: true },
    { id: 'inspector', label: 'Covenants', labelZh: '契约审计', icon: FileCode2 },
  ];

  const handleLandingClick = (link: (typeof LANDING_LINKS)[0]) => {
    if (link.isTab && link.tabName) {
      setActiveTab(link.tabName);
    } else if (link.targetId) {
      if (activeTab !== 'landing') {
        setActiveTab('landing');
        setTimeout(() => {
          document.getElementById(link.targetId)?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      } else {
        document.getElementById(link.targetId)?.scrollIntoView({ behavior: 'smooth' });
      }
    }
    setMobileMenuOpen(false);
  };

  const copyAddress = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#cbd5e1] dark:border-[#262e42] bg-[#ffffff]/95 dark:bg-[#0d0f15]/95 backdrop-blur-md transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Brand Logo & Mode Badge */}
        <div className="flex items-center gap-3 shrink-0">
          <div
            onClick={() => setActiveTab('landing')}
            className="flex items-center gap-2.5 cursor-pointer group select-none"
          >
            <MeshLogo size={36} showText={true} />
          </div>

          {/* Mode Pill Indicator */}
          <div className="hidden md:flex items-center gap-1.5 pl-2 border-l border-slate-300 dark:border-slate-800">
            {isAppMode ? (
              <button
                onClick={() => setActiveTab('landing')}
                className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-mono text-[10px] font-bold hover:bg-emerald-500/20 transition-all flex items-center gap-1 cursor-pointer"
                title="Click to view landing overview"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>TERMINAL ACTIVE</span>
              </button>
            ) : (
              <span className="px-2 py-0.5 rounded-md bg-slate-200/60 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-mono text-[10px] font-semibold">
                OVERVIEW
              </span>
            )}
          </div>
        </div>

        {/* Center Navigation Bar */}
        {isAppMode ? (
          /* App Navigation Tabs */
          <nav className="hidden lg:flex items-center gap-1 bg-slate-100 dark:bg-[#131722] p-1 rounded-2xl border border-slate-300 dark:border-[#262e42]">
            {APP_TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = subTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setSubTab(tab.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer relative ${
                    isActive
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-[#1e2538]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{isZh ? tab.labelZh : tab.label}</span>
                  {tab.pulse && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  )}
                  {tab.count !== undefined && tab.count > 0 && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[9px] font-mono font-bold ${
                        isActive
                          ? 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        ) : (
          /* Landing Navigation Links */
          <nav className="hidden lg:flex items-center gap-1 text-xs font-semibold">
            {LANDING_LINKS.map(link => (
              <button
                key={link.id}
                onClick={() => handleLandingClick(link)}
                className="px-2.5 py-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
              >
                {link.label}
              </button>
            ))}
          </nav>
        )}

        {/* Right Controls Tray */}
        <div className="hidden sm:flex items-center gap-2">
          {/* Chipnet Status / Simulation Toggle in App Mode */}
          {isAppMode && (
            <button
              onClick={toggleDemoMode}
              className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-mono font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                isDemoMode
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300'
                  : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400'
              }`}
              title="Click to toggle client-side simulation vs live chipnet"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isDemoMode ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`} />
              <span>{isDemoMode ? 'SIMULATION' : 'CHIPNET'}</span>
            </button>
          )}

          {/* Language Switch */}
          <div className="flex items-center rounded-xl bg-slate-200/60 dark:bg-[#131722] p-0.5 border border-slate-300 dark:border-[#262e42] text-[11px] font-mono">
            <button
              onClick={() => setLanguage('en')}
              className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                language === 'en'
                  ? 'bg-white dark:bg-[#1c2233] text-slate-900 dark:text-white font-bold shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              EN
            </button>
            <button
              onClick={() => setLanguage('zh')}
              className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                language === 'zh'
                  ? 'bg-white dark:bg-[#1c2233] text-slate-900 dark:text-white font-bold shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              中文
            </button>
          </div>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-xl border border-slate-300 dark:border-[#262e42] bg-white dark:bg-[#131722] text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-600 transition-all cursor-pointer shadow-xs"
            title={theme === 'dark' ? t.nav.modeLight : t.nav.modeDark}
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-700" />}
          </button>

          {/* Primary Action Button */}
          {isAppMode ? (
            walletConnected ? (
              <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-[#131722] border border-slate-300 dark:border-[#262e42] p-1 rounded-xl">
                <span className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-mono text-xs font-bold">
                  {bchBalance.toFixed(2)} BCH
                </span>
                <button
                  onClick={copyAddress}
                  className="px-2 py-1 rounded-lg text-xs font-mono font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#1c2233] flex items-center gap-1 cursor-pointer"
                  title="Click to copy CashAddress"
                >
                  <span>{walletAddress?.slice(0, 6)}...{walletAddress?.slice(-3)}</span>
                  {copied ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 opacity-60" />}
                </button>
              </div>
            ) : (
              <TactileButton
                variant="primary"
                size="sm"
                onClick={() => connectWallet()}
                icon={<Wallet className="w-3.5 h-3.5" />}
              >
                Connect Wallet
              </TactileButton>
            )
          ) : (
            <TactileButton
              variant="primary"
              size="sm"
              onClick={() => { setActiveTab('app'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              icon={<ArrowUpRight className="w-3.5 h-3.5" />}
            >
              Launch App
            </TactileButton>
          )}
        </div>

        {/* Mobile Hamburger */}
        <div className="flex lg:hidden items-center gap-2">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
          </button>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-b border-slate-300 dark:border-[#262e42] bg-white dark:bg-[#0d0f15] p-4 space-y-3">
          {isAppMode ? (
            <div className="space-y-1">
              <div className="text-[10px] font-mono text-slate-500 uppercase px-2 mb-1">Terminal Navigation</div>
              {APP_TABS.map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => { setSubTab(tab.id); setMobileMenuOpen(false); }}
                    className={`w-full text-left p-2.5 rounded-xl text-xs font-semibold flex items-center justify-between ${
                      subTab === tab.id
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4" />
                      <span>{isZh ? tab.labelZh : tab.label}</span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-1">
              {LANDING_LINKS.map(link => (
                <button
                  key={link.id}
                  onClick={() => handleLandingClick(link)}
                  className="w-full text-left p-2.5 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {link.label}
                </button>
              ))}
            </div>
          )}

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2">
            <button
              onClick={() => { setActiveTab(isAppMode ? 'landing' : 'app'); setMobileMenuOpen(false); }}
              className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-bold text-center"
            >
              {isAppMode ? 'Back to Overview' : 'Launch Terminal'}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
