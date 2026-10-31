/**
 * Accounts: switch, add and rename. Every account comes from the one recovery phrase, so adding one creates
 * nothing to back up; it is the next address index on each chain.
 */
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, Pencil, Plus } from 'lucide-react-native';
import { useT } from '@/i18n';
import { accountName, MAX_ACCOUNTS, useAccounts } from '@/state/accounts';
import { Button, Card, Field, Header, Screen, Sheet, tap, Txt } from '@/ui/primitives';
import { radius, space, useTheme } from '@/ui/theme';

export default function Accounts() {
  const t = useT();
  const router = useRouter();
  const { c } = useTheme();
  const { count, active, names, setActive, add, rename } = useAccounts();
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState('');

  const choose = (index: number) => { setActive(index); router.back(); };
  const startRename = (index: number) => { setName(names[index] ?? ''); setEditing(index); };
  const saveName = () => { if (editing !== null) rename(editing, name); setEditing(null); };

  return (
    <Screen
      scroll testID="accounts"
      footer={count < MAX_ACCOUNTS ? <Button label={t('accounts.create')} icon={<Plus size={19} color={c.onPrimary} />} onPress={() => { add(); router.back(); }} testID="add-account" /> : undefined}
    >
      <Header title={t('accounts.title')} onBack={() => router.back()} backLabel={t('common.back')} />
      <Txt variant="small" tone="mute" style={{ marginBottom: space.md }}>{t('accounts.hint')}</Txt>
      <Card padding={space.sm}>
        {Array.from({ length: count }, (_, index) => {
          const on = index === active;
          return (
            <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Pressable
                onPress={() => { tap(); choose(index); }} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={accountName(names, index)} testID={`account-${index}`}
                style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: on ? c.primaryDim : pressed ? c.surface2 : 'transparent' })}
              >
                <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.primary : c.surface2 }}>
                  <Txt variant="label" style={{ color: on ? c.onPrimary : c.fgMute }}>{index + 1}</Txt>
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="label" numberOfLines={1}>{accountName(names, index)}</Txt>
                  {on ? <Txt variant="small" tone="primary">{t('accounts.active')}</Txt> : null}
                </View>
                {on ? <Check size={18} color={c.primary} /> : null}
              </Pressable>
              <Pressable
                onPress={() => { tap(); startRename(index); }} accessibilityRole="button" accessibilityLabel={`${t('accounts.rename')}: ${accountName(names, index)}`} hitSlop={6} testID={`rename-${index}`}
                style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.surface2 : 'transparent' })}
              >
                <Pencil size={16} color={c.fgMute} />
              </Pressable>
            </View>
          );
        })}
      </Card>

      <Sheet visible={editing !== null} onClose={() => setEditing(null)} title={t('accounts.rename')} closeLabel={t('common.close')}>
        <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
          <Field value={name} onChangeText={setName} placeholder={editing !== null ? `Account ${editing + 1}` : ''} maxLength={24} autoFocus autoCapitalize="words" onSubmitEditing={saveName} returnKeyType="done" testID="rename-input" />
          <Button label={t('common.save')} onPress={saveName} testID="rename-save" />
        </View>
      </Sheet>
    </Screen>
  );
}
