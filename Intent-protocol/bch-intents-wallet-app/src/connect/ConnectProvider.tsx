/**
 * Connections to apps and sites, over WalletConnect.
 *
 * An app shows a code; the wallet scans it; from then on the app can ask for a signature and the wallet shows
 * every request on a sheet for the user to approve or reject. Nothing is signed without that tap, and every
 * signature is made inside the wallet worklet.
 *
 * The provider lives under the unlocked part of the app: while the wallet is locked nothing is answered, and
 * requests that arrived in the meantime are shown after unlocking.
 *
 * WalletConnect's client is loaded on first use and only when the build has a project id, so a build without
 * one (or a device where the client cannot start) still runs the rest of the wallet.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { addActivity } from '@bch-intents/wallet-core/activity';
import { networkOf } from '@bch-intents/wallet-core/chains';
import { errorMessage, formatAmount, hostOf, shortAddr } from '@bch-intents/wallet-core/format';
import { toBase64 } from '@bch-intents/wallet-core/swap/encoding';
import { useT } from '@/i18n';
import { REOWN_PROJECT_ID } from '@/lib/config';
import { evmSender } from '@/lib/evm';
import { usePortfolio } from '@/state/portfolio';
import { signSolana } from '@/swap/runtime';
import { Banner, Button, buzz, Card, Line, Pill, Sheet, thud, Txt } from '@/ui/primitives';
import { TokenIcon } from '@/ui/TokenIcon';
import { space, useTheme } from '@/ui/theme';
import { call } from '@/wdk/bridge';
import { buildNamespaces, readRequest, solanaSignatureBase58, type RequestView } from './requests';

export interface ConnectedApp { topic: string; name: string; url: string; icon?: string; expiry: number; chains: string[] }

interface Peer { name: string; url: string; icon?: string }
type Pending =
  | { type: 'proposal'; id: number; peer: Peer; verify: 'valid' | 'unknown' | 'invalid' | 'scam'; raw: any }
  | { type: 'request'; id: number; topic: string; peer: Peer; chain: string; method: string; params: unknown };

interface ConnectValue {
  /** The build has a WalletConnect project id. */
  configured: boolean;
  status: 'idle' | 'starting' | 'ready' | 'failed';
  pairing: boolean;
  error: string;
  sessions: ConnectedApp[];
  /** Start connecting to the app that showed this code. The proposal arrives as an approval sheet. */
  pair: (uri: string) => void;
  disconnect: (topic: string) => Promise<void>;
  disconnectAll: () => Promise<void>;
}

const ConnectContext = createContext<ConnectValue | null>(null);

export function useConnect(): ConnectValue {
  const value = useContext(ConnectContext);
  if (!value) throw new Error('useConnect is used outside the unlocked part of the app');
  return value;
}

const USER_REJECTED = { code: 5000, message: 'User rejected.' };
const UNSUPPORTED = { code: 5101, message: 'Unsupported method.' };
const DISCONNECTED = { code: 6000, message: 'User disconnected.' };

let kitPromise: Promise<any> | null = null;

/** Start WalletConnect once. The modules are required here, not at the top, so they load only when used. */
function startKit(): Promise<any> {
  kitPromise ??= (async () => {
    require('@walletconnect/react-native-compat');
    const { Core } = require('@walletconnect/core');
    const { WalletKit } = require('@reown/walletkit');
    const core = new Core({ projectId: REOWN_PROJECT_ID });
    return WalletKit.init({
      core,
      metadata: {
        name: 'BCH Intents Wallet',
        description: 'A self-custodial wallet for Bitcoin Cash, EVM networks, Solana and Bitcoin',
        url: 'https://bchintents.cash',
        icons: [],
        redirect: { native: 'bchintents://' },
      },
    });
  })().catch(e => { kitPromise = null; throw e; });
  return kitPromise;
}

const peerOf = (metadata: any): Peer => ({ name: String(metadata?.name ?? 'Unknown app').slice(0, 60), url: String(metadata?.url ?? ''), icon: metadata?.icons?.[0] });

