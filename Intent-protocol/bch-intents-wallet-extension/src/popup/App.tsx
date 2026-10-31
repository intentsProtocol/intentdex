/**
 * Wallet UI router — decides which screen to show from the wallet's state and any dapp request waiting.
 *
 * Route priority:
 *   1. Not ready yet → spinner
 *   2. No wallet, or onboarding in progress → Onboarding
 *   3. Locked → Unlock (a waiting dapp request is announced there and shown after unlocking)
 *   4. A dapp request waiting → Approval
 *   5. Wallet screens (Home, Send, Receive, Swap, Activity, Settings)
 *
 * The same component renders in the side panel, the popup, the approval window and the onboarding tab.
 */

import { useEffect, useState } from 'react';
import { useWDK } from '@/context/WDKProvider';
import { MSG, type PendingRequest } from '@/shared/messages';
import { readQueue, watchQueue } from '@/lib/dapp';
import { MX, MPopup, Spinner } from '@/design-system/primitives';
import { Chameleon } from '@/design-system/Chameleon';

import { OnboardingScreen, surfaceOf } from './screens/Onboarding';
import { UnlockScreen }     from './screens/Unlock';
import { HomeScreen }       from './screens/Home';
import { SendScreen }       from './screens/Send';
import { ReceiveScreen }    from './screens/Receive';
import { SwapScreen }       from './screens/Swap';
import { ActivityScreen }   from './screens/Activity';
import { SettingsScreen, type SettingsView } from './screens/Settings';
import { ApprovalScreen }   from './screens/Approval';
import type { Screen }      from './screens/shared';

export default function App() {
  const wdk = useWDK();
  const [screen, setScreen] = useState<Screen>('home');
  const [param, setParam] = useState<string | undefined>();
  const [queue, setQueue] = useState<PendingRequest[]>([]);
  // Onboarding owns the screen from its first step to its last, also after the wallet has been stored.
  const [onboarding, setOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    readQueue().then(setQueue);
    const unwatch = watchQueue(setQueue);
    const onMessage = (message: { type?: string }) => { if (message?.type === MSG.WALLET_LOCKED) wdk.lock(); };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => { unwatch(); chrome.runtime.onMessage.removeListener(onMessage); };
    // wdk.lock is stable enough: it only reads refs and storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (wdk.isReady && onboarding === null) setOnboarding(!wdk.hasStoredWallet);
  }, [wdk.isReady, wdk.hasStoredWallet, onboarding]);

  // The wallet was removed (settings, or "forgot password"): back to the start.
  useEffect(() => {
    if (wdk.isReady && onboarding === false && !wdk.hasStoredWallet && !wdk.isInitialized) setOnboarding(true);
  }, [wdk.isReady, wdk.hasStoredWallet, wdk.isInitialized, onboarding]);

  const navigate = (s: Screen, p?: string) => { setParam(p); setScreen(s); };
  const goHome = () => navigate('home');

  // 1. Starting up
  // Only while the stored wallet and session are being checked. Unlocking shows its own progress: replacing the
  // unlock screen here would remount it and lose the "wrong password" message.
  if (!wdk.isReady || onboarding === null) {
    return (
      <MPopup>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }} data-testid="booting">
          <Chameleon size={120} mood="busy" track={false} />
          <Spinner size={20} color={MX.primary} />
        </div>
      </MPopup>
    );
  }

  // 2. Onboarding
  if (onboarding) {
    return (
      <OnboardingScreen onDone={() => {
        setOnboarding(false);
        // The onboarding tab has done its job once the docked wallet is open next to it.
        if (surfaceOf() === 'tab') window.close();
      }} />
    );
  }

  // 3. Locked
  if (!wdk.isInitialized) return <UnlockScreen pendingCount={queue.length} />;

  // 4. A site is waiting for an answer
  if (queue.length > 0) return <ApprovalScreen key={queue[0].requestId} request={queue[0]} queued={queue.length - 1} />;

  // 5. Wallet screens
  switch (screen) {
    case 'send':     return <SendScreen onBack={goHome} assetId={param} />;
    case 'receive':  return <ReceiveScreen onBack={goHome} assetId={param} />;
    case 'swap':     return <SwapScreen onNavigate={navigate} assetId={param} />;
    case 'activity': return <ActivityScreen onNavigate={navigate} />;
    case 'settings': return <SettingsScreen key={param ?? 'root'} onNavigate={navigate} initialView={(param as SettingsView) ?? 'root'} />;
    default:         return <HomeScreen onNavigate={navigate} />;
  }
}
