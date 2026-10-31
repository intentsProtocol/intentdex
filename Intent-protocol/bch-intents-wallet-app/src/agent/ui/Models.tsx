/**
 * Choosing, downloading and managing the on-phone models. Used as the Agent tab's first-run screen and as the
 * Models screen. Every number is live: bytes on the phone, download speed, time left, where the model runs.
 */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Check, Download, Fingerprint, ShieldCheck, Trash2, WifiOff, X } from 'lucide-react-native';
import { useT } from '@/i18n';
import { Banner, Button, Pill, Txt, tap } from '@/ui/primitives';
import { radius, space, useTheme } from '@/ui/theme';
import { useOnline } from '../network';
import { CATALOG, phoneRamGb, recommendedModel, useModel, type ModelEntry } from '../qvac';

const mb = (bytes: number) => Math.round(bytes / 1e6).toLocaleString('en-US');

function Promise_({ icon, text }: { icon: React.ReactNode; text: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primaryDim }}>{icon}</View>
      <Txt variant="small" style={{ flex: 1 }}>{text}</Txt>
    </View>
  );
}

export function Promises() {
  const t = useT();
  const { c } = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <Promise_ icon={<WifiOff size={17} color={c.primary} />} text={t('agent.promise.offline')} />
      <Promise_ icon={<ShieldCheck size={17} color={c.primary} />} text={t('agent.promise.keys')} />
      <Promise_ icon={<Fingerprint size={17} color={c.primary} />} text={t('agent.promise.approve')} />
    </View>
  );
}

/** Four dots, `n` of them filled: a rating at a glance, with its words for a screen reader. */
function Dots({ n, label }: { n: number; label: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityLabel={`${label} ${n}/4`}>
      <Txt variant="micro" tone="mute" style={{ width: 46 }}>{label}</Txt>
      {[1, 2, 3, 4].map(i => <View key={i} style={{ width: 14, height: 6, borderRadius: 3, backgroundColor: i <= n ? c.primary : c.surface2 }} />)}
    </View>
  );
}

function timeLeft(bytesLeft: number, speed: number): string {
  if (!(speed > 0)) return '';
  const s = Math.round(bytesLeft / speed);
  return s < 60 ? `${s}s` : `${Math.round(s / 60)} min`;
}

function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => { if (!on) return; const id = setInterval(() => set(n => n + 1), 1000); return () => clearInterval(id); }, [on]);
}

