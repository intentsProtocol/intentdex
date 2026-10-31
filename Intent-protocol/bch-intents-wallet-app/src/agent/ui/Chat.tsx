/** The conversation itself: messages, the reply being written, and the box the user types in. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowUp, Coins, Sparkles, Square } from 'lucide-react-native';
import { suggestTokens, type StoredMessage, type WalletSnapshot } from '@bch-intents/wallet-core/agent';
import { useT, type Key } from '@/i18n';
import { tap, Txt } from '@/ui/primitives';
import { radius, space, TOUCH, useTheme } from '@/ui/theme';
import type { Pending, Phase } from '../useAgent';
import { AgentCard } from './Cards';

function FormattedInline({ text }: { text: string }) {
  const { c } = useTheme();
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\$[A-Z0-9.-]+)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <Text key={match.index} style={{ fontWeight: '700', color: c.fg }}>
          {token.slice(2, -2)}
        </Text>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <Text
          key={match.index}
          style={{
            fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
            backgroundColor: c.surface2,
            color: c.primary,
            fontSize: 13,
            paddingHorizontal: 4,
            paddingVertical: 1,
            borderRadius: 4,
          }}
        >
          {token.slice(1, -1)}
        </Text>
      );
    } else if (token.startsWith('$')) {
      parts.push(
        <Text key={match.index} style={{ fontWeight: '700', color: c.primary }}>
          {token}
        </Text>
      );
    }
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return <Text style={{ color: c.fg, fontSize: 15, lineHeight: 22 }}>{parts}</Text>;
}

export function FormattedMessage({ text }: { text: string }) {
  const { c } = useTheme();
  const lines = text.split('\n');

  return (
    <View style={{ gap: 6 }}>
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <View key={idx} style={{ height: 4 }} />;

        if (/^#{1,3}\s+/.test(trimmed)) {
          const headerText = trimmed.replace(/^#{1,3}\s+/, '');
          return (
            <View key={idx} style={{ marginTop: idx > 0 ? 6 : 0, marginBottom: 2 }}>
              <Txt variant="label" weight="700" style={{ fontSize: 16 }}>
                {headerText}
              </Txt>
            </View>
          );
        }

        if (/^[-*•]\s+/.test(trimmed)) {
          const content = trimmed.replace(/^[-*•]\s+/, '');
          return (
            <View key={idx} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingLeft: 4 }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: c.primary, marginTop: 8 }} />
              <View style={{ flex: 1 }}>
                <FormattedInline text={content} />
              </View>
            </View>
          );
        }

        const numMatch = /^(\d+)[.)]\s+(.*)/.exec(trimmed);
        if (numMatch) {
          return (
            <View key={idx} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingLeft: 2 }}>
              <View style={{ minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: c.fgMute }}>{numMatch[1]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <FormattedInline text={numMatch[2]!} />
              </View>
            </View>
          );
        }

        return (
          <View key={idx} style={{ paddingHorizontal: 2 }}>
            <FormattedInline text={trimmed} />
          </View>
        );
      })}
    </View>
  );
}

export function MessageView({ message, onRetry }: { message: StoredMessage; onRetry?: () => void }) {
  const t = useT();
  const { c } = useTheme();
  if (message.role === 'user') {
    return (
      <View style={{ alignSelf: 'flex-end', maxWidth: '86%', backgroundColor: c.primaryDim, borderColor: c.primaryBorder, borderWidth: 1, borderRadius: radius.lg, borderBottomRightRadius: 6, paddingHorizontal: space.md, paddingVertical: 10 }}>
        <Txt variant="body" selectable>{message.text}</Txt>
      </View>
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      {message.text ? <FormattedMessage text={message.text} /> : null}
      {message.cards?.map((card, i) => <AgentCard key={i} card={card} />)}
      {message.error ? (
        <Pressable onPress={onRetry} disabled={!onRetry} accessibilityRole={onRetry ? 'button' : undefined}>
          <Txt variant="small" tone={message.error === 'cancelled' ? 'mute' : 'amber'}>
            {t(message.error === 'cancelled' ? 'agent.error.cancelled' : message.error === 'empty' ? 'agent.error.empty' : message.error === 'slow' ? 'agent.error.slow' : 'agent.error.model')}
            {onRetry && message.error !== 'cancelled' ? <Txt variant="small" tone="primary">{`  ${t('common.retry')}`}</Txt> : null}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

const PHASE: Record<Phase, Key> = {
  'loading-model': 'agent.phase.loading',
  thinking: 'agent.phase.thinking',
  working: 'agent.phase.working',
  writing: 'agent.phase.writing',
};

function Dots() {
  const { c } = useTheme();
  const v = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const loops = v.map((a, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 160),
      Animated.timing(a, { toValue: 1, duration: 360, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(a, { toValue: 0.3, duration: 360, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.delay((2 - i) * 160),
    ])));
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [v]);
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {v.map((a, i) => <Animated.View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.primary, opacity: a }} />)}
    </View>
  );
}

export function PendingView({ pending }: { pending: Pending }) {
  const t = useT();
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(id); }, []);
  const secs = Math.max(0, Math.round((Date.now() - pending.startedAt) / 1000));
  return (
    <View style={{ gap: space.sm }} accessibilityLiveRegion="polite">
      {pending.text ? <FormattedMessage text={pending.text} /> : null}
      {pending.cards.map((card, i) => <AgentCard key={i} card={card} />)}
      {pending.phase !== 'writing' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: 2 }}>
          <Dots />
          <Txt variant="small" tone="mute">{t(PHASE[pending.phase])}{secs >= 3 ? ` · ${secs}s` : ''}</Txt>
        </View>
      ) : null}
    </View>
  );
}

export function Composer({
  busy,
  onSend,
  onStop,
  disabled,
  placeholder,
  chips,
  snapshot,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  disabled?: boolean;
  placeholder: string;
  chips?: { label: string; prompt: string }[];
  snapshot?: WalletSnapshot | null;
}) {
  const t = useT();
  const { c } = useTheme();
  const [text, setText] = useState('');
  const can = !disabled && !busy && text.trim().length > 0;
  const send = () => { if (!can) return; tap(); onSend(text); setText(''); };

  const lastWord = text.split(/\s+/).pop() ?? '';
  const isTokenQuery = lastWord.startsWith('$');
  const tokenMatches = useMemo(() => {
    if (!snapshot || !isTokenQuery) return [];
    return suggestTokens(snapshot, lastWord.slice(1), 6);
  }, [snapshot, isTokenQuery, lastWord]);

  const insertToken = (symbol: string) => {
    tap();
    const words = text.split(/\s+/);
    words.pop();
    words.push(`$${symbol} `);
    setText(words.join(' '));
  };

  return (
    <View style={{ gap: space.xs }}>
      {tokenMatches.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 4, paddingBottom: 4 }}>
          {tokenMatches.map(t => (
            <Pressable
              key={t.category}
              onPress={() => insertToken(t.symbol)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: radius.pill,
                backgroundColor: pressed ? c.surface2 : c.surface,
                borderWidth: 1,
                borderColor: c.primaryBorder,
              })}
            >
              <Coins size={12} color={c.primary} />
              <Txt variant="micro" weight="700" tone="primary">${t.symbol}</Txt>
              <Txt variant="micro" tone="mute" numberOfLines={1}>{t.name}</Txt>
            </Pressable>
          ))}
        </ScrollView>
      ) : chips && chips.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 4, paddingBottom: 4 }}>
          {chips.map((item, idx) => (
            <Pressable
              key={idx}
              onPress={() => {
                tap();
                onSend(item.prompt);
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: radius.pill,
                backgroundColor: pressed ? c.surface2 : c.surface,
                borderWidth: 1,
                borderColor: c.border,
              })}
            >
              <Sparkles size={11} color={c.primary} />
              <Txt variant="micro" weight="600">{item.label}</Txt>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, padding: 6, paddingLeft: space.md, borderRadius: radius.xl, backgroundColor: c.glassStrong, borderWidth: 1, borderColor: c.glassBorder }}>
        <TextInput
          value={text} onChangeText={setText} placeholder={placeholder} placeholderTextColor={c.fgFaint} selectionColor={c.primary}
          multiline maxLength={600} editable={!disabled} accessibilityLabel={placeholder} testID="agent-input"
          onSubmitEditing={send} blurOnSubmit={false}
          style={{ flex: 1, color: c.fg, fontSize: 16, lineHeight: 21, maxHeight: 120, paddingTop: 11, paddingBottom: 11 }}
        />
        {busy ? (
          <Pressable onPress={() => { tap(); onStop(); }} accessibilityRole="button" accessibilityLabel={t('agent.stop')} testID="agent-stop"
            style={({ pressed }) => ({ width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.surface2 : c.bg3 })}>
            <Square size={16} color={c.fg} fill={c.fg} />
          </Pressable>
        ) : (
          <Pressable onPress={send} disabled={!can} accessibilityRole="button" accessibilityLabel={t('agent.send')} accessibilityState={{ disabled: !can }} testID="agent-send"
            style={({ pressed }) => ({ width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: can ? c.primary : c.surface2, opacity: pressed ? 0.85 : 1 })}>
            <ArrowUp size={20} color={can ? c.onPrimary : c.fgFaint} strokeWidth={2.6} />
          </Pressable>
        )}
      </View>
    </View>
  );
}
