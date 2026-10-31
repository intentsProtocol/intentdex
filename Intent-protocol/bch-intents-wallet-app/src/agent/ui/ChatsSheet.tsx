/** The saved chats of this account on this network, newest first. */
import React from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { MessageSquare, SquarePen, Trash2 } from 'lucide-react-native';
import { timeAgo } from '@bch-intents/wallet-core/format';
import { useT } from '@/i18n';
import { Button, Empty, Sheet, tap, Txt } from '@/ui/primitives';
import { radius, space, TOUCH, useTheme } from '@/ui/theme';
import { useAgentStore } from '../store';

export function ChatsSheet({ visible, onClose, accountIndex, mode, onNew }: {
  visible: boolean; onClose: () => void; accountIndex: number; mode: 'testnet' | 'mainnet'; onNew: () => void;
}) {
  const t = useT();
  const { c } = useTheme();
  const threads = useAgentStore(s => s.threads).filter(x => x.accountIndex === accountIndex && x.mode === mode && x.messages.length > 0);
  const activeId = useAgentStore(s => s.activeId);
  const select = useAgentStore(s => s.select);
  const remove = useAgentStore(s => s.removeThread);
  return (
    <Sheet visible={visible} onClose={onClose} title={t('agent.chats.title')} tall closeLabel={t('common.close')}>
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
        <Button small kind="secondary" label={t('agent.chats.new')} icon={<SquarePen size={16} color={c.fg} />} onPress={() => { onNew(); onClose(); }} />
      </View>
      <FlatList
        data={threads} keyExtractor={x => x.id} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.xl }}
        ListEmptyComponent={<Empty title={t('agent.chats.empty')} body={t('agent.chats.emptyBody')} />}
        renderItem={({ item }) => {
          const on = item.id === activeId;
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: on ? c.primaryBorder : c.border, backgroundColor: on ? c.primaryDim : c.surface }}>
              <Pressable
                onPress={() => { tap(); select(item.id); onClose(); }} accessibilityRole="button" accessibilityLabel={item.title}
                style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, opacity: pressed ? 0.7 : 1 })}
              >
                <MessageSquare size={18} color={on ? c.primary : c.fgMute} />
                <View style={{ flex: 1 }}>
                  <Txt variant="label" numberOfLines={1}>{item.title || t('agent.chats.untitled')}</Txt>
                  <Txt variant="micro" tone="mute">{t('agent.chats.meta', { time: timeAgo(item.updatedAt), count: item.messages.length })}</Txt>
                </View>
              </Pressable>
              <Pressable onPress={() => { tap(); remove(item.id); }} accessibilityRole="button" accessibilityLabel={t('agent.chats.delete', { title: item.title })} hitSlop={6}
                style={({ pressed }) => ({ width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                <Trash2 size={17} color={c.fgFaint} />
              </Pressable>
            </View>
          );
        }}
      />
    </Sheet>
  );
}
