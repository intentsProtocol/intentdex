import React, { useState } from 'react';
import { useMesh } from '@/context/MeshContext';
import { CornerCrosshair } from '@/components/common/MeshWireframeBox';
import { LayoutGrid, ArrowUpRight, CheckCircle2 } from 'lucide-react';

export function MeshStrategyTemplatesSection() {
  const { language, setActiveTab } = useMesh();
  const [activeCategory, setActiveCategory] = useState<'all' | 'conservative' | 'balanced' | 'aggressive'>('all');

  const isZh = language === 'zh';

  const templates = [
    {
      id: 'mirror-spread',
      title: isZh ? '永续镜像套利策略' : 'Perpetual Mirror Spread',
      category: 'conservative',
      apy: '18.4%',
      risk: isZh ? '低风险' : 'Low',
      tokens: 'BCH / pUSD',
      desc: isZh
        ? '单一买单成交后即刻同交易构建镜像卖单，捕捉 1.5% - 2.5% 点差收益。'
        : 'Instantiates mirror ask upon fill to capture 1.5% - 2.5% fixed bid-ask spread perpetually.',
      tags: ['MeshPoolV3', 'Perpetual', 'Zero Impermanent Loss'],
    },
    {
      id: 'tri-slot-basket',
      title: isZh ? '三代币篮子单池报价' : 'Tri-Slot Single Reserve Basket',
      category: 'balanced',
      apy: '32.1%',
      risk: isZh ? '中等风险' : 'Medium',
      tokens: 'BCH / FLEX / LAW / USDC',
      desc: isZh
        ? '单一储备通过 3 个槽位同时接受三种不同代币兑换，提升资金周转率 3 倍。'
        : 'One single BCH reserve simultaneously quotes 3 CashTokens via discrete output indices.',
      tags: ['MultiSlot', 'High Turnover', '3x Velocity'],
    },
    {
      id: 'volatility-grid',
      title: isZh ? '高频波动网格策略' : 'High-Frequency Volatility Grid',
      category: 'aggressive',
      apy: '54.8%',
      risk: isZh ? '高收益' : 'High Yield',
      tokens: 'BCH / CashTokens',
      desc: isZh
        ? '在 Chipnet/Mainnet 密集部署多阶价格契约，套利者密集触发以吃取波动率。'
        : 'Dense ladder of automated covenant orders swept by arbitrage bots for maximum compounding.',
      tags: ['Grid', 'Compounding', 'Arbitrage Friendly'],
    },
  ];

  const filtered = activeCategory === 'all'
    ? templates
    : templates.filter(t => t.category === activeCategory);

  return (
    <section id="strategies" className="border-b border-[#c0c2c4] dark:border-neutral-800 px-4 sm:px-6 relative">
      <div className="border-x border-[#c0c2c4] dark:border-neutral-800 relative max-w-7xl mx-auto py-16 sm:py-24 px-6 sm:px-10 lg:px-12 text-center">
        <CornerCrosshair className="-left-3 -top-3" />
        <CornerCrosshair className="-right-3 -top-3" />
        <CornerCrosshair className="-left-3 -bottom-3" />
        <CornerCrosshair className="-right-3 -bottom-3" />

        {/* Pill Tag */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-300 dark:border-neutral-700 bg-neutral-100/80 dark:bg-neutral-800/60 text-xs text-neutral-600 dark:text-neutral-400 font-medium mb-3">
          <LayoutGrid className="w-3.5 h-3.5" />
          <span>{isZh ? '预置做市模板' : 'Pre-Built LP Templates'}</span>
        </div>

        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 mb-3 max-w-3xl mx-auto">
          {isZh ? '为各种收益需求量身定制的策略' : 'Covenant Strategies Built for Every Profile'}
        </h2>
        <p className="text-neutral-600 dark:text-neutral-400 text-sm sm:text-base max-w-2xl mx-auto mb-10">
          {isZh
            ? '选择经过形式化验证的 CashScript 契约模板，一键部署自主运行的链上做市资金池。'
            : 'Select formally audited CashScript templates to deploy autonomous on-chain liquidity vaults.'}
        </p>

        {/* Filter Pills */}
        <div className="flex items-center justify-center gap-2 mb-10">
          {(['all', 'conservative', 'balanced', 'aggressive'] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeCategory === cat
                  ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-xs'
                  : 'bg-neutral-100 dark:bg-neutral-800/70 text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white'
              }`}
            >
              {cat === 'all' && (isZh ? '全部策略' : 'All Strategies')}
              {cat === 'conservative' && (isZh ? '低风险稳健' : 'Conservative')}
              {cat === 'balanced' && (isZh ? '均衡多槽位' : 'Balanced')}
              {cat === 'aggressive' && (isZh ? '高频进取型' : 'Aggressive')}
            </button>
          ))}
        </div>

        {/* Template Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          {filtered.map((tpl) => (
            <div
              key={tpl.id}
              className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#121215] p-6 shadow-xs flex flex-col justify-between hover:border-neutral-300 dark:hover:border-neutral-700 transition-all"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700">
                    {tpl.tokens}
                  </span>
                  <div className="text-right">
                    <span className="font-mono font-bold text-base text-emerald-600 dark:text-emerald-400">{tpl.apy}</span>
                    <span className="text-[10px] text-neutral-400 block">Est. APY</span>
                  </div>
                </div>

                <h3 className="font-semibold text-base text-neutral-900 dark:text-neutral-100 mb-2">
                  {tpl.title}
                </h3>
                <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed mb-4">
                  {tpl.desc}
                </p>

                <div className="flex flex-wrap gap-1.5 mb-6">
                  {tpl.tags.map((tag, i) => (
                    <span key={i} className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <button
                onClick={() => { setActiveTab('app'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="w-full py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white font-medium text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
              >
                <span>{isZh ? '部署该策略' : 'Deploy Template'}</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
