/**
 * Approval — a site asked for something and the user decides.
 *
 *   bch_requestAccounts                 connect this site to the active account
 *   bch_sendTransaction                 send BCH or a CashToken
 *   bch_signTransaction                 sign a transaction the site built (lib/bch-sign.ts)
 *   personal_sign, bch_signMessage      sign a message with the Bitcoin Cash key
 *   wallet_signMessage                  sign a message with the key of any supported chain
 *   wallet_sendTransaction              send an asset on any supported network
 *
 * The screen shows what will happen in the wallet's own words, never the site's: the origin comes from the
 * browser, the recipient and amount from the request parameters, and the account and network from the wallet.
 * Signing happens here, in the wallet view, because this is where the keys are.
 */

import { useEffect, useMemo, useState } from 'react';
import { useWDK } from '@/context/WDKProvider';
import { usePortfolio } from '@/context/PortfolioProvider';
import { useT } from '@/context/SettingsProvider';
import { MPopup, MPrimary, MSecondary, MX, MI, Banner, TokenIcon, ChainGlyph, CHAIN, Spinner } from '@/design-system/primitives';
import { Avatar, NetworkPill, DetailCard, DetailRow } from './shared';
import { MSG, SIGN_CHAINS, type ApprovalResult, type PendingRequest, type SignChain } from '@/shared/messages';
import { getGrad, getLabel } from '@/lib/account-store';
import { addActivity } from '@/lib/activity';
import type { Asset } from '@/lib/assets';
import { getTokenMetas, normalizeCategory, type TokenMeta } from '@/lib/cashtokens';
import { FAMILY_PALETTE, getNetwork, networkOf, type Family, type NetworkDef } from '@/lib/chains';
import { errorMessage, formatAmount, hostOf, shortAddr } from '@/lib/format';
import { BCH_DUST, normalizeRecipient, quoteSend, sendAsset, validateAddress, type SendQuote } from '@/lib/send';
import { cashAddressChecksumOk } from '@bch-intents/wallet-core/validation';
import type { SignTxOutput, SignTxRequest, SignTxSummary } from '@/lib/bch-sign';

interface Props {
  request: PendingRequest;
  /** How many more requests wait behind this one. */
  queued: number;
}

// ── request parsing: everything a site sent is checked here, before anything is shown as a fact ──

interface BchSend { to: string; satoshis: bigint; token?: { category: string; amount: bigint } }

function parseBchSend(params: unknown[] | undefined): BchSend | string {
  const p = params?.[0] as Record<string, any> | undefined;
  if (!p || typeof p !== 'object') return 'The transaction has no parameters.';
  const to = String(p.to ?? p.cashaddr ?? '').trim();
  if (!/^(bitcoincash:|bchtest:)?[qpzr][a-z0-9]{41,}$/.test(to)) return 'The recipient is not a valid Bitcoin Cash address.';
  // With a prefix, the checksum can be checked here. A bare address is checked once the network is known.
  if (to.includes(':') && !cashAddressChecksumOk(to.slice(0, to.indexOf(':')), to.slice(to.indexOf(':') + 1))) return 'The recipient address has a typo: its checksum does not match.';
  try {
    const satoshis = BigInt(p.satoshis ?? 0);
    if (satoshis < 0n) return 'The amount is negative.';
    if (!p.token) {
      if (satoshis < BCH_DUST) return `The amount is below the network minimum of ${BCH_DUST} satoshis.`;
      return { to, satoshis };
    }
    const category = normalizeCategory(String(p.token.category ?? ''));
    const amount = BigInt(p.token.amount ?? 0);
    if (!/^[0-9a-f]{64}$/.test(category)) return 'The token category is not valid.';
    if (amount <= 0n) return 'The token amount must be above zero.';
    return { to, satoshis, token: { category, amount } };
  } catch {
    return 'An amount in the transaction is not a whole number.';
  }
}

interface AnySend { network: NetworkDef; to: string; amount: bigint; token?: string }