export function ModelCard({ m }: { m: ModelEntry }) {
  const t = useT();
  const { c } = useTheme();
  const online = useOnline();
  const f = useModel(s => s.files[m.id]);
  const active = useModel(s => s.activeId === m.id);
  const loaded = useModel(s => s.loadedId === m.id && s.load === 'ready');
  const { download, cancelDownload, remove, use } = useModel.getState();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const downloading = f.state === 'downloading';
  useTick(downloading);
  const recommended = recommendedModel() === m.id;
  const ram = phoneRamGb();
  const tight = ram > 0 && ram < m.minRamGb;
  const pct = f.total ? Math.min(1, f.bytes / f.total) : 0;
  const waitingForFirstByte = downloading && f.bytes === 0 && f.startedAt !== undefined && Date.now() - f.startedAt > 8000;

  return (
    <View testID={`model-${m.id}`} style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: active ? c.primaryBorder : c.glassBorder, backgroundColor: active ? c.primarySoft : c.glass, padding: space.lg, gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="heading">{m.name}</Txt>
          <Txt variant="micro" tone="mute">{t('agent.models.meta', { maker: m.maker, mb: mb(m.bytes) })}</Txt>
        </View>
        {active ? <Pill tone="primary" icon={<Check size={12} color={c.primary} />} label={t(loaded ? 'agent.models.inUseLoaded' : 'agent.models.inUse')} />
          : recommended ? <Pill tone="primary" label={t('agent.models.recommended')} /> : null}
      </View>
      <View style={{ gap: 6 }}>
        <Dots n={m.smarts} label={t('agent.models.smarts')} />
        <Dots n={m.speed} label={t('agent.models.speed')} />
      </View>
      <Txt variant="small" tone="mute">{t(`agent.models.about.${m.id}` as never)}</Txt>
      {tight ? <Txt variant="small" tone="amber">{t('agent.models.tight', { gb: m.minRamGb })}</Txt> : null}

      {downloading ? (
        <View style={{ gap: 6 }} accessibilityLiveRegion="polite">
          <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: c.surface2, overflow: 'hidden' }}>
            <View style={{ width: `${Math.max(2, pct * 100)}%`, height: 8, borderRadius: radius.pill, backgroundColor: c.primary }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt variant="micro" tone="mute" tabular>{t('agent.models.progress', { done: mb(f.bytes), total: mb(f.total), pct: Math.floor(pct * 100) })}</Txt>
            <Txt variant="micro" tone="mute" tabular>
              {f.speed > 0 ? t('agent.models.speedLeft', { speed: (f.speed / 1e6).toFixed(1), left: timeLeft(f.total - f.bytes, f.speed) }) : t('agent.models.starting')}
            </Txt>
          </View>
          {waitingForFirstByte ? <Txt variant="micro" tone="faint">{t('agent.models.connecting')}</Txt> : null}
          <Button small kind="secondary" label={t('agent.models.cancel')} icon={<X size={15} color={c.fg} />} onPress={() => cancelDownload(m.id)} testID={`model-cancel-${m.id}`} />
        </View>
      ) : f.state === 'ready' ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {!active ? <Button small style={{ flex: 1 }} label={t('agent.models.use')} onPress={() => { use(m.id).catch(() => {}); }} testID={`model-use-${m.id}`} /> : <View style={{ flex: 1 }} />}
          <Button small kind={confirmDelete ? 'danger' : 'ghost'} label={t(confirmDelete ? 'agent.models.deleteSure' : 'agent.models.delete', { mb: mb(m.bytes) })}
            icon={<Trash2 size={15} color={confirmDelete ? c.red : c.primary} />}
            onPress={() => { if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 4000); return; } tap(); remove(m.id).catch(() => {}); setConfirmDelete(false); }} />
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          {f.state === 'error' ? <Banner tone="error" title={t('agent.setup.failed')}>{f.error ?? ''}</Banner> : null}
          <Button small
            label={t(f.state === 'partial' ? 'agent.models.resume' : 'agent.models.download', { mb: mb(m.bytes), done: mb(f.bytes) })}
            icon={<Download size={15} color={c.onPrimary} />} disabled={!online || f.state === 'unknown'}
            onPress={() => { download(m.id).catch(() => {}); }} testID={`model-download-${m.id}`} />
        </View>
      )}
    </View>
  );
}

export function ModelList() {
  const t = useT();
  const online = useOnline();
  const rec = recommendedModel();
  const ordered = [...CATALOG].sort((a, b) => (a.id === rec ? -1 : b.id === rec ? 1 : 0));
  return (
    <View style={{ gap: space.md }}>
      {!online ? <Banner tone="warn">{t('agent.setup.needsNet')}</Banner> : null}
      {ordered.map(m => <ModelCard key={m.id} m={m} />)}
      <Txt variant="micro" tone="faint" center>{t('agent.setup.wifi')}</Txt>
    </View>
  );
}

/** First run on the Agent tab: what this is, then the models. */
export function ModelSetup() {
  const t = useT();
  return (
    <View style={{ gap: space.lg, paddingTop: space.md }} testID="agent-setup">
      <View style={{ gap: space.sm }}>
        <Txt variant="title">{t('agent.setup.title')}</Txt>
        <Txt variant="body" tone="mute">{t('agent.setup.pick')}</Txt>
      </View>
      <Promises />
      <ModelList />
    </View>
  );
}
