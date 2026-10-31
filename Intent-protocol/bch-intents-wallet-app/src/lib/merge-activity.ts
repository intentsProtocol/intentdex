import type { ActivityEntry } from '@bch-intents/wallet-core/activity';

/** The wallet's own record wins over the chain's copy of the same transaction: it knows what the send was for. */
export function mergeActivity(local: ActivityEntry[], chain: ActivityEntry[]): ActivityEntry[] {
  const known = new Set(local.map(e => e.txid).filter(Boolean));
  return [...local, ...chain.filter(e => !known.has(e.txid))].sort((a, b) => b.at - a.at);
}