function parseAnySend(params: unknown[] | undefined, mode: 'testnet' | 'mainnet'): AnySend | string {
  const p = params?.[0] as Record<string, any> | undefined;
  if (!p || typeof p !== 'object') return 'The transaction has no parameters.';
  const network = getNetwork(String(p.network ?? ''));
  if (!network) return `Unknown network: ${String(p.network ?? '')}`;
  if (network.mode !== mode) return `${network.name} is a ${network.mode} network and the wallet is on ${mode}.`;
  const to = String(p.to ?? '').trim();
  if (!to) return 'The transaction has no recipient.';
  try {
    const amount = BigInt(p.amount ?? 0);
    if (amount <= 0n) return 'The amount must be above zero.';
    return { network, to, amount, token: p.token ? String(p.token) : undefined };
  } catch {
    return 'The amount is not a whole number of base units.';
  }
}

function parseSign(method: string, params: unknown[] | undefined): { chain: SignChain; message: string } | string {
  if (method !== 'wallet_signMessage') return { chain: 'bch', message: decodeMessage(params?.[0]) };
  const p = params?.[0] as Record<string, any> | undefined;
  if (!p || typeof p !== 'object') return 'The request has no parameters.';
  if (!SIGN_CHAINS.includes(p.chain)) return `Unknown chain: ${String(p.chain)}. Use one of ${SIGN_CHAINS.join(', ')}.`;
  if (typeof p.message !== 'string' || !p.message) return 'The request has no message to sign.';
  return { chain: p.chain as SignChain, message: decodeMessage(p.message) };
}

function decodeMessage(raw: unknown): string {
  if (typeof raw !== 'string') return String(raw ?? '');
  if (/^0x([0-9a-fA-F]{2})*$/.test(raw) && raw.length > 2) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(raw.slice(2).match(/.{2}/g)!.map(b => parseInt(b, 16)))); } catch { return raw; }
  }
  return raw;
}

const answer = (result: ApprovalResult) => chrome.runtime.sendMessage({ type: MSG.APPROVAL_RESULT, result });

const CHAIN_FAMILY: Record<SignChain, Family> = { bch: 'bch', evm: 'evm', solana: 'solana', btc: 'btc' };

