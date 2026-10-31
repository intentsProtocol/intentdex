/**
 * Reviewing an action the agent drafted. This is the only door from a draft to a transaction: it gets a fresh
 * quote from the network, shows what changed, asks for the PIN, and then runs the wallet's ordinary flow
 * (the same code as the Swap tab). The result is written back to the chat's outbox.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, CircleAlert, ExternalLink, WifiOff } from 'lucide-react-native';
import { errorMessage, formatAmount, formatUnits } from '@bch-intents/wallet-core/format';
import { planStrategy, type MeshDraft, type OutboxItem, type SwapDraft } from '@bch-intents/wallet-core/agent';
import { explorerTxUrl } from '@bch-intents/wallet-core/chains';
import { getTradeableTokens } from '@bch-intents/wallet-core/cashtokens';
import { PlanCheckError } from '@bch-intents/wallet-core/mesh/plan';
import { createMeshPosition, MESH_STEPS, type MeshStep } from '@/agent/mesh';
import { usePortfolio } from '@/state/portfolio';
import { useOnline } from '@/agent/network';
import { notifyFinished } from '@/agent/notify';
import { useAgentStore } from '@/agent/store';
import { AgentCard } from '@/agent/ui/Cards';
import { useT, type Key } from '@/i18n';
import { useSwap, type RunStep } from '@/swap/useSwap';
import { PinGate } from '@/ui/PinGate';
import { Backdrop, Banner, Button, Card, Empty, Header, Line, Screen, Spinner, thud, Txt } from '@/ui/primitives';
import { space, useTheme } from '@/ui/theme';

function Steps({ steps }: { steps: RunStep[] }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      {steps.map(s => (
        <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          {s.state === 'done' ? <Check size={16} color={c.primary} /> : s.state === 'failed' ? <CircleAlert size={16} color={c.red} /> : s.state === 'active' ? <Spinner /> : <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: c.borderStrong }} />}
          <Txt variant="small" tone={s.state === 'pending' ? 'mute' : 'fg'} style={{ flex: 1 }}>{s.label}</Txt>
          {s.link ? <ExternalLink size={14} color={c.fgMute} onPress={() => Linking.openURL(s.link!).catch(() => {})} /> : null}
        </View>
      ))}
    </View>
  );
}

function PinModal({ visible, prompt, onPass, onClose }: { visible: boolean; prompt: string; onPass: () => void; onClose: () => void }) {
  const t = useT();
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <Backdrop />
        <View style={{ flex: 1, paddingHorizontal: space.lg }}>
          <PinGate prompt={prompt} onPass={() => onPass()} />
          <Button kind="ghost" label={t('common.cancel')} onPress={onClose} style={{ marginBottom: space.xxl }} />
        </View>
      </View>
    </Modal>
  );
}

function SwapReview({ item, draft }: { item: OutboxItem; draft: SwapDraft }) {
  const t = useT();
  const router = useRouter();
  const online = useOnline();
  const setStatus = useAgentStore(s => s.setStatus);
  const model = useSwap(draft.sell.assetId);
  const [pin, setPin] = useState(false);
  const [fill, setFill] = useState<'working' | 'done' | 'missing'>('working');
  const attempts = useRef(0);

  // Put the drafted pair and amount into the swap logic, one side at a time (a pick settles the other side).
  const sellId = `${draft.sell.network}:${draft.sell.ref}`;
  const buyId = `${draft.buy.network}:${draft.buy.ref}`;
  useEffect(() => {
    if (fill !== 'working' || model.loadingLists || !model.tokens.length) return;
    const sell = model.tokens.find(x => x.id === sellId);
    const buy = model.tokens.find(x => x.id === buyId);
    if (!sell || !buy || attempts.current++ > 6) { setFill('missing'); return; }
    if (model.sell?.id !== sellId) { model.pick('sell', sell); return; }
    if (model.buy?.id !== buyId) { model.pick('buy', buy); return; }
    model.setAmount(formatUnits(BigInt(draft.amount.value), sell.decimals));
    setFill('done');
  }, [fill, model.loadingLists, model.tokens.length, model.sell?.id, model.buy?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the run into the outbox; say so if the user has left the app.
  const run = model.run;
  useEffect(() => {
    if (!run) return;
    if (run.status === 'running' && item.status !== 'running') setStatus(item.id, 'running');
    if (run.status === 'done' || run.status === 'failed') {
      const link = [...run.steps].reverse().find(s => s.link)?.link;
      setStatus(item.id, run.status === 'done' ? 'done' : 'failed', { note: run.message, link });
      if (run.status === 'done') thud();
      if (AppState.currentState !== 'active' && run.message) notifyFinished(run.message).catch(() => {});
    }
  }, [run?.status]);   // eslint-disable-line react-hooks/exhaustive-deps

  const prefillFailed = fill === 'missing';
  const done = item.status === 'done';
  const isUnderfunded = model.sell
    ? model.sellBalance < BigInt(draft.amount.value)
    : !!draft.underfunded;
  const missingAmount = model.sell && model.sellBalance < BigInt(draft.amount.value)
    ? BigInt(draft.amount.value) - model.sellBalance
    : draft.underfunded ? BigInt(draft.underfunded.missing) : 0n;

  return (
    <>
      {!online ? <Banner tone="warn" title={t('agent.review.offline')}>{t('agent.review.offlineBody')}</Banner> : null}
      {isUnderfunded ? (
        <Banner tone="warn" title={t('agent.warn.insufficientBalance')} action={<Button small kind="secondary" label={t('agent.action.topUp')} onPress={() => router.push('/(app)/receive')} />}>
          {t('agent.warn.underfundedMissing', {
            missing: formatAmount(missingAmount, draft.amount.decimals, 6),
            symbol: draft.amount.symbol,
          })}
        </Banner>
      ) : null}
      {model.notConfigured || model.serverDown ? <Banner tone="error">{t('agent.review.serviceDown')}</Banner> : null}
      {prefillFailed ? <Banner tone="error">{t('agent.review.pairGone')}</Banner> : null}
      <Card>
        <Txt variant="micro" tone="mute">{t('agent.review.youSell')}</Txt>
        <Txt variant="title" tabular>{`${formatAmount(BigInt(draft.amount.value), draft.amount.decimals, 8)} ${draft.amount.symbol}`}</Txt>
        <Txt variant="small" tone="mute">{draft.sell.networkName}</Txt>
        <View style={{ height: space.md }} />
        <Txt variant="micro" tone="mute">{t('agent.review.youGet')}</Txt>
        {model.quoting || (online && model.loadingLists) ? <Spinner /> : model.quote && model.buy
          ? <Txt variant="title" tabular>{`${formatAmount(model.quote.receive, model.buy.decimals, 8)} ${model.buy.symbol}`}</Txt>
          : <Txt variant="heading" tone="mute">{draft.buy.symbol}</Txt>}
        <Txt variant="small" tone="mute">{draft.buy.networkName}</Txt>
        {model.quote ? (
          <View style={{ marginTop: space.md }}>
            {model.quote.lines.map(l => <Line key={l.label} label={t(l.label)} value={l.value} tone={l.tone} />)}
          </View>
        ) : null}
        {model.quoteError ? <Txt variant="small" tone="red" style={{ marginTop: space.sm }}>{model.quoteError}</Txt> : null}
        {model.quote?.warnings.map(w => <Txt key={w} variant="small" tone="amber" style={{ marginTop: 4 }}>{w}</Txt>)}
      </Card>
      {run ? <Card><Steps steps={run.steps} />{run.message ? <Txt variant="small" style={{ marginTop: space.md }}>{run.message}</Txt> : null}</Card> : null}
      {!run && !done ? (
        isUnderfunded ? (
          <Button label={t('agent.action.topUp')} kind="secondary" onPress={() => router.push('/(app)/receive')} testID="agent-topup" />
        ) : (
          <Button label={t('agent.review.approve')} disabled={!model.canSubmit || !online} onPress={() => setPin(true)} testID="agent-approve" />
        )
      ) : null}
      <PinModal visible={pin} prompt={t('agent.review.pinPrompt')} onClose={() => setPin(false)} onPass={() => { setPin(false); model.submit(); }} />
    </>
  );
}

const MESH_STEP_LABEL: Record<MeshStep, Key> = {
  seed: 'agent.mesh.step.seed', plan: 'agent.mesh.step.plan', check: 'agent.mesh.step.check', send: 'agent.mesh.step.send', register: 'agent.mesh.step.register',
};

function MeshReview({ item, draft }: { item: OutboxItem; draft: MeshDraft }) {
  const t = useT();
  const router = useRouter();
  const online = useOnline();
  const { addresses, isMainnet, accountIndex, assets, refresh } = usePortfolio();
  const setStatus = useAgentStore(s => s.setStatus);
  const updateDraft = useAgentStore(s => s.updateDraft);
  const [pin, setPin] = useState(false);
  const [price, setPrice] = useState<{ now: number; moved: number } | null | 'none'>(null);
  const [steps, setSteps] = useState<RunStep[] | null>(null);
  const [message, setMessage] = useState('');
  const net = isMainnet ? 'mainnet' : 'chipnet';
  const bchNet = assets.find(a => a.network.family === 'bch')?.network;

  // Today's pool price. A plan made offline is moved to it before it is approved.
  useEffect(() => {
    if (!online || item.status === 'done') return;
    let on = true;
    getTradeableTokens(net).then(list => {
      if (!on) return;
      const now = list.find(x => x.category === draft.token.category)?.priceSats ?? 0;
      if (!(now > 0)) { setPrice('none'); return; }
      const moved = Math.abs(now - draft.marketPrice) / draft.marketPrice;
      setPrice({ now, moved });
      if (moved > 0.03 && item.status !== 'running') {
        const again = planStrategy({
          style: draft.style, risk: draft.risk, token: draft.token, marketPrice: now,
          bchBudget: BigInt(draft.depositSats), tokenBudget: BigInt(draft.depositTokens), testnet: !isMainnet,
        });
        if (again.ok) updateDraft(item.id, again.draft);
      }
    }).catch(() => { if (on) setPrice('none'); });
    return () => { on = false; };
  }, [online, net]);   // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (!bchNet || !addresses.bch || !addresses.bchToken) return;
    setStatus(item.id, 'running');
    setMessage('');
    setSteps(MESH_STEPS.map(k => ({ key: k, label: t(MESH_STEP_LABEL[k]), state: 'pending' })));
    const mark = (step: MeshStep, state: 'active' | 'done' | 'failed', note?: string) =>
      setSteps(list => list && list.map(x => (x.key === step ? { ...x, state, note: note === 'later' ? t('agent.mesh.registerLater') : note } : x)));
    try {
      const result = await createMeshPosition(draft, {
        networkKey: bchNet.key, net, accountIndex, address: addresses.bch, tokenAddress: addresses.bchToken, onStep: mark,
      });
      const link = explorerTxUrl(bchNet, result.txid);
      setSteps(list => list && list.map(x => (x.key === 'send' ? { ...x, link } : x)));
      setStatus(item.id, 'done', { ref: result.category, link, note: result.registered ? undefined : t('agent.mesh.registerLater') });
      setMessage(t('agent.mesh.done'));
      thud();
      if (AppState.currentState !== 'active') notifyFinished(t('agent.mesh.done')).catch(() => {});
      refresh().catch(() => {});
    } catch (e) {
      const note = e instanceof PlanCheckError ? t('agent.mesh.checkFailed', { reason: e.message }) : errorMessage(e);
      setSteps(list => list && list.map(x => (x.state === 'active' ? { ...x, state: 'failed' } : x)));
      setStatus(item.id, 'failed', { note });
      setMessage(note);
    }
  };

  const done = item.status === 'done';
  const running = item.status === 'running' || (steps !== null && !done && !message);

  const bch = assets.find(a => a.network.family === 'bch' && a.kind === 'native');
  const bchBalance = BigInt(bch?.balance ?? '0');
  const held = assets.find(a => a.kind === 'cashtoken' && a.ref === draft.token.category);
  const heldTokens = BigInt(held?.balance ?? '0');
  const neededBch = BigInt(draft.depositSats);
  const neededTokens = BigInt(draft.depositTokens);

  const missingBch = neededBch > bchBalance ? neededBch - bchBalance : 0n;
  const missingTokens = neededTokens > heldTokens ? neededTokens - heldTokens : 0n;
  const isUnderfunded = missingBch > 0n || missingTokens > 0n;

  return (
    <>
      {!online ? <Banner tone="warn" title={t('agent.review.offline')}>{t('agent.mesh.offlineBody')}</Banner> : null}
      {isUnderfunded ? (
        <Banner tone="warn" title={t('agent.warn.insufficientBalance')} action={<Button small kind="secondary" label={t('agent.action.topUp')} onPress={() => router.push('/(app)/receive')} />}>
          {missingBch > 0n
            ? t('agent.warn.underfundedMissing', { missing: formatAmount(missingBch, 8, 6), symbol: 'BCH' })
            : t('agent.warn.underfundedMissing', { missing: formatAmount(missingTokens, draft.token.decimals, 6), symbol: draft.token.symbol })}
        </Banner>
      ) : null}
      <AgentCard card={{ type: 'draft', draftId: item.id, draft }} bare />
      {price && price !== 'none' && price.moved > 0.03 ? (
        <Banner tone="info" title={t('agent.mesh.moved', { pct: Math.round(price.moved * 100) })}>{t('agent.mesh.movedBody')}</Banner>
      ) : null}
      {price === 'none' ? <Banner tone="warn">{t('agent.mesh.noPrice')}</Banner> : null}
      {steps ? <Card><Steps steps={steps} />{message ? <Txt variant="small" style={{ marginTop: space.md }}>{message}</Txt> : null}</Card> : null}
      {!done && !running ? (
        isUnderfunded ? (
          <Button label={t('agent.action.topUp')} kind="secondary" onPress={() => router.push('/(app)/receive')} testID="agent-topup" />
        ) : (
          <Button label={t(item.status === 'failed' ? 'agent.mesh.retry' : 'agent.mesh.approve')} disabled={!online || price === null} onPress={() => setPin(true)} testID="agent-approve" />
        )
      ) : null}
      {done && item.result?.ref ? <Txt variant="small" tone="mute" center>{t('agent.mesh.inWallet')}</Txt> : null}
      <Txt variant="micro" tone="faint">{t('agent.mesh.howChecked')}</Txt>
      <PinModal visible={pin} prompt={t('agent.mesh.pinPrompt')} onClose={() => setPin(false)} onPass={() => { setPin(false); run(); }} />
    </>
  );
}

export default function AgentReviewScreen() {
  const t = useT();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useAgentStore(s => s.outbox.find(i => i.id === id));
  const online = useOnline();
  const { c } = useTheme();
  return (
    <Screen scroll>
      <Header title={t('agent.review.title')} onBack={() => router.back()} backLabel={t('common.back')} right={!online ? <WifiOff size={18} color={c.amber} /> : undefined} />
      <View style={{ gap: space.md, paddingBottom: space.xl }}>
        {!item ? <Empty title={t('agent.review.gone')} />
          : item.draft.kind === 'swap' ? <SwapReview item={item} draft={item.draft} />
            : <MeshReview item={item} draft={item.draft} />}
        <Txt variant="micro" tone="faint" center>{t('agent.review.footer')}</Txt>
      </View>
    </Screen>
  );
}
