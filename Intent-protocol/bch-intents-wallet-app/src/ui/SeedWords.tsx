/**
 * The recovery phrase as a numbered grid, hidden until tapped. Used when a wallet is created and again in
 * Settings. The screen that shows it keeps the app out of screenshots and the recent-apps preview where the
 * platform allows (see useSecureScreen).
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Eye } from 'lucide-react-native';
import { Txt } from './primitives';
import { radius, space, useTheme } from './theme';

export function SeedWords({ words, revealed, onReveal, revealLabel }: { words: string[]; revealed: boolean; onReveal: () => void; revealLabel: string }) {
  const { c } = useTheme();
  return (
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityElementsHidden={!revealed} importantForAccessibility={revealed ? 'auto' : 'no-hide-descendants'}>
        {words.map((word, i) => (
          <View key={i} style={{ width: '31%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, minHeight: 44, borderRadius: radius.sm, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
            <Text style={{ color: c.fgFaint, fontSize: 11, fontWeight: '700', width: 16 }}>{i + 1}</Text>
            <Text style={{ color: c.fg, fontSize: 15, fontWeight: '600', opacity: revealed ? 1 : 0 }} selectable={false}>{word}</Text>
          </View>
        ))}
      </View>
      {!revealed ? (
        <Pressable
          onPress={onReveal} accessibilityRole="button" accessibilityLabel={revealLabel} testID="reveal-phrase"
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: radius.md, backgroundColor: c.glassStrong, alignItems: 'center', justifyContent: 'center', gap: space.sm, borderWidth: 1, borderColor: c.glassBorder }}
        >
          <Eye size={24} color={c.primary} />
          <Txt variant="label" tone="primary">{revealLabel}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}
