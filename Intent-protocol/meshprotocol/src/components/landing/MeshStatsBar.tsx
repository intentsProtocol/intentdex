import React from 'react';
import { useMesh } from '@/context/MeshContext';
import { CornerCrosshair } from '@/components/common/MeshWireframeBox';
import { Building2, Users2, FileCheck, Layers, ShieldCheck, Zap } from 'lucide-react';

export function MeshStatsBar() {
  const { language } = useMesh();
  const isZh = language === 'zh';

  const cards = [
    {
      icon: Building2,
      title: isZh ? '契约池部署与登记' : 'Covenant Pool Deployment',
      desc: isZh
        ? '流动性提供者基于 CashScript 契约初始化资金池，确定数学定价与输出规则。'
        : 'Liquidity providers deploy CashScript covenants with immutable pricing and settlement rules.',
    },
    {
      icon: Users2,
      title: isZh ? '多槽位与流动性管理' : 'Multi-Slot Liquidity Management',
      desc: isZh
        ? '单笔 UTXO 储备支持最多 3 种代币同时报价，套利者零竞态撮合多资产。'
        : 'Single UTXO reserve quotes up to 3 tokens concurrently with collision-free slot outputs.',
    },
    {
      icon: FileCheck,
      title: isZh ? '永续自循环回收' : 'Perpetual UTXO Recycling',
      desc: isZh
        ? '单笔成交交易内立即按设定点差反向生成镜像池，资金 24/7 永续运转。'
        : 'Swaps generate counter-mirror pools in the very same transaction loop for 24/7 autonomous recycling.',
    },
  ];

  return (
    <section className="border-b border-[#c0c2c4] dark:border-neutral-800 px-4 sm:px-6 relative">
      <div className="border-x border-[#c0c2c4] dark:border-neutral-800 relative max-w-7xl mx-auto py-16 sm:py-20 px-6 sm:px-10 lg:px-12 text-center">
        <CornerCrosshair className="-left-3 -top-3" />
        <CornerCrosshair className="-right-3 -top-3" />
        <CornerCrosshair className="-left-3 -bottom-3" />
        <CornerCrosshair className="-right-3 -bottom-3" />

        {/* Section Pill Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-neutral-300 dark:border-neutral-700 bg-neutral-100/80 dark:bg-neutral-800/60 text-xs text-neutral-600 dark:text-neutral-400 font-medium mb-4">
          <span>{isZh ? '工作原理 🔍' : 'How it works 🔍'}</span>
        </div>

        {/* Section Title */}
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 mb-3 max-w-3xl mx-auto">
          {isZh ? '精炼高效的 UTXO 与契约流动性路由' : 'Streamlined UTXO and covenant liquidity routing'}
        </h2>

        {/* Subtitle */}
        <p className="text-neutral-600 dark:text-neutral-400 text-sm sm:text-base max-w-2xl mx-auto mb-12">
          {isZh
            ? '从部署链上契约到管理多资产储备和实时回收交易 Gas —— 我们的协议让每个环节都极简、透明且安全。'
            : 'From deploying covenant pools to managing multi-token reserves and recycling UTXO gas in real time — our protocol makes every step seamless and secure.'}
        </p>

        {/* 3 Streamlined Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          {cards.map((card, i) => {
            const Icon = card.icon;
            return (
              <div
                key={i}
                className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#121215] p-6 shadow-sm hover:border-neutral-300 dark:hover:border-neutral-700 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="w-11 h-11 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-800 dark:text-neutral-200 mb-5">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-semibold text-base text-neutral-900 dark:text-neutral-100 mb-2">
                    {card.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                    {card.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
