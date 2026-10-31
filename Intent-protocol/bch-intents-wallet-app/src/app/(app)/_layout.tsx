/**
 * Everything behind the lock. The portfolio, the agent's chats and the dapp connections exist only here, so locking the wallet
 * unmounts them and nothing keeps reading or answering while it is locked.
 */
import React from 'react';
import { Redirect, Stack } from 'expo-router';
import { AgentProvider } from '@/agent/AgentProvider';
import { ConnectProvider } from '@/connect/ConnectProvider';
import { PortfolioProvider } from '@/state/portfolio';
import { useTheme } from '@/ui/theme';
import { useSession } from '@/wdk/session';

export default function AppLayout() {
  const { c } = useTheme();
  const { status } = useSession();
  if (status === 'noWallet') return <Redirect href="/(onboarding)/welcome" />;
  if (status !== 'unlocked') return <Redirect href="/unlock" />;

  const sheet = { presentation: 'modal' as const, animation: 'slide_from_bottom' as const };
  return (
    <PortfolioProvider>
      <AgentProvider>
      <ConnectProvider>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg0 }, animation: 'slide_from_right' }}>
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="send" options={sheet} />
          <Stack.Screen name="receive" options={sheet} />
          <Stack.Screen name="scan" options={{ ...sheet, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="accounts" options={sheet} />
          <Stack.Screen name="connect" options={sheet} />
          <Stack.Screen name="token/[id]" />
          <Stack.Screen name="nft/[id]" />
          <Stack.Screen name="nft/send" options={sheet} />
          <Stack.Screen name="nft/group/[category]" />
          <Stack.Screen name="settings/[view]" />
          <Stack.Screen name="agent/[id]" options={sheet} />
          <Stack.Screen name="agent/models" />
        </Stack>
      </ConnectProvider>
      </AgentProvider>
    </PortfolioProvider>
  );
}
