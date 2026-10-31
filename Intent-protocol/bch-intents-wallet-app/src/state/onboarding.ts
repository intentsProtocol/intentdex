/**
 * The recovery phrase while a wallet is being set up. Held in memory only, between the screen that shows or
 * takes it and the one that stores it, and cleared the moment the wallet exists. It is never put in the
 * navigation state, where it could be written to disk or to a crash report.
 */
import { create } from 'zustand';

interface OnboardingState {
  phrase: string;
  kind: 'create' | 'import';
  /** The user typed the three check words. */
  backedUp: boolean;
  begin: (kind: 'create' | 'import', phrase: string) => void;
  setBackedUp: (v: boolean) => void;
  clear: () => void;
}

export const useOnboarding = create<OnboardingState>(set => ({
  phrase: '',
  kind: 'create',
  backedUp: false,
  begin: (kind, phrase) => set({ kind, phrase, backedUp: kind === 'import' }),
  setBackedUp: backedUp => set({ backedUp }),
  clear: () => set({ phrase: '', backedUp: false }),
}));
