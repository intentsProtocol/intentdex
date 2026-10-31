/**
 * The agent's background duties while the wallet is unlocked:
 * - open the saved chats and outbox;
 * - keep the offline snapshot of balances, prices and positions up to date;
 * - notice the phone coming back online while actions wait, and say so (banner in the app, notification
 *   outside it);
 * - on lock, unload the model and drop the decrypted chats from memory.
 */
import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { buildSnapshot } from '@bch-intents/wallet-core/agent';
import { valueOf, type Asset } from '@bch-intents/wallet-core/assets';
import type { PriceMap } from '@bch-intents/wallet-core/prices';
import { readActivity } from '@bch-intents/wallet-core/activity';
import { getTradeableTokens, type TradeableToken } from '@bch-intents/wallet-core/cashtokens';
import { usePortfolio } from '@/state/portfolio';
import { thud } from '@/ui/primitives';
import { useNet, watchNetwork } from './network';
import { configureNotifications, notifyBackOnline, resetReminder, syncBackgroundCheck } from './notify';
import { useModel } from './qvac';
import { useAgentStore } from './store';
import { useAgentUi } from './ui-state';

/** What the agent needs to know: real holdings, not hundreds of spam airdrops. */
function assetsForAgent(assets: Asset[], prices: PriceMap): Asset[] {
  return assets.filter(a => a.verified || a.kind === 'native' || a.kind === 'cashtoken' || (valueOf(a, prices) ?? 0) >= 1).slice(0, 150);
}

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const portfolio = usePortfolio();
  const load = useAgentStore(s => s.load);
  const loaded = useAgentStore(s => s.loaded);
  const outbox = useAgentStore(s => s.outbox);
  const online = useNet(s => s.online);
  const tradeable = useRef<{ net: string; tokens: TradeableToken[] }>({ net: '', tokens: [] });

  // Open the vault, learn the model's state, start watching the network.
  useEffect(() => {
    configureNotifications();
    watchNetwork();
    load().catch(() => {});
    // The model engine starts only when the Agent tab or the Models screen is opened, not at every unlock.
    return () => {
      useModel.getState().unload().catch(() => {});
      useAgentStore.getState().forget();
    };
  }, [load]);

  // A tapped notification opens the Agent tab.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(r => {
      const route = (r.notification.request.content.data as { route?: string } | undefined)?.route;
      if (route === '/agent') router.push('/(app)/(tabs)/agent');
    });
    return () => sub.remove();
  }, [router]);

  // The offline snapshot, refreshed after each good read of the balances.
  const { assets, prices, positions, loading, refreshing, stale, mode, isMainnet, accountIndex } = portfolio;
  const balancesKey = assets.map(a => `${a.id}=${a.balance}`).join('|');
  useEffect(() => {
    if (!loaded || loading || refreshing || stale.length || !assets.length) return;
    let on = true;
    const net = isMainnet ? 'mainnet' : 'chipnet';
    (async () => {
      if (online !== false) {
        const tokens = await getTradeableTokens(net).catch(() => [] as TradeableToken[]);
        if (tokens.length) tradeable.current = { net, tokens };
      }
      if (!on) return;
      const keep = tradeable.current.net === net ? tradeable.current.tokens : [];
      const previous = useAgentStore.getState().snapshot;
      const activity = await readActivity().catch(() => []);
      if (!on) return;
      useAgentStore.getState().saveSnapshot(buildSnapshot({
        at: Date.now(), mode, accountIndex, assets: assetsForAgent(assets, prices), prices, positions, activity, tradeable: keep,
        // Offline, keep the token prices we had rather than forget them.
        previousTokens: previous?.mode === mode ? previous.tokens : undefined,
      }));
    })();
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, loading, refreshing, stale.length, balancesKey, mode, accountIndex, positions.length, online]);

  // Back online with actions waiting: a banner here, a notification if the app is in the background.
  const queued = outbox.filter(i => i.status === 'queued').length;
  const wasOnline = useRef<boolean | null>(null);
  useEffect(() => {
    const before = wasOnline.current;
    wasOnline.current = online;
    if (online === false) { resetReminder(); return; }
    if (online && before === false && queued > 0) {
      useAgentUi.getState().showBackOnline(queued);
      if (AppState.currentState === 'active') thud();
      else notifyBackOnline(queued).catch(() => {});
    }
  }, [online, queued]);

  useEffect(() => { if (loaded) syncBackgroundCheck(queued).catch(() => {}); }, [loaded, queued]);

  return <>{children}</>;
}
