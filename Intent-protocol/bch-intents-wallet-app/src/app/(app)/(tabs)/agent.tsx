/**
 * The Agent tab: a chat with the wallet's on-phone assistant. The model runs on this phone through QVAC, so
 * the conversation works with no network; actions it prepares wait in the outbox until the phone is online
 * and the user approves them with the PIN. The logic is in src/agent; this file draws.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MessagesSquare, SquarePen, Wifi, WifiOff } from 'lucide-react-native';
import type { StoredMessage } from '@bch-intents/wallet-core/agent';
import { useOnline } from '@/agent/network';
import { entryOf, useModel } from '@/agent/qvac';
import { useAgentStore } from '@/agent/store';
import { useAgentUi } from '@/agent/ui-state';
import { useAgent } from '@/agent/useAgent';
import { ChatsSheet } from '@/agent/ui/ChatsSheet';
import { Composer, MessageView, PendingView } from '@/agent/ui/Chat';
import { ModelSetup, Promises } from '@/agent/ui/Models';
import { useT, type Key } from '@/i18n';
import { usePortfolio } from '@/state/portfolio';
import { Chameleon } from '@/ui/Chameleon';
import { Backdrop, Banner, Button, IconButton, TAB_BAR_SPACE, tap, Txt } from '@/ui/primitives';
import { radius, space, useTheme } from '@/ui/theme';

const SUGGESTIONS: Key[] = ['agent.suggest.balance', 'agent.suggest.ladder', 'agent.suggest.swap', 'agent.suggest.loan', 'agent.suggest.explain'];

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  const t = useT();
  const { c } = useTheme();
  return (
    <View style={{ gap: space.xl, paddingTop: space.lg }}>
      <View style={{ alignItems: 'center', gap: space.sm }}>
        <Chameleon size={104} mood="happy" />
        <Txt variant="title" center>{t('agent.welcome.title')}</Txt>
        <Txt variant="body" tone="mute" center>{t('agent.welcome.body')}</Txt>
      </View>
      <Promises />
      <View style={{ gap: space.sm }}>
        <Txt variant="micro" tone="faint" style={{ textTransform: 'uppercase', marginLeft: 4 }}>{t('agent.welcome.try')}</Txt>
        {SUGGESTIONS.map(k => (
          <Pressable key={k} onPress={() => { tap(); onPick(t(k)); }} accessibilityRole="button" accessibilityLabel={t(k)} testID={`suggest-${k}`}
            style={({ pressed }) => ({ paddingHorizontal: space.md, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: pressed ? c.surface2 : c.surface })}>
            <Txt variant="small">{t(k)}</Txt>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function StatusChip({ onPress }: { onPress: () => void }) {
  const t = useT();
  const { c } = useTheme();
  const online = useOnline();
  const activeId = useModel(s => s.activeId);
  const load = useModel(s => s.load);
  const name = activeId ? entryOf(activeId).name : t('agent.models.none');
  const state = t(load === 'loading' ? 'agent.chip.loading' : online ? 'agent.chip.online' : 'agent.chip.offline');
  const label = `${name} · ${state}`;
  return (
    <Pressable onPress={() => { tap(); onPress(); }} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} testID="agent-chip"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 8, minHeight: 24, borderRadius: radius.pill, backgroundColor: online ? c.surface2 : c.amberDim, opacity: pressed ? 0.7 : 1 })}>
      {online ? <Wifi size={12} color={c.fgMute} /> : <WifiOff size={12} color={c.amber} />}
      <Txt variant="micro" style={{ color: online ? c.fgMute : c.amber }} numberOfLines={1}>{label}</Txt>
    </Pressable>
  );
}

export default function AgentScreen() {
  const t = useT();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { accountIndex, mode } = usePortfolio();
  const online = useOnline();
  const router = useRouter();
  const modelInit = useModel(s => s.inited);
  const hasModel = useModel(s => s.activeId !== null);
  const loaded = useAgentStore(s => s.loaded);
  const activeId = useAgentStore(s => s.activeId);
  const thread = useAgentStore(s => s.threads.find(x => x.id === s.activeId && x.accountIndex === accountIndex && x.mode === mode));
  const queued = useAgentStore(s => s.outbox.filter(i => i.status === 'queued' && i.accountIndex === accountIndex && i.mode === mode).length);
  const backOnline = useAgentUi(s => s.backOnline);
  const dismissBackOnline = useAgentUi(s => s.dismissBackOnline);
  const { send, stop, pending, busy } = useAgent();
  const [chats, setChats] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => { useModel.getState().init().catch(() => { }); }, []);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // A chat from another account or network is not this one: start fresh.
  useEffect(() => {
    if (activeId && !thread) useAgentStore.getState().select(null);
  }, [activeId, thread]);

  const needsModel = modelInit && !hasModel;
  const messages: StoredMessage[] = thread?.messages ?? [];
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const snapshot = useAgentStore(s => s.snapshot);

  const chips = useMemo(() => {
    // Pick the most liquid real CashToken from snapshot, or fallback to real Chipnet/Mainnet tokens
    const defaultToken = mode === 'mainnet' ? 'PUSD' : 'PUSDTEST';
    const sampleToken = snapshot?.tokens?.[0]?.symbol ?? defaultToken;
    const list: { label: string; prompt: string }[] = [
      { label: 'Balances', prompt: 'What do I hold?' },
      { label: 'Positions', prompt: 'Show my Mesh positions' },
      { label: `Swap ${sampleToken}`, prompt: `Swap 0.01 BCH for ${sampleToken}` },
      { label: `Ladder ${sampleToken}`, prompt: `Keep accumulating ${sampleToken} cheaply with a quarter of my BCH` },
      { label: `Take Profit`, prompt: `Take profit on ${sampleToken} with half my tokens` },
      { label: 'Borrow USDC', prompt: 'How much USDC could I borrow on my BTC safely?' },
      { label: 'Explain Intents', prompt: 'Explain dutch auction intents' },
      { label: 'Explain Mesh', prompt: 'Explain mesh positions' },
    ];
    if (snapshot?.tokens?.length) {
      for (const t of snapshot.tokens.slice(0, 5)) {
        if (t.symbol !== sampleToken) {
          list.push({ label: `$${t.symbol}`, prompt: `Swap 0.01 BCH for ${t.symbol}` });
        }
      }
    }
    return list;
  }, [snapshot, mode]);

  return (
    <View style={{ flex: 1 }} testID="agent-screen">
      <Backdrop />
      {/* On iOS KeyboardAvoidingView needs padding behavior; on Android adjustResize handles the window so behavior=undefined prevents double-offset floating */}
      <KeyboardAvoidingView style={{ flex: 1, paddingTop: insets.top }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, minHeight: 56 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="heading" accessibilityRole="header">{t('nav.agent')}</Txt>
            <StatusChip onPress={() => router.push('/(app)/agent/models')} />
          </View>
          <IconButton label={t('agent.chats.title')} onPress={() => setChats(true)} testID="agent-chats"><MessagesSquare size={19} color={c.fg} /></IconButton>
          <IconButton label={t('agent.chats.new')} onPress={() => useAgentStore.getState().select(null)} testID="agent-new"><SquarePen size={18} color={c.fg} /></IconButton>
        </View>

        {/* what waits for the network */}
        <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
          {backOnline && online ? (
            <Banner tone="ok" title={t('agent.banner.backOnline')} action={<Button small label={t('agent.banner.dismiss')} kind="secondary" onPress={dismissBackOnline} />}>
              {t(backOnline.count === 1 ? 'agent.banner.readyOne' : 'agent.banner.readyMany', { count: backOnline.count })}
            </Banner>
          ) : queued > 0 && !online ? (
            <Banner tone="warn">{t(queued === 1 ? 'agent.banner.waitingOne' : 'agent.banner.waitingMany', { count: queued })}</Banner>
          ) : null}
        </View>

        <ScrollView
          ref={scroll} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg, gap: space.lg, flexGrow: 1 }}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        >
          {!loaded || !modelInit ? null : needsModel ? <ModelSetup /> : messages.length === 0 && !pending ? <Welcome onPick={send} /> : (
            <>
              {messages.map(m => <MessageView key={m.id} message={m} onRetry={m.error && lastUser ? () => send(lastUser.text) : undefined} />)}
              {pending ? <PendingView pending={pending} /> : null}
            </>
          )}
        </ScrollView>

        {!needsModel ? (
          <View style={{ paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: keyboard ? space.sm : TAB_BAR_SPACE + Math.max(insets.bottom, 12) - 4 }}>
            <Composer busy={busy} onSend={send} onStop={stop} disabled={!loaded} placeholder={t('agent.placeholder')} chips={chips} snapshot={snapshot} />
          </View>
        ) : <View style={{ height: TAB_BAR_SPACE + insets.bottom }} />}
      </KeyboardAvoidingView>

      <ChatsSheet visible={chats} onClose={() => setChats(false)} accountIndex={accountIndex} mode={mode} onNew={() => useAgentStore.getState().select(null)} />
    </View>
  );
}
