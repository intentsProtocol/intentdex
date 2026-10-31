/**
 * What feeds the Activity tab besides the wallet's own record: history read from the chains, and the follow-up
 * of entries that are still pending.
 *
 * The wallet's record (the shared package's activity.ts) is written the moment something is signed. This module
 * adds what the record cannot know: payments that arrived, and how a pending send, swap or bridge ended.
 */
import { getNetwork, networkOf, networksFor, type NetworkMode } from '@bch-intents/wallet-core/chains';
import { readActivity, updateActivity, type ActivityEntry } from '@bch-intents/wallet-core/activity';
import { formatAmount } from '@bch-intents/wallet-core/format';
import { cashtokenRelayerUrl } from '@bch-intents/wallet-core/platform';
import { swapServerApiFor } from '@bch-intents/wallet-core/swap/api';
import { createRelayerApi, TERMINAL_INTENT } from '@bch-intents/wallet-core/swap/cashtoken';
import { feeIsDue } from '@bch-intents/wallet-core/swap/flows';
import type { T } from '@/i18n';
import { getSwapConfig } from '@/swap/runtime';
import { call } from '@/wdk/bridge';
import { evmRpc, solRpc } from './rpc';

/** What a bridge row can still do. */
export interface BridgeAction { kind: 'payFee' | 'resume'; transferId: string; srcKey: string }

interface BchTransfer { txid: string; height: number; timestamp?: number; delta: string; tokens: { category: string; delta: string }[]; nfts?: { category: string; delta: number }[] }
interface BtcTransfer { txid: string; height?: number; value?: string | number; direction?: string }

/** Incoming and outgoing payments of the two UTXO chains, read by their wallet modules. */
export async function loadChainHistory(mode: NetworkMode, accountIndex: number, account: string, t: T): Promise<ActivityEntry[]> {
  const out: ActivityEntry[] = [];
  const bch = networkOf(mode, 'bch');
  const btc = networkOf(mode, 'btc');
  await Promise.all([
    (async () => {
      const items = await call<BchTransfer[]>(bch.key, accountIndex, 'getTransfers', { limit: 20 }).catch(() => [] as BchTransfer[]);
      for (const h of items ?? []) {
        const delta = BigInt(h.delta ?? '0');
        const tokens = (h.tokens ?? []).filter(x => BigInt(x.delta ?? '0') !== 0n);
        const nfts = (h.nfts ?? []).filter(x => x.delta !== 0);
        if (delta === 0n && !tokens.length && !nfts.length) continue;
        const incoming = delta > 0n || (delta === 0n && (tokens.some(x => BigInt(x.delta) > 0n) || nfts.some(x => x.delta > 0)));
        const text = `${formatAmount(delta < 0n ? -delta : delta, 8, 8)} BCH`;
        const nftCount = nfts.reduce((n, x) => n + Math.abs(x.delta), 0);
        out.push({
          id: `chain_${h.txid}`, kind: incoming ? 'receive' : 'send', status: h.height > 0 ? 'confirmed' : 'pending', network: bch.key, account,
          at: h.timestamp ? h.timestamp * 1000 : Date.now(), txid: h.txid,
          ...(incoming ? { received: text } : { sent: text }),
          note: nftCount ? t('activity.withNfts', { count: nftCount }) : tokens.length ? t('activity.withTokens', { count: tokens.length }) : undefined,
        });
      }
    })(),
    (async () => {
      const items = await call<BtcTransfer[]>(btc.key, accountIndex, 'getTransfers', { limit: 20 }).catch(() => [] as BtcTransfer[]);
      for (const h of items ?? []) {
        if (!h?.txid || h.value === undefined) continue;
        const incoming = h.direction === 'incoming';
        const text = `${formatAmount(BigInt(h.value), 8, 8)} BTC`;
        out.push({
          // A transaction can pay several of our outputs; one row per transaction and direction is enough.
          id: `chain_${h.txid}_${h.direction ?? ''}`, kind: incoming ? 'receive' : 'send', status: h.height && h.height > 0 ? 'confirmed' : 'pending',
          network: btc.key, account, at: Date.now() - out.length, txid: h.txid, ...(incoming ? { received: text } : { sent: text }),
        });
      }
    })(),
  ]);
  return out;
}

