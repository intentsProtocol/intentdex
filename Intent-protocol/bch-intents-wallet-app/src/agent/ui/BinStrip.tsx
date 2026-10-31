/**
 * A Mesh position at a glance: one bar per bin along the price grid. Buying bins (BCH) are green, selling bins
 * (tokens) amber, and a marker stands at today's price. Bar heights follow the shape the plan uses, so
 * "buy more as it dips" visibly grows towards the low end.
 */
import React from 'react';
import { View } from 'react-native';
import type { MeshDraft } from '@bch-intents/wallet-core/agent';
import { useT } from '@/i18n';
import { Txt } from '@/ui/primitives';
import { space, useTheme } from '@/ui/theme';

/** Relative weight of a bin `k` steps from the market (1 = next to it) on a side of `n` bins. */
function weight(shape: MeshDraft['shape'], k: number, n: number): number {
  if (shape === 'spot' || n <= 1) return 1;
  const x = (k - 1) / Math.max(1, n - 1);   // 0 near the market … 1 at the far end
  return shape === 'curve' ? 1 - 0.7 * x : 0.3 + 0.7 * x;
}

export function BinStrip({ draft }: { draft: MeshDraft }) {
  const t = useT();
  const { c } = useTheme();
  const bars: { buy: boolean; h: number }[] = [];
  for (let level = draft.lowIndex; level <= draft.highIndex; level++) {
    const buy = level <= draft.marketIndex;
    const k = buy ? draft.marketIndex - level + 1 : level - draft.marketIndex;
    bars.push({ buy, h: weight(draft.shape, k, buy ? draft.buyBins : draft.sellBins) });
  }
  const marketAt = draft.buyBins;   // the marker sits after the last buying bin
  return (
    <View accessibilityLabel={t('agent.card.binsSplit', { buy: draft.buyBins, sell: draft.sellBins })}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 56, gap: 3 }}>
        {bars.map((b, i) => (
          <React.Fragment key={i}>
            {i === marketAt && draft.buyBins > 0 && draft.sellBins > 0 ? <View style={{ width: 2, height: 56, backgroundColor: c.fg, borderRadius: 1, opacity: 0.6 }} /> : null}
            <View style={{ flex: 1, height: Math.max(6, b.h * 52), borderRadius: 3, backgroundColor: b.buy ? c.primary : c.amber, opacity: 0.85 }} />
          </React.Fragment>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs }}>
        <Txt variant="micro" tone={draft.buyBins ? 'primary' : 'faint'}>{draft.buyBins ? t('agent.card.buySide') : ' '}</Txt>
        <Txt variant="micro" tone="mute">{t('agent.card.marketMark')}</Txt>
        <Txt variant="micro" tone={draft.sellBins ? 'amber' : 'faint'}>{draft.sellBins ? t('agent.card.sellSide') : ' '}</Txt>
      </View>
    </View>
  );
}
