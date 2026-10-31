/**
 * The wallet's state as the app's screens need it, on top of WDK's.
 *
 * WDK reports NO_WALLET both when nothing was ever created and when a stored wallet is not loaded yet. The two
 * lead to different screens (onboarding, unlock), so the stored-wallet list decides between them.
 */
import { useCallback, useMemo } from 'react';
import { useWalletManager, useWdkApp } from '@tetherto/wdk-react-native-core';
import { DEFAULT_WALLET_ID } from './config';

export type SessionStatus = 'loading' | 'noWallet' | 'locked' | 'unlocked' | 'error';

export function useSession(): { status: SessionStatus } {
  const { state } = useWdkApp();
  const { wallets } = useWalletManager();
  const stored = Array.isArray(wallets) && wallets.some(w => w.identifier === DEFAULT_WALLET_ID);

  let status: SessionStatus;
  switch (state.status) {
    case 'NO_WALLET': status = stored ? 'locked' : 'noWallet'; break;
    case 'LOCKED': status = 'locked'; break;
    case 'READY': status = 'unlocked'; break;
    case 'ERROR': status = 'error'; break;
    default: status = 'loading';
  }
  return { status };
}

export function useWalletActions() {
  const wm = useWalletManager();

  /** Store a phrase as the wallet and load it. Replaces a wallet left behind by an unfinished attempt. */
  const createFromPhrase = useCallback(async (phrase: string): Promise<void> => {
    const words = phrase.trim().toLowerCase().split(/\s+/).join(' ');
    try {
      await wm.restoreWallet(words, DEFAULT_WALLET_ID);
    } catch (e) {
      if (!/already exists/i.test((e as Error)?.message ?? '')) throw e;
      await wm.deleteWallet(DEFAULT_WALLET_ID);
      await wm.restoreWallet(words, DEFAULT_WALLET_ID);
    }
    await wm.unlock(DEFAULT_WALLET_ID);
  }, [wm]);

  return useMemo(() => ({
    generatePhrase: (words: 12 | 24 = 12): Promise<string> => wm.generateMnemonic(words),
    createFromPhrase,
    /** Loads the seed into the worklet. The phone may ask for its own fingerprint or passcode here. */
    unlock: (): Promise<void> => wm.unlock(DEFAULT_WALLET_ID),
    lock: (): Promise<void> => wm.lock(),
    getPhrase: (): Promise<string | null> => wm.getMnemonic(DEFAULT_WALLET_ID),
    deleteWallet: (): Promise<void> => wm.deleteWallet(DEFAULT_WALLET_ID),
    hasActiveWallet: !!wm.activeWalletId,
  }), [wm, createFromPhrase]);
}
