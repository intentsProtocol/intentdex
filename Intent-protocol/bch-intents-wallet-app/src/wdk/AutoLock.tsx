/**
 * Locks the wallet after it has been in the background for the time chosen in Settings, and sends a locked
 * wallet to the unlock screen.
 *
 * Locking disposes the seed inside the worklet; unlocking loads it again from the phone's keychain. "At once"
 * locks the moment the app is left. Only a real trip to the background counts: the system's own sheets (a
 * fingerprint prompt, a permission question, the share sheet) leave the app "inactive", not in the background.
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useRouter } from 'expo-router';
import { useSettingsStore } from '@/state/settings';
import { useSession, useWalletActions } from './session';

export function AutoLock() {
  const router = useRouter();
  const { status } = useSession();
  const { lock } = useWalletActions();
  const minutes = useSettingsStore(s => s.settings.autoLockMinutes);
  const leftAt = useRef<number | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (statusRef.current !== 'unlocked') { leftAt.current = null; return; }
      if (next === 'background') {
        leftAt.current = Date.now();
        if (minutes === 0) lock().catch(() => {});
        return;
      }
      if (next === 'active' && leftAt.current !== null) {
        const away = Date.now() - leftAt.current;
        leftAt.current = null;
        if (minutes > 0 && away >= minutes * 60_000) lock().catch(() => {});
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [lock, minutes]);

  // Whatever locked the wallet, the unlock screen is where a locked wallet belongs.
  const previous = useRef(status);
  useEffect(() => {
    if (status === 'locked' && previous.current === 'unlocked') router.replace('/unlock');
    previous.current = status;
  }, [status, router]);

  return null;
}
