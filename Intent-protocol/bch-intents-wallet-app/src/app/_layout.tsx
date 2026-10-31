/**
 * The root of the app: the WDK worklet, the theme, and the three places a session can be (setting up, locked,
 * unlocked).
 *
 * `react-native-get-random-values` comes first: it gives the JavaScript engine a secure random source, which
 * everything cryptographic that loads after it expects to find.
 */
import 'react-native-get-random-values';
import '@/lib/core-setup';
// Defines the agent's background check; a task must exist before the app registers or runs it.
import '@/agent/notify';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { WdkAppProvider } from '@tetherto/wdk-react-native-core';
import wdkBundle from '../../.wdk-bundle/wdk-worklet.bundle.js';
import { wdkConfigs } from '@/wdk/config';
import { AutoLock } from '@/wdk/AutoLock';
import { useAccounts } from '@/state/accounts';
import { useSettingsStore } from '@/state/settings';
import { ThemeProvider, useTheme } from '@/ui/theme';

function RootStack() {
  const { c, dark } = useTheme();
  useEffect(() => { SystemUI.setBackgroundColorAsync(c.bg0).catch(() => {}); }, [c.bg0]);
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg0 }, animation: 'fade' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="unlock" options={{ gestureEnabled: false }} />
        <Stack.Screen name="(app)" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const loadSettings = useSettingsStore(s => s.load);
  const loadAccounts = useAccounts(s => s.load);
  useEffect(() => { loadSettings(); loadAccounts(); }, [loadSettings, loadAccounts]);

  return (
    <WdkAppProvider wdkConfigs={wdkConfigs} bundle={{ bundle: wdkBundle as string }}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <AutoLock />
            <RootStack />
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </WdkAppProvider>
  );
}
