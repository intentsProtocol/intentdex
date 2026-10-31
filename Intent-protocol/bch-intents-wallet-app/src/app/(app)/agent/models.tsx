/**
 * On-phone models: the one in use (where it runs, how fast), and every model to download, use or delete.
 */
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Cpu } from 'lucide-react-native';
import { formatSig } from '@bch-intents/wallet-core/format';
import { entryOf, phoneRamGb, useModel } from '@/agent/qvac';
import { ModelList } from '@/agent/ui/Models';
import { useT } from '@/i18n';
import { Button, Card, Header, Line, Screen, Segmented, Txt } from '@/ui/primitives';
import { space, useTheme } from '@/ui/theme';

export default function ModelsScreen() {
  const t = useT();
  const { c } = useTheme();
  const router = useRouter();
  const { activeId, load, loadError, device, tokensPerSecond, devicePref } = useModel();
  useEffect(() => { const m = useModel.getState(); (m.inited ? m.refresh() : m.init()).catch(() => {}); }, []);
  const active = activeId ? entryOf(activeId) : null;
  return (
    <Screen scroll>
      <Header title={t('agent.models.title')} onBack={() => router.back()} backLabel={t('common.back')} />
      <View style={{ gap: space.lg, paddingBottom: space.xl }}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primaryDim }}><Cpu size={20} color={c.primary} /></View>
            <View style={{ flex: 1 }}>
              <Txt variant="label">{active ? active.name : t('agent.models.none')}</Txt>
              <Txt variant="small" tone="mute">{t('agent.model.local')}</Txt>
            </View>
          </View>
          {active ? (
            <View style={{ marginTop: space.sm }}>
              <Line label={t('agent.model.state')} value={t(`agent.models.load.${load}` as never)} tone={load === 'error' ? 'warn' : undefined} />
              <Line label={t('agent.model.runsOn')} value={device ? device.toUpperCase() : '—'} />
              <Line label={t('agent.model.speed')} value={tokensPerSecond ? t('agent.model.tps', { tps: formatSig(tokensPerSecond, 3) }) : '—'} />
              <Line label={t('agent.models.phoneRam')} value={phoneRamGb() ? `${phoneRamGb().toFixed(1)} GB` : '—'} />
              {load === 'error' ? <Txt variant="small" tone="red">{loadError}</Txt> : null}
              <View style={{ marginTop: space.sm, gap: 6 }}>
                <Segmented<'cpu' | 'gpu'>
                  label={t('agent.models.device')} value={devicePref}
                  options={[{ value: 'cpu', label: 'CPU' }, { value: 'gpu', label: 'GPU' }]}
                  onChange={d => { useModel.getState().setDevice(d).catch(() => {}); }}
                />
                <Txt variant="micro" tone="faint">{t('agent.models.deviceHint2')}</Txt>
              </View>
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                {load !== 'ready' ? <Button small style={{ flex: 1 }} label={t('agent.models.loadNow')} loading={load === 'loading'} onPress={() => { useModel.getState().ensureLoaded().catch(() => {}); }} /> : null}
                {load === 'ready' ? <Button small kind="secondary" style={{ flex: 1 }} label={t('agent.model.unload')} onPress={() => { useModel.getState().unload().catch(() => {}); }} /> : null}
              </View>
            </View>
          ) : <Txt variant="small" tone="mute" style={{ marginTop: space.sm }}>{t('agent.models.noneBody')}</Txt>}
        </Card>
        <ModelList />
      </View>
    </Screen>
  );
}
