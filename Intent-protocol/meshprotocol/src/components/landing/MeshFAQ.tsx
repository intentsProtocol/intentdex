import React, { useState } from 'react';
import { useMesh } from '@/context/MeshContext';
import { CornerCrosshair } from '@/components/common/MeshWireframeBox';
import { HelpCircle, ChevronDown } from 'lucide-react';

export function MeshFAQ() {
  const { language } = useMesh();
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const isZh = language === 'zh';

  const faqs = [
    {
      q: isZh ? 'Mesh Protocol 与传统 AMM (如 Uniswap) 有何区别？' : 'How does Mesh Protocol differ from traditional AMMs like Uniswap?',
      a: isZh
        ? 'Mesh Protocol 完全基于比特币现金原生 UTXO 契约，无需共享全局资金池，没有重入漏洞和三明治套利风险。流动性以独立契约 UTXO 存在，并支持单笔交易内自动镜像回收。'
        : 'Mesh Protocol is 100% native to Bitcoin Cash UTXOs. There is no pooled EVM global state, zero reentrancy risk, and zero sandwich attacks. Each LP UTXO operates deterministically with instant perpetual recycling.',
    },
    {
      q: isZh ? '什么是“永续自循环回收” (Perpetual Recycling)？' : 'What is Perpetual Recycling?',
      a: isZh
        ? '当买单被撮合成交后，收到的资产（如 pUSD）不会闲置或提取至中心化账户，而是由契约强制在同一笔交易内实例化为反向镜像卖单，捕捉双向点差收益，实现 24/7 永续运转。'
        : 'When an order fills, proceeds do not sit idle. The covenant code mandates an on-chain mirror order in the same transaction loop, earning spreads on both sides automatically.',
    },
    {
      q: isZh ? '单笔储备支持多槽位（Multi-Slot）意味着什么？' : 'What is Multi-Slot routing from a single reserve?',
      a: isZh
        ? '传统订单簿需要为每个币对锁定独立的 BCH 储备。MeshPoolV3 的多槽位特性允许 1 笔 BCH 储备同时向 3 种不同的 CashTokens 报价，通过独立的输出索引隔离结算，无资金竞态冲突。'
        : 'Instead of fragmenting capital into separate pools, 1 BCH reserve can quote up to 3 different CashTokens simultaneously, drastically increasing capital efficiency.',
    },
    {
      q: isZh ? '协议的代码是否经过审计与开源？' : 'Is the protocol code open source and audited?',
      a: isZh
        ? '所有核心 CashScript 契约与 SDK 均在 GitHub 完全开源，遵循 Apache-2.0 许可。契约逻辑通过 CashScript 形式化数学验证，确保不可篡改。'
        : 'All core CashScript covenants and frontend SDKs are fully open source on GitHub under Apache-2.0. Formal verification tooling is used to validate all spend conditions.',
    },
  ];

  return (
    <section id="faq" className="border-b border-[#c0c2c4] dark:border-neutral-800 px-4 sm:px-6 relative">
      <div className="border-x border-[#c0c2c4] dark:border-neutral-800 relative max-w-7xl mx-auto py-16 sm:py-24 px-6 sm:px-10 lg:px-12 text-center">
        <CornerCrosshair className="-left-3 -top-3" />
        <CornerCrosshair className="-right-3 -top-3" />
        <CornerCrosshair className="-left-3 -bottom-3" />
        <CornerCrosshair className="-right-3 -bottom-3" />

        {/* Pill Tag */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-300 dark:border-neutral-700 bg-neutral-100/80 dark:bg-neutral-800/60 text-xs text-neutral-600 dark:text-neutral-400 font-medium mb-3">
          <HelpCircle className="w-3.5 h-3.5" />
          <span>{isZh ? '常见问题解答' : 'Frequently Asked Questions'}</span>
        </div>

        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 mb-3 max-w-3xl mx-auto">
          {isZh ? '关于 Mesh Protocol 的一切细节' : 'Everything You Need to Know'}
        </h2>
        <p className="text-neutral-600 dark:text-neutral-400 text-sm sm:text-base max-w-xl mx-auto mb-12">
          {isZh
            ? '了解基于比特币现金的下一代自主流动性契约的工作原理。'
            : 'Answers to key technical questions regarding UTXO covenant liquidity.'}
        </p>

        {/* Accordion list */}
        <div className="max-w-3xl mx-auto space-y-3 text-left">
          {faqs.map((item, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div
                key={idx}
                className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#121215] shadow-xs overflow-hidden transition-all"
              >
                <button
                  onClick={() => setOpenIndex(isOpen ? null : idx)}
                  className="w-full p-5 flex items-center justify-between gap-4 text-left font-medium text-sm sm:text-base text-neutral-900 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 cursor-pointer"
                >
                  <span>{item.q}</span>
                  <ChevronDown className={`w-4 h-4 text-neutral-500 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 pt-1 text-xs sm:text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed border-t border-neutral-100 dark:border-neutral-800">
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
