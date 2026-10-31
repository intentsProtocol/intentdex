/**
 * Hands a scanned address from the scanner back to the screen that opened it. The scanner sets it and closes;
 * the Send screen takes it and clears it.
 */
import { create } from 'zustand';
import type { Scanned } from '@/lib/scan';

type ScannedAddress = Extract<Scanned, { kind: 'address' }>;

interface ScanState {
  result: ScannedAddress | null;
  set: (result: ScannedAddress) => void;
  take: () => ScannedAddress | null;
}

export const useScanResult = create<ScanState>((set, get) => ({
  result: null,
  set: result => set({ result }),
  take: () => {
    const result = get().result;
    if (result) set({ result: null });
    return result;
  },
}));
