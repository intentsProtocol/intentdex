/**
 * Activity — what this account did and received on the active network mode.
 *
 * Two sources, merged by transaction id:
 *   - the wallet's own record (lib/activity.ts): sends, swaps and bridges started here
 *   - chain history for BCH and BTC, which is where incoming payments show up
 *
 * Entries that were still pending when the wallet was last open are reconciled on load: a send against its
 * chain, a swap or bridge against the service that runs it. A bridge that stopped halfway (the view was closed
 * before the fee, say) gets a button to finish it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWDK } from '@/context/WDKProvider';
import { usePortfolio } from '@/context/PortfolioProvider';
import { useT } from '@/context/SettingsProvider';
import { MX, MPopup, MI, Spinner, TokenIcon, Banner, IconBtn, Sheet, MSecondary } from '@/design-system/primitives';
import { MBottomNav, PageHeader, EmptyState, DetailCard, DetailRow, type Screen } from './shared';
import { ACTIVITY_KEY, readActivity, updateActivity, type ActivityEntry, type ActivityStatus } from '@/lib/activity';
import { explorerTxUrl, getNetwork, networkOf, networksFor } from '@/lib/chains';
import { EsploraClient } from '@/lib/btc-esplora';
import { evmProvider } from '@/lib/evm';
import { solTxStatus } from '@/lib/solana';
import { errorMessage, formatAmount, hostOf, shortAddr, timeAgo } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { swapServerApiFor } from '@/swap/api';
import { createRelayerApi, TERMINAL_INTENT } from '@/swap/cashtoken';
import { feeIsDue, payFee, resumeBridge } from '@/swap/flows';
import { bridgeDeps, getSwapConfig } from '@/swap/runtime';

interface ActivityScreenProps { onNavigate: (s: Screen) => void }

/** What a bridge row can still do. */
type BridgeAction = { kind: 'payFee' | 'resume'; transferId: string; srcKey: string };

const KIND_ICON = { send: MI.send, receive: MI.receive, swap: MI.swap, bridge: MI.globe, sign: MI.pencil, connect: MI.plug };
const KIND_LABEL: Record<ActivityEntry['kind'], MessageKey> = {
  send: 'activity.kind.send', receive: 'activity.kind.receive', swap: 'activity.kind.swap', bridge: 'activity.kind.bridge', sign: 'activity.kind.sign', connect: 'activity.kind.connect',
};
const STATUS_LABEL: Record<ActivityStatus, MessageKey> = {
  pending: 'activity.status.pending', confirmed: 'activity.status.confirmed', failed: 'activity.status.failed', refunded: 'activity.status.refunded',
};

function StatusPill({ status }: { status: ActivityStatus }) {
  const t = useT();
  const c = status === 'confirmed' ? { fg: MX.primary, bg: MX.primaryDim } : status === 'pending' ? { fg: MX.amber, bg: MX.amberDim } : status === 'failed' ? { fg: MX.red, bg: MX.redDim } : { fg: MX.fgMute, bg: MX.surface2 };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', borderRadius: 5, background: c.bg, color: c.fg, fontSize: 9.5, fontWeight: 700 }}>
      {status === 'pending' && <Spinner size={8} />}
      {t(STATUS_LABEL[status])}
    </span>
  );
}