/** Settle the wallet's pending entries against the services and chains. Returns what each bridge row can do. */
export async function reconcileActivity(mode: NetworkMode, account: string, t: T): Promise<Record<string, BridgeAction>> {
  const keys = networksFor(mode).map(n => n.key);
  const pending = (await readActivity()).filter(e => e.status === 'pending' && e.account === account && keys.includes(e.network));
  if (!pending.length) return {};
  const isMainnet = mode === 'mainnet';
  const api = swapServerApiFor(isMainnet);
  const config = api && pending.some(e => e.ref?.product === 'cctp') ? await getSwapConfig(api).catch(() => undefined) : undefined;
  const relayerUrl = cashtokenRelayerUrl(isMainnet);
  const found: Record<string, BridgeAction> = {};

  await Promise.all(pending.map(async e => {
    try {
      if (e.ref?.product === 'cctp') {
        if (!api) return;
        const tr = await api.getTransfer(e.ref.id);
        const src = config?.cctp.chains.find(c => c.key === tr.src);
        if (tr.status === 'COMPLETED' || tr.status === 'COMPLETED_EXTERNAL') return updateActivity(e.id, { status: 'confirmed', received: `${tr.display.received ?? tr.display.expectedReceive} USDC`, txid: tr.burnTxHash ?? e.txid });
        if (tr.status === 'FAILED' || tr.status === 'EXPIRED') return updateActivity(e.id, { status: 'failed', note: tr.failReason ?? (tr.status === 'EXPIRED' ? t('activity.expired') : undefined) });
        if (src && feeIsDue(tr, src)) found[e.id] = { kind: 'payFee', transferId: tr.id, srcKey: src.key };
        else if (src && tr.status === 'CREATED') found[e.id] = { kind: 'resume', transferId: tr.id, srcKey: src.key };
        return;
      }
      if (e.ref?.product === 'jupiter') {
        if (!api) return;
        const s = await api.getSolSwap(e.ref.id);
        if (s.status === 'COMPLETED') return updateActivity(e.id, { status: 'confirmed', txid: s.signature, received: s.display.outAmount ? `${s.display.outAmount} ${s.display.outSymbol ?? ''}`.trim() : e.received });
        if (s.terminal) return updateActivity(e.id, { status: 'failed', note: s.failReason, txid: s.signature });
        return;
      }
      if (e.ref?.product === 'cashtoken') {
        if (!relayerUrl) return;
        const intent = await createRelayerApi(isMainnet ? 'mainnet' : 'chipnet', relayerUrl).getIntent(e.ref.id);
        if (intent.status === 'filled') return updateActivity(e.id, { status: 'confirmed' });
        if (TERMINAL_INTENT.includes(intent.status)) return updateActivity(e.id, { status: intent.status === 'refunded' ? 'refunded' : 'failed', note: intent.failReason ?? intent.lastSkipReason });
        return;
      }
      const net = getNetwork(e.network);
      if (!net || !e.txid) return;
      const age = Date.now() - e.at;
      if (net.family === 'evm') {
        const receipt = await evmRpc(net).receipt(e.txid);
        if (receipt) return updateActivity(e.id, { status: receipt.status });
        // Never mined and dropped from every mempool after a day: the nonce was reused or the fee too low.
        if (age > 24 * 60 * 60_000) return updateActivity(e.id, { status: 'failed', note: t('activity.dropped') });
      } else if (net.family === 'solana') {
        const st = await solRpc(net).status(e.txid);
        if (st !== 'pending') return updateActivity(e.id, { status: st });
        if (age > 5 * 60_000) return updateActivity(e.id, { status: 'failed', note: t('activity.dropped') });
      } else {
        // Bitcoin and Bitcoin Cash: the node accepted the transaction when it was sent, and the chain's own
        // history, merged into the list, shows it confirming. After a while the wallet's row stops saying "pending".
        if (age > (net.family === 'bch' ? 60_000 : 90 * 60_000)) return updateActivity(e.id, { status: 'confirmed' });
      }
    } catch { /* the service or RPC did not answer: try again next time */ }
  }));
  return found;
}

export { mergeActivity } from './merge-activity';
