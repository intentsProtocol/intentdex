/** Short-lived screen state the agent shares between its provider and its tab. Not saved. */
import { create } from 'zustand';

interface AgentUi {
  /** Set when the phone came back online with actions waiting; the Agent tab shows a banner until dismissed. */
  backOnline: { count: number; at: number } | null;
  showBackOnline(count: number): void;
  dismissBackOnline(): void;
}

export const useAgentUi = create<AgentUi>(set => ({
  backOnline: null,
  showBackOnline: count => set({ backOnline: { count, at: Date.now() } }),
  dismissBackOnline: () => set({ backOnline: null }),
}));
