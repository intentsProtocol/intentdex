/**
 * Is the phone online? The agent works either way; this only decides whether a drafted action can be
 * reviewed now or waits in the outbox, and when to say "back online".
 */
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { create } from 'zustand';

interface NetState { online: boolean | null; since: number }

export const useNet = create<NetState>(() => ({ online: null, since: Date.now() }));

const isOnline = (s: NetInfoState) => !!s.isConnected && s.isInternetReachable !== false;

let started = false;
/** Starts the one listener the app needs. Safe to call more than once. */
export function watchNetwork(): void {
  if (started) return;
  started = true;
  NetInfo.fetch().then(s => useNet.setState({ online: isOnline(s), since: Date.now() })).catch(() => {});
  NetInfo.addEventListener(s => {
    const online = isOnline(s);
    if (useNet.getState().online !== online) useNet.setState({ online, since: Date.now() });
  });
}

export const useOnline = () => useNet(s => s.online !== false);

export async function checkOnline(): Promise<boolean> {
  try { return isOnline(await NetInfo.fetch()); } catch { return false; }
}
