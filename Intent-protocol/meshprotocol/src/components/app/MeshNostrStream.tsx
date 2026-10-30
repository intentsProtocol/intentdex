import React, { useState, useEffect } from 'react';
import { Radio, ShieldCheck, Zap, ArrowRight, ExternalLink, Activity } from 'lucide-react';
import { TacticalBadge } from '@/components/ui/TacticalBadge';
import { MetricCard } from '@/components/ui/MetricCard';

interface NostrIntent {
  id: string;
  sender: string;
  type: 'LIMIT_SWAP' | 'ARBITRAGE_FILL' | 'RECYCLE_MIRROR';
  give: string;
  want: string;
  rate: string;
  solver: string;
  status: 'BROADCASTING' | 'MATCHED' | 'SETTLED';
  timestamp: string;
}

export function MeshNostrStream() {
  const [intents, setIntents] = useState<NostrIntent[]>([
    {
      id: 'nip90-intent-98a2',
      sender: 'npub1x88fa...92a1',
      type: 'LIMIT_SWAP',
      give: '1.25 BCH',
      want: '446.50 pUSD',
      rate: '357.20 pUSD/BCH',
      solver: 'solver-omega-01',
      status: 'SETTLED',
      timestamp: '2s ago',
    },
    {
      id: 'nip90-intent-44c1',
      sender: 'npub1k39pl...11f8',
      type: 'RECYCLE_MIRROR',
      give: '358.10 pUSD',
      want: '1.00 BCH',
      rate: '358.10 pUSD/BCH',
      solver: 'covenant-self-recycle',
      status: 'SETTLED',
      timestamp: '6s ago',
    },
    {
      id: 'nip90-intent-77e4',
      sender: 'npub1qq00z...55d2',
      type: 'ARBITRAGE_FILL',
      give: '0.85 BCH',
      want: '1,054 MESH',
      rate: '1,240 MESH/BCH',
      solver: 'solver-alpha-09',
      status: 'MATCHED',
      timestamp: '11s ago',
    },
  ]);

  // Simulate incoming gossip intents
  useEffect(() => {
    const interval = setInterval(() => {
      const newIntent: NostrIntent = {
        id: 'nip90-intent-' + Math.random().toString(36).substring(2, 6),
        sender: 'npub1' + Math.random().toString(36).substring(2, 8),
        type: Math.random() > 0.5 ? 'LIMIT_SWAP' : 'RECYCLE_MIRROR',
        give: (Math.random() * 2 + 0.5).toFixed(2) + ' BCH',
        want: (Math.random() * 700 + 150).toFixed(2) + ' pUSD',
        rate: '357.40 pUSD/BCH',
        solver: 'solver-batch-bot',
        status: 'SETTLED',
        timestamp: 'Just now',
      };
      setIntents(prev => [newIntent, ...prev.slice(0, 11)]);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      {/* Telemetry Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <MetricCard
          label="NIP-90 Relay Status"
          value="Connected"
          subValue="relay.meshprotocol.org"
          delta={{ value: "38ms Latency", isPositive: true }}
        />
        <MetricCard
          label="Intent Gossip Rate"
          value="18 / sec"
          subValue="High mempool throughput"
          delta={{ value: "Active Swarm", isPositive: true }}
        />
        <MetricCard
          label="Competing Solvers"
          value="8 Online"
          subValue="MEV-protected Dutch auctions"
        />
        <MetricCard
          label="Settled Covenant Fills"
          value="1,492 Today"
          subValue="100% On-Chain Bitcoin Cash"
          delta={{ value: "99.8% Success", isPositive: true }}
        />
      </div>

      {/* Live Intent Feed Table */}
      <div className="rounded-2xl border border-slate-300 dark:border-[#262e42] overflow-hidden bg-white dark:bg-[#131722] shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-[#262e42] flex items-center justify-between bg-slate-50 dark:bg-[#11141e]">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-500 animate-pulse" />
            <span className="font-mono text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Decentralized Intent Mempool Stream
            </span>
          </div>
          <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-semibold">
            <Activity className="w-3.5 h-3.5" /> P2P Relay Live
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-[#262e42] font-mono text-[10px] text-slate-500 uppercase tracking-wider bg-slate-50 dark:bg-[#11141e]">
                <th className="py-3 px-4">Intent Hash</th>
                <th className="py-3 px-4">Archetype</th>
                <th className="py-3 px-4">Give Asset</th>
                <th className="py-3 px-4">Want Asset</th>
                <th className="py-3 px-4">Execution Rate</th>
                <th className="py-3 px-4">Solver Routing</th>
                <th className="py-3 px-4 text-right">Settlement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-[#262e42] font-mono">
              {intents.map(intent => (
                <tr key={intent.id} className="hover:bg-slate-50 dark:hover:bg-[#1a2030]/60 transition-colors">
                  <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{intent.id}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                      {intent.type}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-700 dark:text-slate-300 font-semibold">{intent.give}</td>
                  <td className="py-3 px-4 text-slate-700 dark:text-slate-300 font-semibold">{intent.want}</td>
                  <td className="py-3 px-4 text-slate-900 dark:text-white font-bold">{intent.rate}</td>
                  <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{intent.solver}</td>
                  <td className="py-3 px-4 text-right">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                      {intent.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