export function ActivityScreen({ onNavigate }: ActivityScreenProps) {
  const wdk = useWDK();
  const t = useT();
  const { signers, addresses, refresh: refreshPortfolio } = usePortfolio();
  const mode = wdk.networkMode;
  const account = wdk.evmAddress?.toLowerCase() ?? '';

  const [local, setLocal] = useState<ActivityEntry[]>([]);
  const [chain, setChain] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<ActivityEntry | null>(null);
  const [actions, setActions] = useState<Record<string, BridgeAction>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const modeKeys = useMemo(() => networksFor(mode).map(n => n.key), [mode]);

  const loadLocal = useCallback(async () => {
    const all = await readActivity();
    setLocal(all.filter(e => e.account === account && modeKeys.includes(e.network)));
  }, [account, modeKeys]);

  // Follow writes made by the swap and send screens (and by an approval window open at the same time).
  useEffect(() => {
    loadLocal();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === 'local' && changes[ACTIVITY_KEY]) loadLocal(); };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [loadLocal]);

  // ── chain history: BCH and BTC ──
  const loadChain = useCallback(async () => {
    const out: ActivityEntry[] = [];
    const bchNet = networkOf(mode, 'bch');
    const btcNet = networkOf(mode, 'btc');
    await Promise.all([
      (async () => {
        if (!wdk.bchWallet?.getHistory) return;
        const items: any[] = await wdk.bchWallet.getHistory({ unit: 'sat', count: 25 }).catch(() => []);
        for (const h of items) {
          const delta = BigInt(Math.trunc(Number(h.valueChange ?? 0)));
          const tokenMoves = (h.tokenAmountChanges ?? []).filter((c: any) => BigInt(c.amount ?? 0) !== 0n);
          if (delta === 0n && !tokenMoves.length) continue;
          const incoming = delta > 0n || (delta === 0n && tokenMoves.some((c: any) => BigInt(c.amount) > 0n));
          const abs = delta < 0n ? -delta : delta;
          const text = `${formatAmount(abs, 8, 8)} BCH`;
          out.push({
            id: `chain_${h.hash}`, kind: incoming ? 'receive' : 'send', status: 'confirmed', network: bchNet.key, account,
            at: h.timestamp ? h.timestamp * 1000 : Date.now(), txid: h.hash,
            ...(incoming ? { received: text } : { sent: text }),
            note: tokenMoves.length ? t('activity.withTokens', { count: tokenMoves.length }) : undefined,
          });
        }
      })(),
      (async () => {
        if (!addresses.btc) return;
        const txs = await new EsploraClient(btcNet.rpc).getTransactions(addresses.btc).catch(() => []);
        for (const tx of txs) {
          const inSum = tx.vout.filter(o => o.scriptpubkey_address === addresses.btc).reduce((s, o) => s + o.value, 0);
          const outSum = tx.vin.filter(i => i.prevout?.scriptpubkey_address === addresses.btc).reduce((s, i) => s + (i.prevout?.value ?? 0), 0);
          const delta = inSum - outSum;
          if (delta === 0) continue;
          const text = `${formatAmount(BigInt(Math.abs(delta)), 8, 8)} BTC`;
          out.push({
            id: `chain_${tx.txid}`, kind: delta > 0 ? 'receive' : 'send', status: tx.status.confirmed ? 'confirmed' : 'pending', network: btcNet.key, account,
            at: tx.status.block_time ? tx.status.block_time * 1000 : Date.now(), txid: tx.txid,
            ...(delta > 0 ? { received: text } : { sent: text }),
          });
        }
      })(),
    ]);
    setChain(out);
  }, [mode, wdk.bchWallet, addresses.btc, account, t]);

  // ── reconcile pending local entries ──
  const reconcile = useCallback(async () => {
    const pending = (await readActivity()).filter(e => e.status === 'pending' && e.account === account && modeKeys.includes(e.network));
    const api = swapServerApiFor(mode === 'mainnet');
    const config = api ? await getSwapConfig(api).catch(() => undefined) : undefined;
    const found: Record<string, BridgeAction> = {};
    await Promise.all(pending.map(async e => {
      try {
        if (e.ref?.product === 'cctp' && api) {
          const tr = await api.getTransfer(e.ref.id);
          const src = config?.cctp.chains.find(c => c.key === tr.src);
          if (tr.status === 'COMPLETED' || tr.status === 'COMPLETED_EXTERNAL') return updateActivity(e.id, { status: 'confirmed', received: `${tr.display.received ?? tr.display.expectedReceive} USDC`, txid: tr.burnTxHash ?? e.txid, note: undefined });
          if (tr.status === 'FAILED' || tr.status === 'EXPIRED') return updateActivity(e.id, { status: 'failed', note: tr.failReason ?? (tr.status === 'EXPIRED' ? t('activity.expired') : undefined) });
          if (src && feeIsDue(tr, src)) found[e.id] = { kind: 'payFee', transferId: tr.id, srcKey: src.key };
          else if (src && tr.status === 'CREATED') found[e.id] = { kind: 'resume', transferId: tr.id, srcKey: src.key };
          return;
        }
        if (e.ref?.product === 'jupiter' && api) {
          const s = await api.getSolSwap(e.ref.id);
          if (s.status === 'COMPLETED') return updateActivity(e.id, { status: 'confirmed', txid: s.signature, received: s.display.outAmount ? `${s.display.outAmount} ${s.display.outSymbol ?? ''}`.trim() : e.received });
          if (s.terminal) return updateActivity(e.id, { status: 'failed', note: s.failReason, txid: s.signature });
          return;
        }
        if (e.ref?.product === 'cashtoken') {
          const intent = await createRelayerApi(mode === 'mainnet' ? 'mainnet' : 'chipnet').getIntent(e.ref.id);
          if (intent.status === 'filled') return updateActivity(e.id, { status: 'confirmed' });
          if (TERMINAL_INTENT.includes(intent.status)) return updateActivity(e.id, { status: intent.status === 'refunded' ? 'refunded' : 'failed', note: intent.failReason ?? intent.lastSkipReason });
          return;
        }
        const net = getNetwork(e.network);
        if (!net || !e.txid) return;
        if (net.family === 'evm') {
          const receipt = await evmProvider(net).getTransactionReceipt(e.txid);
          if (receipt) return updateActivity(e.id, { status: receipt.status === 1 ? 'confirmed' : 'failed' });
          // Never mined and dropped from every mempool after a day: the nonce was reused or the fee too low.
          if (Date.now() - e.at > 24 * 60 * 60_000) return updateActivity(e.id, { status: 'failed', note: t('activity.dropped') });
        } else if (net.family === 'solana') {
          const st = await solTxStatus(net, e.txid);
          if (st !== 'pending') return updateActivity(e.id, { status: st });
          if (Date.now() - e.at > 5 * 60_000) return updateActivity(e.id, { status: 'failed', note: t('activity.dropped') });
        } else if (net.family === 'btc') {
          const txs = addresses.btc ? await new EsploraClient(net.rpc).getTransactions(addresses.btc) : [];
          if (txs.find(x => x.txid === e.txid)?.status.confirmed) return updateActivity(e.id, { status: 'confirmed' });
        } else {
          return updateActivity(e.id, { status: 'confirmed' });
        }
      } catch { /* the service or RPC did not answer: try again next time */ }
    }));
    setActions(found);
  }, [account, modeKeys, mode, addresses.btc, t]);

  const reload = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadChain(), reconcile()]);
    await loadLocal();
    setLoading(false);
  }, [loadChain, reconcile, loadLocal]);

  useEffect(() => {
    reload();
    const id = setInterval(() => { if (document.visibilityState === 'visible') reconcile().then(loadLocal); }, 12_000);
    return () => clearInterval(id);
  }, [reload, reconcile, loadLocal]);

  const runAction = async (entry: ActivityEntry, action: BridgeAction) => {
    setBusy(entry.id);
    setActionError('');
    try {
      const api = swapServerApiFor(mode === 'mainnet');
      const config = api ? await getSwapConfig(api) : undefined;
      const src = config?.cctp.chains.find(c => c.key === action.srcKey);
      if (!src) throw new Error(t('activity.bridgeUnavailable'));
      const deps = await bridgeDeps(mode === 'mainnet', signers);
      if (action.kind === 'payFee') await payFee(action.transferId, src, deps);
      else await resumeBridge(action.transferId, src, deps);
      await reconcile();
      await loadLocal();
      refreshPortfolio();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  // The wallet's own record wins over the chain's copy of the same transaction: it knows what the send was for.
  const entries = useMemo(() => {
    const known = new Set(local.map(e => e.txid).filter(Boolean));
    return [...local, ...chain.filter(e => !known.has(e.txid))].sort((a, b) => b.at - a.at);
  }, [local, chain]);

  return (
    <MPopup>
      <PageHeader
        title={t('activity.title')}
        right={<IconBtn label={t('common.refresh')} onClick={reload} testId="activity-refresh"><span style={{ display: 'flex', animation: loading ? 'mxspin 0.8s linear infinite' : undefined }}><MI.refresh size={13} /></span></IconBtn>}
      />

      <div data-testid="activity-list" style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {actionError && <Banner tone="error">{actionError}</Banner>}
        {loading && entries.length === 0 && <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={22} color={MX.primary} /></div>}
        {!loading && entries.length === 0 && <EmptyState icon={<MI.activity size={28} />} title={t('activity.empty.title')} body={t('activity.empty.body')} />}

        {entries.map(e => {
          const net = getNetwork(e.network);
          const Icon = KIND_ICON[e.kind];
          const action = actions[e.id];
          const amountText = e.kind === 'receive' ? `+${e.received}` : e.kind === 'swap' || e.kind === 'bridge' ? `${e.sent} → ${e.received}` : e.sent ? `−${e.sent}` : '';
          return (
            <div key={e.id} data-testid={`activity-${e.kind}`} style={{ background: MX.surface, border: `1px solid ${MX.border}`, borderRadius: 13, overflow: 'hidden' }}>
              <button type="button" onClick={() => setOpen(e)} className="mx-press" style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 10px', background: 'transparent', border: 'none', color: MX.fg, cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: e.kind === 'receive' ? MX.primaryDim : MX.surface2, color: e.kind === 'receive' ? MX.primary : MX.fgMute, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={14} />
                  </div>
                  {net && <div style={{ position: 'absolute', right: -5, bottom: -4 }}><TokenIcon symbol={net.short} logo={net.logo} palette={net.palette} size={15} /></div>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700 }}>{t(KIND_LABEL[e.kind])}</span>
                    {e.status !== 'confirmed' && <StatusPill status={e.status} />}
                  </div>
                  <div style={{ fontSize: 10.5, color: MX.fgMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.origin ? hostOf(e.origin) : e.counterparty ? t('activity.to', { address: shortAddr(e.counterparty, 6, 4) }) : net?.name} · {timeAgo(e.at)}
                  </div>
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right', maxWidth: '46%', overflowWrap: 'anywhere', color: e.kind === 'receive' ? MX.primary : MX.fg }}>
                  {amountText}
                </div>
              </button>
              {action && (
                <div style={{ padding: '0 10px 10px' }}>
                  <MSecondary h={34} loading={busy === e.id} onClick={() => runAction(e, action)} testId={`activity-${action.kind}`} style={{ color: MX.amber, borderColor: MX.amberBorder, background: MX.amberDim }}>
                    {action.kind === 'payFee' ? t('activity.payFee') : t('activity.resume')}
                  </MSecondary>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <MBottomNav active="activity" onNavigate={onNavigate} />

      {open && (() => {
        const net = getNetwork(open.network);
        const to = open.toNetwork ? getNetwork(open.toNetwork) : undefined;
        return (
          <Sheet title={t(KIND_LABEL[open.kind])} onClose={() => setOpen(null)} testId="activity-detail">
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <DetailCard>
                <DetailRow label={t('activity.status')} value={<StatusPill status={open.status} />} />
                {open.sent && <DetailRow label={t('activity.sent')} value={open.sent} />}
                {open.received && <DetailRow label={open.status === 'confirmed' ? t('activity.received') : t('activity.expected')} value={open.received} />}
                {net && <DetailRow label={to ? t('activity.from') : t('common.network')} value={net.name} />}
                {to && <DetailRow label={t('activity.toNetwork')} value={to.name} />}
                {open.counterparty && <DetailRow label={t('send.to')} value={<span style={{ fontFamily: MX.mono, fontSize: 10.5 }}>{open.counterparty}</span>} />}
                {open.origin && <DetailRow label={t('activity.site')} value={hostOf(open.origin)} />}
                <DetailRow label={t('activity.time')} value={new Date(open.at).toLocaleString()} />
                {open.txid && <DetailRow label={t('send.txid')} value={<span style={{ fontFamily: MX.mono, fontSize: 10.5 }}>{shortAddr(open.txid, 10, 8)}</span>} />}
              </DetailCard>
              {open.note && <Banner tone={open.status === 'failed' ? 'error' : 'info'}>{open.note}</Banner>}
              {open.txid && net && (
                <a href={explorerTxUrl(net, open.txid)} target="_blank" rel="noreferrer" style={{ color: MX.primary, fontSize: 12, fontWeight: 700, textDecoration: 'none', display: 'inline-flex', gap: 5, alignItems: 'center', justifyContent: 'center' }}>
                  <MI.ext size={13} /> {t('home.viewOnExplorer')}
                </a>
              )}
            </div>
          </Sheet>
        );
      })()}
    </MPopup>
  );
}
