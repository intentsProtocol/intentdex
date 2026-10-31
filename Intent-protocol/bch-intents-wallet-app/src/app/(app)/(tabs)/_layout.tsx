/**
 * The five tabs, on a floating glass bar. On iOS 26 the bar is the system's Liquid Glass; elsewhere it is the
 * app's own glass surface (see ui/Glass.tsx). Each tab is a full-height touch target with its label always
 * shown, so the bar reads without colour.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeftRight, History, Settings as SettingsIcon, Sparkles, Wallet } from 'lucide-react-native';
import { useT, type Key } from '@/i18n';
import { Glass } from '@/ui/Glass';
import { tap } from '@/ui/primitives';
import { radius, useTheme } from '@/ui/theme';

const TABS: Record<string, { label: Key; Icon: typeof Wallet }> = {
  wallet: { label: 'nav.wallet', Icon: Wallet },
  swap: { label: 'nav.swap', Icon: ArrowLeftRight },
  agent: { label: 'nav.agent', Icon: Sparkles },
  activity: { label: 'nav.activity', Icon: History },
  settings: { label: 'nav.settings', Icon: SettingsIcon },
};

function GlassTabBar({ state, navigation }: BottomTabBarProps) {
  const t = useT();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: Math.max(insets.bottom, 12) }}>
      <Glass strong radius={radius.xl} style={{ shadowColor: c.shadow, shadowOpacity: 1, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 12 }}>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', padding: 6, gap: 4 }}>
          {state.routes.map((route, index) => {
            const tab = TABS[route.name];
            if (!tab) return null;
            const on = state.index === index;
            const label = t(tab.label);
            return (
              <Pressable
                key={route.key} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: on }} testID={`tab-${route.name}`}
                onPress={() => {
                  const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                  if (!on && !event.defaultPrevented) { tap(); navigation.navigate(route.name); }
                }}
                style={{ flex: 1, minHeight: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: on ? c.primaryDim : 'transparent' }}
              >
                <tab.Icon size={22} color={on ? c.primary : c.fgMute} strokeWidth={on ? 2.4 : 2} />
                <Text style={{ fontSize: 11, fontWeight: on ? '700' : '600', color: on ? c.primary : c.fgMute }} numberOfLines={1}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}

export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <Tabs tabBar={props => <GlassTabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg0 } }}>
      <Tabs.Screen name="wallet" />
      <Tabs.Screen name="swap" />
      <Tabs.Screen name="agent" />
      <Tabs.Screen name="activity" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
