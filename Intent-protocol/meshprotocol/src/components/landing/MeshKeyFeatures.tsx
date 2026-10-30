import React from 'react';
import { useMesh } from '@/context/MeshContext';
import { CornerCrosshair } from '@/components/common/MeshWireframeBox';
import { ShieldCheck, Clock, Users, Zap, Lock, FileText } from 'lucide-react';

export function MeshKeyFeatures() {
  const { language } = useMesh();
  const isZh = language === 'zh';

  const features = [
    {
      icon: ShieldCheck,
      title: isZh ? '去中心化链上验证' : 'Decentralized Verification',
      desc: isZh
        ? '纯 CashScript 契约约束，零中心化管理员权限与后门。'
        : 'Pure CashScript covenants enforce all spend conditions with zero admin keys.',
    },
    {
      icon: Clock,
      title: isZh ? '时效证明防抢跑' : 'Time-Limited Proof Codes',
      desc: isZh
        ? '每个撮合调用包含链上时效约束，彻底杜绝 MEV 抢跑套利。'
        : 'Fill transactions include timestamp nonces to mathematically prevent frontrunning.',
    },
    {
      icon: Users,
      title: isZh ? '基于角色的多槽位隔离' : 'Role-Based Access Control',
      desc: isZh
        ? '唯一输出绑定索引，多代币槽位独立结算，杜绝资金碰撞。'
        : 'Output index binding guarantees discrete token settlements from one shared reserve.',
    },
    {
      icon: Zap,
      title: isZh ? '秒级瞬时确认' : 'Real-Time Verification',
      desc: isZh
        ? '基于比特币现金高效结算机制，平均交易费低于 0.001 美元。'
        : 'Direct UTXO state transitions with sub-second propagation and sub-cent fees.',
    },
    {
      icon: Lock,
      title: isZh ? '安全抗重入保护' : 'Secure Authentication',
      desc: isZh
        ? '无 EVM 共享状态机，天然免疫重入攻击与蜜罐漏洞。'
        : 'UTXO isolation prevents reentrancy, shared-state exploits, and flash loan attacks.',
    },
    {
      icon: FileText,
      title: isZh ? '全量链上审计痕迹' : 'Complete Audit Trail',
      desc: isZh
        ? '所有做市状态与结算历史均完整记录在链上，支持任意节点审计。'
        : 'Deterministic transaction inputs and outputs provide a verifiable, public audit log.',
    },
  ];

  return (
    <section id="features" className="border-b border-[#c0c2c4] dark:border-neutral-800 px-4 sm:px-6 relative">
      <div className="border-x border-[#c0c2c4] dark:border-neutral-800 relative max-w-7xl mx-auto py-16 sm:py-24 px-6 sm:px-10 lg:px-12 text-center">
        <CornerCrosshair className="-left-3 -top-3" />
        <CornerCrosshair className="-right-3 -top-3" />
        <CornerCrosshair className="-left-3 -bottom-3" />
        <CornerCrosshair className="-right-3 -bottom-3" />

        {/* Section Heading */}
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 mb-3">
          {isZh ? '...以及如此多强大的核心特性！' : '...and so much Key Features!'}
        </h2>

        <p className="text-neutral-600 dark:text-neutral-400 text-sm sm:text-base max-w-xl mx-auto mb-14">
          {isZh
            ? '构建于比特币现金区块链之上，带来极致的安全性与资金效率。'
            : 'Built on Bitcoin Cash for maximum security, capital velocity, and transparency.'}
        </p>

        {/* 3x2 Grid with Crosshairs at every intersection */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-8 gap-x-8 max-w-5xl mx-auto">
          {features.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={idx}
                className="relative border border-[#c0c2c4] dark:border-neutral-800 bg-white dark:bg-[#121215] rounded-2xl p-7 text-center shadow-xs flex flex-col items-center justify-center transition-all hover:border-neutral-400 dark:hover:border-neutral-700"
              >
                {/* 4 Corner Crosshairs on each card to match reference! */}
                <CornerCrosshair className="-left-3 -top-3" />
                <CornerCrosshair className="-right-3 -top-3" />
                <CornerCrosshair className="-left-3 -bottom-3" />
                <CornerCrosshair className="-right-3 -bottom-3" />

                {/* Soft rounded icon box */}
                <div className="w-12 h-12 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-700 dark:text-neutral-300 mb-4">
                  <Icon className="w-5 h-5 stroke-[1.75]" />
                </div>

                <h3 className="font-semibold text-sm sm:text-base text-neutral-900 dark:text-neutral-100 mb-1.5">
                  {item.title}
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed max-w-[240px]">
                  {item.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