export function ApprovalScreen({ request, queued }: Props) {
  const wdk = useWDK();
  const t = useT();
  const { assets, refresh, signers, addresses, loading: portfolioLoading, nativeOf } = usePortfolio();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState<TokenMeta | undefined>();
  const [quote, setQuote] = useState<SendQuote | null>(null);
  const [raw, setRaw] = useState<{ req: SignTxRequest; summary: SignTxSummary } | string | null>(null);
  const [rawMetas, setRawMetas] = useState<Record<string, TokenMeta>>({});

  const isConnect = request.method === 'bch_requestAccounts';
  const isBchSend = request.method === 'bch_sendTransaction';
  const isAnySend = request.method === 'wallet_sendTransaction';
  const isRawSign = request.method === 'bch_signTransaction';
  const isSign = request.method === 'personal_sign' || request.method === 'bch_signMessage' || request.method === 'wallet_signMessage';

  const bchParsed = useMemo(() => (isBchSend ? parseBchSend(request.params) : null), [isBchSend, request.params]);
  const anyParsed = useMemo(() => (isAnySend ? parseAnySend(request.params, wdk.networkMode) : null), [isAnySend, request.params, wdk.networkMode]);
  const signParsed = useMemo(() => (isSign ? parseSign(request.method, request.params) : null), [isSign, request.method, request.params]);

  const tx = bchParsed && typeof bchParsed !== 'string' ? bchParsed : null;
  const xtx = anyParsed && typeof anyParsed !== 'string' ? anyParsed : null;
  const sign = signParsed && typeof signParsed !== 'string' ? signParsed : null;
  const rtx = raw && typeof raw !== 'string' ? raw : null;
  const parseError = [bchParsed, anyParsed, signParsed, typeof raw === 'string' ? raw : null].find((x): x is string => typeof x === 'string') ?? '';

  const bchNetwork = networkOf(wdk.networkMode, 'bch');
  const bchNet = wdk.isMainnet ? 'mainnet' : 'chipnet';

  // ── bch_signTransaction: the summary is made from the transaction itself, not from what the site says about it ──
  useEffect(() => {
    if (!isRawSign || !wdk.bchAddress) return;
    let on = true;
    import('@/lib/bch-sign').then(m => {
      if (!on) return;
      const req = m.parseSignRequest(request.params);
      if (typeof req === 'string') { setRaw(req); return; }
      const summary = m.summarizeSignRequest(req, wdk.bchAddress!);
      setRaw({ req, summary });
      const categories = [...new Set([...summary.tokens.map(x => x.category), ...summary.outputs.flatMap(o => (o.token ? [o.token.category] : []))])];
      if (categories.length) getTokenMetas(categories, bchNet).then(metas => { if (on) setRawMetas(metas); });
    }).catch(e => { if (on) setRaw(errorMessage(e)); });
    return () => { on = false; };
  }, [isRawSign, request.params, wdk.bchAddress, bchNet]);
  const rawNothing = !!rtx && rtx.summary.ownInputs + rtx.summary.contractInputs === 0;
  const outputAmount = (o: SignTxOutput) => {
    if (!o.token) return `${formatAmount(o.satoshis, 8, 8)} BCH`;
    const m = rawMetas[o.token.category];
    const symbol = m?.symbol ?? 'CashToken';
    return o.token.amount > 0n ? `${formatAmount(o.token.amount, m?.decimals ?? 0, 8)} ${symbol}` : `${t('approval.tx.nft')} ${symbol}`;
  };

  // ── bch_sendTransaction ──
  useEffect(() => {
    if (!tx?.token) return;
    getTokenMetas([tx.token.category], bchNet).then(m => setMeta(m[tx.token!.category]));
  }, [tx?.token?.category, bchNet]);   // eslint-disable-line react-hooks/exhaustive-deps

  // A request for another network's address format would send funds nowhere useful: say so before signing.
  const wrongNetwork = !!tx && tx.to.includes(':') && tx.to.split(':')[0] !== (wdk.isMainnet ? 'bitcoincash' : 'bchtest');
  const bch = assets.find(a => a.network.key === bchNetwork.key && a.kind === 'native');
  const held = tx?.token ? assets.find(a => a.network.key === bchNetwork.key && a.ref === tx.token!.category)?.balance ?? 0n : 0n;
  const bchShort = !!tx && !!bch && (tx.satoshis + 1500n > bch.balance || (!!tx.token && tx.token.amount > held));

  // ── wallet_sendTransaction: the asset is the wallet's own row, so the balance and decimals are the wallet's ──
  const xAsset: Asset | undefined = useMemo(() => {
    if (!xtx) return undefined;
    return assets.find(a => a.network.key === xtx.network.key && (xtx.token
      ? a.ref.toLowerCase() === xtx.token.toLowerCase() || a.ref === normalizeCategory(xtx.token)
      : a.kind === 'native'));
  }, [xtx, assets]);
  const xRecipient = xtx && xAsset ? normalizeRecipient(xAsset, xtx.to) : xtx?.to ?? '';
  const xAddressProblem = xtx && xAsset ? validateAddress(xAsset, xRecipient) : null;
  const xGas = xtx ? nativeOf(xtx.network) : undefined;
  useEffect(() => {
    if (!xtx || !xAsset || xAddressProblem) return;
    let on = true;
    quoteSend(xAsset, signers, xRecipient, xtx.amount, xGas?.balance ?? 0n).then(q => { if (on) setQuote(q); }).catch(() => { if (on) setQuote(null); });
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xAsset?.id, xAsset?.balance, xRecipient, xtx?.amount]);
  const xProblem =
    !xtx ? ''
    : !xAsset ? (portfolioLoading ? '' : t('approval.send.notHeld', { network: xtx.network.name }))
    : xAddressProblem ? t(xAddressProblem.key, xAddressProblem.vars)
    : xtx.amount > xAsset.balance ? t('approval.send.short')
    : quote && !quote.canPayFee ? t('send.error.gas', { symbol: xtx.network.native.symbol, network: xtx.network.name })
    : quote && xAsset.kind === 'native' && xtx.amount > quote.max ? t('approval.send.short')
    : '';

  // ── which key answers ──
  const family: Family = sign ? CHAIN_FAMILY[sign.chain] : xtx ? xtx.network.family : 'bch';
  const palette = FAMILY_PALETTE[family];
  const activeAddress = family === 'evm' ? addresses.evm : family === 'solana' ? addresses.solana : family === 'btc' ? addresses.btc : addresses.bch;
  const signNetwork = family === 'evm' ? undefined : networkOf(wdk.networkMode, family as Exclude<Family, 'evm'>);

  const idx = wdk.accountStore.active;
  const host = hostOf(request.origin);
  const insecure = request.origin.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(request.origin);

  const reject = async () => {
    await answer({ requestId: request.requestId, approved: false, error: 'User rejected the request' });
  };

  const signMessage = async (chain: SignChain, message: string): Promise<string> => {
    switch (chain) {
      case 'bch': {
        if (!wdk.bchWallet) throw new Error(t('approval.error.noAddress'));
        return (await wdk.bchWallet.sign(message)).signature;       // base64, Bitcoin signed message
      }
      case 'evm': {
        if (!wdk.evmSigner) throw new Error(t('approval.error.noAddress'));
        return wdk.evmSigner.signMessage(message);                  // 0x hex, EIP-191 personal_sign
      }
      case 'solana': {
        if (!wdk.solanaAccount) throw new Error(t('approval.error.noAddress'));
        return wdk.solanaAccount.sign(message);                     // hex, ed25519 over the UTF-8 bytes
      }
      case 'btc': {
        if (!wdk.activeBtcAccount) throw new Error(t('approval.error.noAddress'));
        return wdk.activeBtcAccount.sign(message);                  // base64, BIP-137 segwit message
      }
    }
  };

  const approve = async () => {
    setBusy(true);
    setError('');
    const account = wdk.evmAddress ?? '';
    try {
      if (isConnect) {
        if (!wdk.bchAddress) throw new Error(t('approval.error.noAddress'));
        await addActivity({ kind: 'connect', status: 'confirmed', network: bchNetwork.key, account, origin: request.origin });
        await answer({ requestId: request.requestId, approved: true, result: [wdk.bchAddress] });
        return;
      }
      if (sign) {
        const signature = await signMessage(sign.chain, sign.message);
        const network = signNetwork?.key ?? networkOf(wdk.networkMode, 'bch').key;
        await addActivity({ kind: 'sign', status: 'confirmed', network, account, origin: request.origin, note: sign.message.slice(0, 140) });
        await answer({ requestId: request.requestId, approved: true, result: { signature, address: activeAddress, chain: sign.chain } });
        return;
      }
      if (rtx) {
        const key = wdk.bchWallet?.privateKey as Uint8Array | undefined;
        if (!key) throw new Error(t('approval.error.noAddress'));
        const { signTransaction } = await import('@/lib/bch-sign');
        const signed = signTransaction(rtx.req, key);
        if (rtx.req.broadcast) {
          await wdk.bchWallet.submitTransaction(signed.bytes);
          const net = rtx.summary.netSatoshis;
          await addActivity({
            kind: 'send', status: 'confirmed', network: bchNetwork.key, account, origin: request.origin,
            sent: `${formatAmount(net > 0n ? net : 0n, 8, 8)} BCH`, counterparty: rtx.summary.outputs.find(o => !o.own && o.address)?.address, txid: signed.txid,
          });
          refresh();
        } else {
          await addActivity({ kind: 'sign', status: 'confirmed', network: bchNetwork.key, account, origin: request.origin, note: rtx.req.userPrompt || signed.txid });
        }
        await answer({ requestId: request.requestId, approved: true, result: { signedTransaction: signed.hex, signedTransactionHash: signed.txid } });
        return;
      }
      if (xtx && xAsset) {
        const txid = await sendAsset(xAsset, signers, xRecipient, xtx.amount);
        await addActivity({
          kind: 'send', status: xtx.network.family === 'bch' ? 'confirmed' : 'pending', network: xtx.network.key, account, origin: request.origin,
          sent: `${formatAmount(xtx.amount, xAsset.decimals, 8)} ${xAsset.symbol}`, counterparty: xRecipient, txid,
        });
        refresh();
        await answer({ requestId: request.requestId, approved: true, result: { txid, network: xtx.network.key } });
        return;
      }
      if (tx) {
        if (!wdk.bchWallet) throw new Error(t('approval.error.noAddress'));
        const to = tx.to.includes(':') ? tx.to : `${wdk.isMainnet ? 'bitcoincash' : 'bchtest'}:${tx.to}`;
        let res: any;
        if (tx.token) {
          const { TokenSendRequest } = await import('mainnet-js');
          res = await wdk.bchWallet.send([new TokenSendRequest({ cashaddr: to, category: tx.token.category, amount: tx.token.amount, value: tx.satoshis > 800n ? tx.satoshis : 1000n })]);
        } else {
          res = await wdk.bchWallet.send([{ cashaddr: to, value: tx.satoshis }]);
        }
        const txid = res?.txId ?? res?.txid;
        if (!txid) throw new Error(t('approval.error.notAccepted'));
        const sent = tx.token ? `${formatAmount(tx.token.amount, meta?.decimals ?? 0, 8)} ${meta?.symbol ?? 'CT'}` : `${formatAmount(tx.satoshis, 8, 8)} BCH`;
        await addActivity({ kind: 'send', status: 'confirmed', network: bchNetwork.key, account, origin: request.origin, sent, counterparty: to, txid });
        refresh();
        await answer({ requestId: request.requestId, approved: true, result: { txid } });
        return;
      }
      throw new Error(parseError || t('approval.error.unsupported'));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const isSend = isBchSend || isAnySend;
  const title = isConnect ? t('approval.connect.title') : isRawSign ? t('approval.tx.title') : isSend ? t('approval.send.title') : t('approval.sign.title');
  const blocked =
    !!parseError
    || (isBchSend && (!tx || wrongNetwork || bchShort))
    || (isAnySend && (!xtx || !xAsset || !!xProblem))
    || (isSign && (!sign || !activeAddress))
    || (isRawSign && (!rtx || rawNothing))
    || (!isConnect && !isSend && !isSign && !isRawSign);

  return (
    <MPopup>
      <div data-testid="approval" data-method={request.method} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* who is asking */}
        <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${MX.border}` }}>
          <div style={{ width: 36, height: 36, borderRadius: 11, background: MX.bg2, border: `1px solid ${MX.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', fontWeight: 800, color: MX.fgMute, flexShrink: 0 }}>
            {request.icon ? <img src={request.icon} alt="" style={{ width: 22, height: 22 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : host.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div data-testid="approval-origin" style={{ fontSize: 13, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{host}</div>
            <div style={{ fontSize: 10.5, color: MX.fgMute }}>{title}</div>
          </div>
          <NetworkPill mode={wdk.networkMode} />
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {queued > 0 && <Banner tone="info">{t('approval.queued', { count: queued })}</Banner>}
          {insecure && <Banner tone="warn">{t('approval.insecure')}</Banner>}

          {isConnect && (
            <>
              <h1 style={{ fontSize: 19, fontWeight: 900, letterSpacing: '-0.02em' }}>{t('approval.connect.heading', { site: host })}</h1>
              <DetailCard>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: MX.fgMute, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('approval.connect.can')}</div>
                {(['approval.connect.can1', 'approval.connect.can2'] as const).map(k => (
                  <div key={k} style={{ display: 'flex', gap: 8, fontSize: 12, alignItems: 'flex-start' }}><span style={{ color: MX.primary, display: 'flex', marginTop: 2 }}><MI.check size={12} /></span>{t(k)}</div>
                ))}
                <div style={{ fontSize: 10.5, fontWeight: 700, color: MX.fgMute, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>{t('approval.connect.cannot')}</div>
                <div style={{ display: 'flex', gap: 8, fontSize: 12, alignItems: 'flex-start' }}><span style={{ color: MX.red, display: 'flex', marginTop: 2 }}><MI.cross size={12} /></span>{t('approval.connect.cannot1')}</div>
              </DetailCard>
            </>
          )}

          {isBchSend && tx && (
            <>
              <div style={{ textAlign: 'center', padding: '6px 0 2px' }}>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <TokenIcon symbol={tx.token ? meta?.symbol ?? 'CT' : 'BCH'} logo={tx.token ? meta?.icon : bchNetwork.native.logo} networkLogo={tx.token ? bchNetwork.logo : undefined} palette="bch" size={40} />
                </div>
                <div data-testid="approval-amount" style={{ marginTop: 8, fontSize: 25, fontWeight: 900, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
                  {tx.token ? formatAmount(tx.token.amount, meta?.decimals ?? 0, 8) : formatAmount(tx.satoshis, 8, 8)}{' '}
                  <span style={{ fontSize: 14, color: MX.fgMute }}>{tx.token ? meta?.symbol ?? 'CashToken' : 'BCH'}</span>
                </div>
              </div>
              <DetailCard>
                <DetailRow label={t('send.to')} value={<span data-testid="approval-to" style={{ fontFamily: MX.mono, fontSize: 10.5 }}>{tx.to}</span>} />
                {tx.token && <DetailRow label={t('approval.send.category')} value={<span style={{ fontFamily: MX.mono, fontSize: 10.5 }}>{shortAddr(tx.token.category, 10, 8)}</span>} />}
                {tx.token && tx.satoshis > 0n && <DetailRow label={t('approval.send.withBch')} value={`${formatAmount(tx.satoshis, 8, 8)} BCH`} />}
                <DetailRow label={t('common.network')} value={bchNetwork.name} />
                <DetailRow label={t('send.networkFee')} value="~0.00001 BCH" />
              </DetailCard>
              {tx.token && meta && !meta.known && <Banner tone="warn">{t('home.unverifiedLong')}</Banner>}
              {wrongNetwork && <Banner tone="error" testId="approval-wrong-network">{t('approval.send.wrongNetwork', { network: bchNetwork.name })}</Banner>}
              {bchShort && !wrongNetwork && <Banner tone="error" testId="approval-short">{t('approval.send.short')}</Banner>}
            </>
          )}

          {isAnySend && xtx && (
            <>
              {xAsset ? (
                <div style={{ textAlign: 'center', padding: '6px 0 2px' }}>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <TokenIcon symbol={xAsset.symbol} logo={xAsset.logo} networkLogo={xAsset.network.logo} palette={xAsset.network.palette} size={40} />
                  </div>
                  <div data-testid="approval-amount" style={{ marginTop: 8, fontSize: 25, fontWeight: 900, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
                    {formatAmount(xtx.amount, xAsset.decimals, 8)} <span style={{ fontSize: 14, color: MX.fgMute }}>{xAsset.symbol}</span>
                  </div>
                </div>
              ) : portfolioLoading && <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}><Spinner size={20} color={MX.primary} /></div>}
              <DetailCard>
                <DetailRow label={t('send.to')} value={<span data-testid="approval-to" style={{ fontFamily: MX.mono, fontSize: 10.5 }}>{xRecipient}</span>} />
                <DetailRow label={t('common.network')} value={<span data-testid="approval-network">{xtx.network.name}</span>} />
                {xtx.token && <DetailRow label={t('approval.send.category')} value={<span style={{ fontFamily: MX.mono, fontSize: 10.5 }}>{shortAddr(xtx.token, 10, 8)}</span>} />}
                <DetailRow label={t('send.networkFee')} value={quote ? `~${formatAmount(quote.fee, xtx.network.native.decimals, 8)} ${xtx.network.native.symbol}` : '—'} />
              </DetailCard>
              {xAsset && !xAsset.verified && <Banner tone="warn">{t('home.unverifiedLong')}</Banner>}
              {xProblem && <Banner tone="error" testId="approval-short">{xProblem}</Banner>}
              {xtx.network.mode === 'mainnet' && !xProblem && <Banner tone="warn">{t('send.irreversible')}</Banner>}
            </>
          )}

          {isRawSign && !raw && <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}><Spinner size={20} color={MX.primary} /></div>}
          {isRawSign && rtx && (
            <>
              <div style={{ textAlign: 'center', padding: '6px 0 2px' }}>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <TokenIcon symbol="BCH" logo={bchNetwork.native.logo} palette="bch" size={40} />
                </div>
                <div style={{ marginTop: 8, fontSize: 10.5, fontWeight: 700, color: MX.fgMute, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {t(rtx.summary.netSatoshis >= 0n ? 'approval.tx.leaves' : 'approval.tx.arrives')}
                </div>
                <div data-testid="approval-amount" style={{ fontSize: 25, fontWeight: 900, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
                  {formatAmount(rtx.summary.netSatoshis >= 0n ? rtx.summary.netSatoshis : -rtx.summary.netSatoshis, 8, 8)}{' '}
                  <span style={{ fontSize: 14, color: MX.fgMute }}>BCH</span>
                </div>
                {rtx.summary.tokens.map(tk => (
                  <div key={tk.category} data-testid="approval-token" style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                    {tk.amount > 0n ? '−' : '+'}{formatAmount(tk.amount > 0n ? tk.amount : -tk.amount, rawMetas[tk.category]?.decimals ?? 0, 8)} {rawMetas[tk.category]?.symbol ?? `CashToken ${shortAddr(tk.category, 6, 4)}`}
                  </div>
                ))}
              </div>
              <DetailCard>
                {rtx.summary.outputs.filter(o => !o.own).map((o, i) => (
                  <DetailRow key={i} label={t('approval.tx.paysTo')} value={
                    <span data-testid="approval-output">
                      {outputAmount(o)}<br />
                      <span style={{ fontFamily: MX.mono, fontSize: 10.5, fontWeight: 600 }}>{o.address || t(o.data ? 'approval.tx.data' : 'approval.tx.script')}</span>
                    </span>
                  } />
                ))}
                {rtx.summary.outputs.some(o => o.own) && (
                  <DetailRow label={t('approval.tx.back')} value={`${formatAmount(rtx.summary.outputs.filter(o => o.own).reduce((sum, o) => sum + o.satoshis, 0n), 8, 8)} BCH`} />
                )}
                <DetailRow label={t('common.network')} value={bchNetwork.name} />
                <DetailRow label={t('send.networkFee')} value={<span data-testid="approval-fee">{formatAmount(rtx.summary.fee, 8, 8)} BCH</span>} />
                {rtx.req.userPrompt && <DetailRow label={t('approval.tx.siteNote')} value={rtx.req.userPrompt} />}
              </DetailCard>
              {rtx.summary.contractInputs > 0 && <Banner tone="info">{t('approval.tx.contract')}</Banner>}
              {!rtx.req.broadcast && <Banner tone="info">{t('approval.tx.noBroadcast')}</Banner>}
              {rtx.summary.fee > 100_000n && <Banner tone="warn">{t('approval.tx.highFee')}</Banner>}
              {rawNothing && <Banner tone="error" testId="approval-nothing">{t('approval.tx.nothing')}</Banner>}
            </>
          )}

          {isSign && sign && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ChainGlyph chain={palette} size={18} />
                <span data-testid="approval-chain" data-chain={sign.chain} style={{ fontSize: 12, fontWeight: 700, color: CHAIN[palette].color }}>{t('approval.sign.with', { chain: CHAIN[palette].name })}</span>
              </div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: MX.fgMute, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('approval.sign.message')}</div>
              <pre data-testid="approval-message" style={{ margin: 0, flex: 1, minHeight: 90, maxHeight: 260, overflow: 'auto', padding: 12, background: MX.bg1, border: `1px solid ${MX.border}`, borderRadius: 13, fontFamily: MX.mono, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: MX.fg }}>
                {sign.message}
              </pre>
              <Banner tone="info">{t('approval.sign.note')}</Banner>
              {!activeAddress && <Banner tone="error">{t('approval.error.noAddress')}</Banner>}
            </>
          )}

          {parseError && <Banner tone="error" testId="approval-invalid">{parseError}</Banner>}
          {!isConnect && !isSend && !isSign && !isRawSign && <Banner tone="error">{t('approval.error.unsupported')}</Banner>}

          {/* which account, and which of its addresses */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: MX.surface, border: `1px solid ${MX.border}`, borderRadius: 13 }}>
            <Avatar name={getLabel(wdk.accountStore, idx)} grad={getGrad(wdk.accountStore, idx)} size={26} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{getLabel(wdk.accountStore, idx)}</div>
              <div data-testid="approval-address" style={{ fontSize: 10, color: MX.fgMute, fontFamily: MX.mono }}>{shortAddr(activeAddress, 8, 6)}</div>
            </div>
            {family === 'bch' && bch && <div style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatAmount(bch.balance, 8, 6)} BCH</div>}
            {isAnySend && xAsset && <div style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatAmount(xAsset.balance, xAsset.decimals, 6)} {xAsset.symbol}</div>}
          </div>

          {error && <Banner tone="error" testId="approval-error">{error}</Banner>}
        </div>

        <div style={{ padding: '10px 14px 14px', borderTop: `1px solid ${MX.border}`, display: 'flex', gap: 8 }}>
          <MSecondary onClick={reject} disabled={busy} style={{ flex: 1 }} testId="approval-reject">{t('approval.reject')}</MSecondary>
          <MPrimary onClick={approve} loading={busy} style={{ flex: 1.3 }} testId="approval-approve" disabled={blocked}>
            {isConnect ? t('approval.connect.cta') : isSend || rtx?.req.broadcast ? t('send.confirm') : t('approval.sign.cta')}
          </MPrimary>
        </div>
      </div>
    </MPopup>
  );
}