export function ConnectProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { c } = useTheme();
  const { mode, accountIndex, addresses } = usePortfolio();
  const configured = !!REOWN_PROJECT_ID;

  const [status, setStatus] = useState<ConnectValue['status']>('idle');
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState('');
  const [sessions, setSessions] = useState<ConnectedApp[]>([]);
  const [queue, setQueue] = useState<Pending[]>([]);
  const [working, setWorking] = useState(false);
  const [sheetError, setSheetError] = useState('');
  const kit = useRef<any>(null);

  // The handlers below read the latest account and mode without being re-registered.
  const live = useRef({ mode, accountIndex, addresses });
  live.current = { mode, accountIndex, addresses };

  const refreshSessions = useCallback(() => {
    const active = kit.current?.getActiveSessions?.() ?? {};
    setSessions(Object.values(active).map((s: any) => ({
      topic: s.topic, ...peerOf(s.peer?.metadata), expiry: s.expiry * 1000,
      chains: Object.values(s.namespaces ?? {}).flatMap((n: any) => n.chains ?? []),
    })));
  }, []);

  const start = useCallback(async () => {
    if (!configured) return null;
    if (kit.current) return kit.current;
    setStatus('starting');
    try {
      const k = await startKit();
      if (!kit.current) {
        kit.current = k;
        k.on('session_proposal', (p: any) => {
          setPairing(false);
          const v = p.verifyContext?.verified;
          const verify = v?.isScam ? 'scam' : v?.validation === 'VALID' ? 'valid' : v?.validation === 'INVALID' ? 'invalid' : 'unknown';
          setQueue(q => [...q, { type: 'proposal', id: p.id, peer: peerOf(p.params?.proposer?.metadata), verify, raw: p }]);
        });
        k.on('session_request', (r: any) => {
          const session = k.getActiveSessions()[r.topic];
          setQueue(q => [...q, { type: 'request', id: r.id, topic: r.topic, peer: peerOf(session?.peer?.metadata), chain: r.params.chainId, method: r.params.request.method, params: r.params.request.params }]);
        });
        k.on('session_delete', refreshSessions);
        k.on('proposal_expire', (e: any) => setQueue(q => q.filter(x => !(x.type === 'proposal' && x.id === e.id))));
        k.on('session_request_expire', (e: any) => setQueue(q => q.filter(x => !(x.type === 'request' && x.id === e.id))));
      }
      setStatus('ready');
      refreshSessions();
      return k;
    } catch (e) {
      setStatus('failed');
      setError(errorMessage(e, t('connect.failed')));
      return null;
    }
  }, [configured, refreshSessions, t]);

  // Reconnect to the apps of earlier sessions as soon as the wallet is unlocked.
  useEffect(() => { start(); }, [start]);

  const pair = useCallback((uri: string) => {
    setError('');
    if (!configured) { setError(t('connect.notConfigured')); return; }
    if (!/^wc:[0-9a-f-]+@2/i.test(uri.trim())) { setError(t('connect.invalid')); return; }
    setPairing(true);
    (async () => {
      const k = await start();
      if (!k) { setPairing(false); return; }
      try {
        await k.pair({ uri: uri.trim() });
        // The proposal normally follows within a second or two; stop waiting if it never does.
        setTimeout(() => setPairing(false), 20_000);
      } catch (e) {
        setPairing(false);
        setError(errorMessage(e, t('connect.failed')));
      }
    })();
  }, [configured, start, t]);

  const disconnect = useCallback(async (topic: string) => {
    await kit.current?.disconnectSession({ topic, reason: DISCONNECTED }).catch(() => {});
    refreshSessions();
  }, [refreshSessions]);

  const disconnectAll = useCallback(async () => {
    const topics = Object.keys(kit.current?.getActiveSessions?.() ?? {});
    await Promise.all(topics.map(topic => kit.current.disconnectSession({ topic, reason: DISCONNECTED }).catch(() => {})));
    refreshSessions();
  }, [refreshSessions]);

  // An account or mode change: tell connected apps, so none keeps asking the previous account to sign.
  const sessionKey = `${mode}:${accountIndex}:${addresses.evm ?? ''}:${addresses.bch ?? ''}:${addresses.solana ?? ''}`;
  const lastKey = useRef(sessionKey);
  useEffect(() => {
    if (lastKey.current === sessionKey || !addresses.evm) { lastKey.current = sessionKey; return; }
    lastKey.current = sessionKey;
    const k = kit.current;
    if (!k) return;
    for (const session of Object.values(k.getActiveSessions?.() ?? {}) as any[]) {
      const required = session.requiredNamespaces ?? {};
      const wanted = Object.fromEntries(Object.entries(session.namespaces ?? {}).map(([ns, n]: [string, any]) => [ns, { chains: n.chains }]));
      const next = buildNamespaces(required, wanted, mode, addresses);
      // The app's networks do not exist in this mode: the session cannot continue.
      if (!next.ok) { k.disconnectSession({ topic: session.topic, reason: DISCONNECTED }).catch(() => {}); continue; }
      k.updateSession({ topic: session.topic, namespaces: next.namespaces }).catch(() => {});
    }
    setTimeout(refreshSessions, 500);
  }, [sessionKey, mode, addresses, refreshSessions]);

  // ── the request on screen ──

  const current = queue[0];
  const view: RequestView | null = useMemo(
    () => (current?.type === 'request' ? readRequest(current.method, current.params, current.chain, mode, addresses) : null),
    [current, mode, addresses],
  );
  const proposal = useMemo(() => {
    if (current?.type !== 'proposal') return null;
    const params = current.raw.params ?? {};
    return buildNamespaces(params.requiredNamespaces ?? {}, params.optionalNamespaces ?? {}, mode, addresses);
  }, [current, mode, addresses]);

  const next = () => { setQueue(q => q.slice(1)); setSheetError(''); setWorking(false); };

  const respond = (request: Extract<Pending, { type: 'request' }>, body: { result: unknown } | { error: { code: number; message: string } }) =>
    kit.current?.respondSessionRequest({ topic: request.topic, response: { id: request.id, jsonrpc: '2.0', ...body } }).catch(() => {});

  // Requests that need no decision are answered without a sheet.
  useEffect(() => {
    if (current?.type !== 'request' || !view) return;
    if (view.kind === 'addresses') { respond(current, { result: [addresses.bch] }); next(); }
    else if (view.kind === 'switch') { respond(current, { result: null }); next(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, view]);

  const reject = async () => {
    if (!current) return;
    if (current.type === 'proposal') await kit.current?.rejectSession({ id: current.id, reason: USER_REJECTED }).catch(() => {});
    else await respond(current, { error: view?.kind === 'unsupported' ? UNSUPPORTED : USER_REJECTED });
    next();
  };

  const approve = async () => {
    if (!current || working) return;
    setWorking(true);
    setSheetError('');
    const account = addresses.evm ?? '';
    try {
      if (current.type === 'proposal') {
        if (!proposal?.ok) throw new Error(t('approval.error.unsupported'));
        await kit.current.approveSession({ id: current.id, namespaces: proposal.namespaces });
        await addActivity({ kind: 'connect', status: 'confirmed', network: proposal.networks[0]?.key ?? networkOf(mode, 'bch').key, account, origin: hostOf(current.peer.url) || current.peer.name });
        refreshSessions();
        thud();
        next();
        return;
      }
      if (!view || view.kind === 'unsupported' || view.kind === 'addresses' || view.kind === 'switch') throw new Error(t('approval.error.unsupported'));
      const origin = hostOf(current.peer.url) || current.peer.name;
      const net = view.network;
      let result: unknown;

      if (view.kind === 'message') {
        const signature = await call<string>(net.key, accountIndex, 'sign', view.message);
        result = net.family === 'solana' ? { signature: solanaSignatureBase58(signature) } : signature;
        await addActivity({ kind: 'sign', status: 'confirmed', network: net.key, account, origin });
      } else if (view.kind === 'typed') {
        result = await call<string>(net.key, accountIndex, 'signTypedData', { domain: view.domain, types: view.types, message: view.message });
        await addActivity({ kind: 'sign', status: 'confirmed', network: net.key, account, origin });
      } else if (view.kind === 'evmTx') {
        const sent = await evmSender(net, accountIndex).send({ to: view.to, data: view.data, value: view.value, chainId: net.chainId!, minMaxFeePerGasGwei: net.minMaxFeePerGasGwei } as never);
        result = sent.hash;
        await addActivity({ kind: 'send', status: 'pending', network: net.key, account, origin, txid: sent.hash, counterparty: view.to, sent: view.value > 0n ? `${formatAmount(view.value, net.native.decimals, 8)} ${net.native.symbol}` : undefined });
      } else if (view.kind === 'solanaTx') {
        const signed = await signSolana(mode, accountIndex, view.transaction);
        result = { signature: signed.signature, transaction: toBase64(signed.raw) };
        await addActivity({ kind: 'sign', status: 'confirmed', network: net.key, account, origin });
      } else {
        const signed = await call<{ transaction: string; hash: string }>(net.key, accountIndex, 'signPreparedTransaction', { transaction: view.bch.transaction, sourceOutputs: view.bch.sourceOutputs });
        if (view.bch.broadcast) await call(net.key, accountIndex, 'broadcastTransaction', signed.transaction);
        result = { signedTransaction: signed.transaction, signedTransactionHash: signed.hash };
        const out = view.bch.spent - view.bch.returned;
        await addActivity({ kind: view.bch.broadcast ? 'send' : 'sign', status: view.bch.broadcast ? 'pending' : 'confirmed', network: net.key, account, origin, txid: view.bch.broadcast ? signed.hash : undefined, sent: out > 0n ? `${formatAmount(out, 8, 8)} BCH` : undefined });
      }
      await respond(current, { result });
      thud();
      next();
    } catch (e) {
      buzz();
      setSheetError(errorMessage(e, t('approval.error.notAccepted')));
      setWorking(false);
    }
  };

  const value = useMemo<ConnectValue>(() => ({ configured, status, pairing, error, sessions, pair, disconnect, disconnectAll }), [configured, status, pairing, error, sessions, pair, disconnect, disconnectAll]);

  // ── the sheet ──

  const peer = current?.peer;
  const site = peer ? hostOf(peer.url) || peer.name : '';
  const insecure = !!peer?.url && /^http:\/\//i.test(peer.url);
  const visible = !!current && !(view && (view.kind === 'addresses' || view.kind === 'switch'));
  const blocked = current?.type === 'proposal' ? !proposal?.ok : !view || view.kind === 'unsupported';
  const modeName = t(mode === 'mainnet' ? 'network.mainnet' : 'network.testnet');

  const title = !current ? ''
    : current.type === 'proposal' ? t('approval.connect.title')
    : view?.kind === 'message' ? t('approval.sign.title')
    : view?.kind === 'typed' ? t('approval.typed.title')
    : view?.kind === 'evmTx' ? t('approval.tx.title')
    : view?.kind === 'solanaTx' ? t('approval.tx.sign')
    : view?.kind === 'bchTx' ? t(view.bch.broadcast ? 'approval.tx.title' : 'approval.tx.sign')
    : t('approval.request.title', { site });

  const unsupportedText = view?.kind === 'unsupported'
    ? view.reason === 'account' ? t('approval.wrongAccount')
      : view.reason === 'chain' ? t('approval.connect.unsupported', { mode: modeName, chains: current?.type === 'request' ? current.chain : '' })
      : t('approval.method.unsupported', { method: view.method })
    : '';

  return (
    <ConnectContext.Provider value={value}>
      {children}
      <Sheet visible={visible} onClose={reject} title={title} closeLabel={t('approval.reject')} testID="approval">
        {current ? (
          <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <TokenIcon symbol={peer!.name} logo={peer!.icon} size={44} />
              <View style={{ flex: 1 }}>
                <Txt variant="label" numberOfLines={1}>{peer!.name}</Txt>
                <Txt variant="small" tone="mute" numberOfLines={1} testID="approval-origin">{site}</Txt>
              </View>
              {queue.length > 1 ? <Pill label={`+${queue.length - 1}`} /> : null}
            </View>

            {insecure ? <Banner tone="warn">{t('approval.insecure')}</Banner> : null}
            {current.type === 'proposal' && current.verify === 'scam' ? <Banner tone="error">{t('approval.scam')}</Banner> : null}
            {current.type === 'proposal' && (current.verify === 'unknown' || current.verify === 'invalid') ? <Banner tone="warn">{t('approval.unverified')}</Banner> : null}

            {current.type === 'proposal' ? (
              proposal?.ok ? (
                <>
                  <Card padding={space.md}>
                    <Txt variant="micro" tone="mute" style={{ marginBottom: 6 }}>{t('approval.connect.chains')}</Txt>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {proposal.networks.map(n => <Pill key={n.key} label={n.short === n.native.symbol ? n.name : n.short} icon={<TokenIcon symbol={n.short} logo={n.logo} palette={n.palette} size={14} />} />)}
                    </View>
                  </Card>
                  <Card padding={space.md}>
                    <Txt variant="micro" tone="mute">{t('approval.connect.can')}</Txt>
                    <Txt variant="small" style={{ marginTop: 4 }}>• {t('approval.connect.can1')}</Txt>
                    <Txt variant="small">• {t('approval.connect.can2')}</Txt>
                    <Txt variant="micro" tone="mute" style={{ marginTop: space.sm }}>{t('approval.connect.cannot')}</Txt>
                    <Txt variant="small" style={{ marginTop: 4 }}>• {t('approval.connect.cannot1')}</Txt>
                  </Card>
                </>
              ) : <Banner tone="error">{t('approval.connect.unsupported', { mode: modeName, chains: (proposal?.unsupported ?? []).join(', ') })}</Banner>
            ) : null}

            {view?.kind === 'unsupported' ? <Banner tone="error">{unsupportedText}</Banner> : null}

            {view?.kind === 'message' ? (
              <>
                <Card padding={space.md}>
                  <Txt variant="micro" tone="mute" style={{ marginBottom: 6 }}>{t('approval.sign.message')}</Txt>
                  <Txt variant="small" selectable testID="approval-message">{view.message.slice(0, 1500)}</Txt>
                </Card>
                <Txt variant="small" tone="mute">{t('approval.sign.with', { chain: view.network.name })} · {shortAddr(view.address)}</Txt>
                <Banner tone="info">{t('approval.sign.note')}</Banner>
              </>
            ) : null}

            {view?.kind === 'typed' ? (
              <>
                <Card padding={space.md}>
                  <Line label={t('common.network')} value={view.network.name} />
                  <Line label="Domain" value={String(view.domain?.name ?? '—')} />
                  <Line label="Type" value={view.primaryType} />
                  <Txt variant="small" selectable style={{ marginTop: 6 }} numberOfLines={14}>{JSON.stringify(view.message, null, 1)}</Txt>
                </Card>
                <Banner tone="warn">{t('approval.typed.note')}</Banner>
              </>
            ) : null}

            {view?.kind === 'evmTx' ? (
              <>
                <Card padding={space.md}>
                  <Line label={t('common.network')} value={view.network.name} />
                  <Line label={t('send.to')} value={view.to} mono />
                  <Line label={t('approval.tx.value')} value={`${formatAmount(view.value, view.network.native.decimals, 8)} ${view.network.native.symbol}`} />
                  {view.data !== '0x' ? <Line label={t('approval.tx.data')} value={`${view.data.slice(0, 10)}… (${(view.data.length - 2) / 2} bytes)`} mono /> : null}
                </Card>
                {view.data !== '0x' ? <Banner tone="warn" title={t('approval.tx.contract')}>{t('approval.tx.unknown')}</Banner> : null}
              </>
            ) : null}

            {view?.kind === 'solanaTx' ? (
              <>
                <Card padding={space.md}><Line label={t('common.network')} value={view.network.name} /></Card>
                <Banner tone="warn">{t('approval.tx.unknown')}</Banner>
                <Txt variant="small" tone="mute">{t('approval.tx.signNote')}</Txt>
              </>
            ) : null}

            {view?.kind === 'bchTx' ? (
              <>
                {view.bch.userPrompt ? <Banner tone="info">{view.bch.userPrompt}</Banner> : null}
                <Card padding={space.md}>
                  <Line label={t('common.network')} value={view.network.name} />
                  <Line label={t('activity.sent')} value={`${formatAmount(view.bch.spent > view.bch.returned ? view.bch.spent - view.bch.returned : 0n, 8, 8)} BCH`} />
                  <Txt variant="small" tone="mute" style={{ marginTop: 4 }}>{t('approval.tx.inputs', { count: view.bch.inputCount, mine: view.bch.mine.length })}</Txt>
                  <Txt variant="micro" tone="mute" style={{ marginTop: space.sm }}>{t('approval.tx.outputs')}</Txt>
                  {view.bch.outputs.slice(0, 8).map((o, i) => (
                    <Line key={i} label={o.mine ? t('approval.tx.toSelf') : `${shortAddr(o.lockingBytecode, 8, 6)}${o.token ? ' · token' : ''}`} value={`${formatAmount(o.valueSatoshis, 8, 8)} BCH`} />
                  ))}
                </Card>
                {!view.bch.broadcast ? <Txt variant="small" tone="mute">{t('approval.tx.signNote')}</Txt> : null}
              </>
            ) : null}

            {sheetError ? <Banner tone="error">{sheetError}</Banner> : null}

            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button style={{ flex: 1 }} kind="secondary" label={t('approval.reject')} onPress={reject} disabled={working} testID="approval-reject" />
              <Button
                style={{ flex: 1 }} onPress={approve} loading={working} disabled={blocked} testID="approval-approve"
                label={working ? t('approval.working') : current.type === 'proposal' ? t('approval.connect.cta') : view?.kind === 'message' || view?.kind === 'typed' ? t('approval.sign.cta') : t('approval.approve')}
                icon={current.type === 'proposal' && current.verify === 'scam' ? <AlertTriangle size={17} color={c.onPrimary} /> : undefined}
              />
            </View>
          </View>
        ) : null}
      </Sheet>
    </ConnectContext.Provider>
  );
}
