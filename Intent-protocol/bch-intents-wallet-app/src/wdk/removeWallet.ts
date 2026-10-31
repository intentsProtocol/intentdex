/**
 * Removing the wallet from this phone: the seed from WDK's keychain storage, the PIN record, and everything
 * the app stored (settings, accounts, activity, dapp connections). The funds stay on the blockchains; only the
 * recovery phrase reaches them again.
 */
import { useCallback } from 'react';
import { useAgentStore } from '@/agent/store';
import { clearAppStore } from '@/lib/storage';
import { useAccounts } from '@/state/accounts';
import { useSettingsStore } from '@/state/settings';
import { forgetJournal } from '@/swap/runtime';
import { clearPin } from './pin';
import { useWalletActions } from './session';

export function useRemoveWallet() {
  const { deleteWallet, lock } = useWalletActions();
  const resetSettings = useSettingsStore(s => s.reset);
  const resetAccounts = useAccounts(s => s.reset);
  return useCallback(async () => {
    await lock().catch(() => {});
    await deleteWallet();
    await clearPin();
    await useAgentStore.getState().wipe();
    await clearAppStore();
    forgetJournal();
    resetSettings();
    resetAccounts();
  }, [deleteWallet, lock, resetSettings, resetAccounts]);
}
