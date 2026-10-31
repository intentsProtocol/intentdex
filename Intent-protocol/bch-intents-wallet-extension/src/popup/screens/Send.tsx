/**
 * Send screen — any asset on any network of the active mode.
 *
 *   form → review → sent
 *
 * The form validates as the user types (address format for the asset's chain, amount against the balance, and
 * whether the gas token can pay the fee), so the review step never shows something that cannot be sent.
 *
 * Ported from wallet-extension-bundle/morphic-wallet-main.jsx (MScreenSend).
 */

import { useEffect, useMemo, useState } from 'react';
import { usePortfolio } from '@/context/PortfolioProvider';
import { useWDK } from '@/context/WDKProvider';
import { useT } from '@/context/SettingsProvider';
import {
  MX, MPopup, Bento, MPrimary, MSecondary, MInput, MI, TokenIcon, Sheet, Banner, Spinner,
} from '@/design-system/primitives';
import { Chameleon } from '@/design-system/Chameleon';
import { PageHeader, Label, DetailCard, DetailRow, EmptyState } from './shared';
import { priceOf, type Asset } from '@/lib/assets';
import { explorerTxUrl } from '@/lib/chains';
import { errorMessage, formatAmount, formatUnits, formatUsd, parseUnits, shortAddr } from '@/lib/format';
import { normalizeRecipient, quoteSend, sendAsset, validateAddress, type SendQuote } from '@/lib/send';
import { addActivity } from '@/lib/activity';

interface SendScreenProps {
  onBack: () => void;
  assetId?: string;
}

type Step = 'form' | 'review' | 'sent';

// ─── asset picker ─────────────────────────────────────────────────────────────
export function AssetPicker({ assets, selectedId, onPick, onClose, title }: {
  assets: Asset[]; selectedId?: string; onPick: (a: Asset) => void; onClose: () => void; title: string;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return assets;
    return assets.filter(a => `${a.symbol} ${a.name} ${a.network.name} ${a.ref}`.toLowerCase().includes(needle));
  }, [assets, q]);
  return (
    <Sheet title={title} onClose={onClose} testId="asset-picker">
      <div style={{ padding: '10px 12px 4px' }}>
        <MInput placeholder={t('common.search')} value={q} onChange={setQ} prefix={<MI.search size={14} />} autoFocus testId="asset-search" />
      </div>
      <div style={{ padding: '6px 12px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {shown.length === 0 && <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: MX.fgMute }}>{t('send.noAssets')}</div>}
        {shown.map(a => (
          <button
            key={a.id} type="button" onClick={() => onPick(a)} data-testid={`pick-${a.id}`} className="mx-press"
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px 10px', cursor: 'pointer',
              background: a.id === selectedId ? MX.primaryDim : 'transparent', border: `1px solid ${a.id === selectedId ? MX.primaryBorder : 'transparent'}`,
              borderRadius: 12, color: MX.fg,
            }}
          >
            <TokenIcon symbol={a.symbol} logo={a.logo} networkLogo={a.network.logo} palette={a.network.palette} size={30} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{a.symbol}</div>
              <div style={{ fontSize: 10.5, color: MX.fgMute }}>{a.network.name}</div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatAmount(a.balance, a.decimals)}</div>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// ─── SendScreen ───────────────────────────────────────────────────────────────
export function SendScreen({ onBack, assetId }: SendScreenProps) {
  const t = useT();
  const wdk = useWDK();
  const { assets, signers, nativeOf, prices, refresh, loading } = usePortfolio();
  const spendable = useMemo(() => assets.filter(a => a.balance > 0n), [assets]);

  const [selectedId, setSelectedId] = useState<string | undefined>(assetId);
  const [picker, setPicker] = useState(false);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<SendQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [txid, setTxid] = useState('');

  // The live row, so the balance on screen follows the chain while the form is open.
  const asset = spendable.find(a => a.id === selectedId) ?? assets.find(a => a.id === selectedId) ?? spendable[0];
  const gas = asset ? nativeOf(asset.network) : undefined;

  const addressProblem = asset && to.trim() ? validateAddress(asset, normalizeRecipient(asset, to)) : null;
  const addressError = addressProblem ? t(addressProblem.key, addressProblem.vars) : null;
  const ownAddress = asset && [signers.addresses.bch, signers.addresses.evm, signers.addresses.solana, signers.addresses.btc]
    .some(a => a && a.toLowerCase() === normalizeRecipient(asset, to).toLowerCase());

  let units: bigint | null = null;
  let amountError: string | null = null;
  if (asset && amount.trim()) {
    try {
      units = parseUnits(amount, asset.decimals);
      if (units <= 0n) amountError = t('send.error.zero');
      else if (units > asset.balance) amountError = t('send.error.balance', { symbol: asset.symbol });
      else if (quote && units > quote.max) amountError = t('send.error.fee', { symbol: asset.symbol });
    } catch (e) {
      amountError = errorMessage(e);
    }
  }

  // Fee and maximum, re-asked a moment after the inputs settle.
  useEffect(() => {
    if (!asset) return;
    let alive = true;
    setQuoting(true);
    const id = setTimeout(async () => {
      try {
        const q = await quoteSend(asset, signers, to.trim(), units ?? 0n, gas?.balance ?? 0n);
        if (alive) setQuote(q);
      } catch {
        if (alive) setQuote(null);
      } finally {
        if (alive) setQuoting(false);
      }
    }, 350);
    return () => { alive = false; clearTimeout(id); };
    // The quote depends on the asset, the recipient and the amount; signers and the gas row follow the asset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id, asset?.balance, to, amount]);

  const feeAsset = asset?.network.native;
  const feeText = quote && feeAsset ? `${formatAmount(quote.fee, feeAsset.decimals, 8)} ${feeAsset.symbol}` : '—';
  const price = asset ? priceOf(asset, prices) : undefined;
  const usd = units !== null && price !== undefined && asset ? (Number(formatUnits(units, asset.decimals)) * price) : undefined;
  const cannotPayFee = !!quote && !quote.canPayFee;
  const ready = !!asset && !!to.trim() && !addressError && units !== null && !amountError && !cannotPayFee;

  const submit = async () => {
    if (!asset || units === null) return;
    setSending(true);
    setError('');
    try {
      const recipient = normalizeRecipient(asset, to);
      const id = await sendAsset(asset, signers, recipient, units);
      setTxid(id);
      setStep('sent');
      await addActivity({
        kind: 'send', status: asset.network.family === 'bch' ? 'confirmed' : 'pending',
        network: asset.network.key, account: wdk.evmAddress ?? '',
        sent: `${formatAmount(units, asset.decimals, 8)} ${asset.symbol}`, counterparty: recipient, txid: id,
      });
      refresh();
    } catch (e) {
      setError(errorMessage(e, t('send.error.failed')));
      setStep('form');
    } finally {
      setSending(false);
    }
  };

  // ── sent ──
  if (step === 'sent' && asset) {
    return (
      <MPopup>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '36px 20px 18px', textAlign: 'center', overflow: 'auto' }} data-testid="send-success">
          <Chameleon size={150} mood="happy" tone={`var(--mx-c-${asset.network.palette})`} />
          <h1 style={{ marginTop: 12, fontSize: 21, fontWeight: 900, letterSpacing: '-0.02em' }}>{t('send.sent.title')}</h1>
          <div style={{ marginTop: 4, fontSize: 12.5, color: MX.fgMute }}>
            {t('send.sent.body', { amount: `${amount} ${asset.symbol}`, to: shortAddr(normalizeRecipient(asset, to), 8, 6) })}
          </div>
          <div style={{ width: '100%', marginTop: 16 }}>
            <DetailCard>
              <DetailRow label={t('common.network')} value={asset.network.name} />
              <DetailRow label={t('send.txid')} value={<span style={{ fontFamily: MX.mono, fontSize: 10.5 }} data-testid="send-txid">{shortAddr(txid, 10, 8)}</span>} />
            </DetailCard>
          </div>
          <a href={explorerTxUrl(asset.network, txid)} target="_blank" rel="noreferrer" style={{ marginTop: 12, color: MX.primary, fontSize: 12, fontWeight: 700, textDecoration: 'none', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
            <MI.ext size={13} /> {t('home.viewOnExplorer')}
          </a>
          <div style={{ flex: 1, minHeight: 16 }} />
          <MPrimary onClick={onBack} testId="send-done">{t('common.done')}</MPrimary>
        </div>
      </MPopup>
    );
  }

  // ── review ──
  if (step === 'review' && asset && units !== null) {
    const recipient = normalizeRecipient(asset, to);
    return (
      <MPopup>
        <PageHeader title={t('send.review.title')} sub={asset.network.name} onBack={sending ? undefined : () => setStep('form')} />
        <div style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Bento glassy style={{ padding: 18, textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <TokenIcon symbol={asset.symbol} logo={asset.logo} networkLogo={asset.network.logo} palette={asset.network.palette} size={42} />
            </div>
            <div data-testid="review-amount" style={{ marginTop: 10, fontSize: 26, fontWeight: 900, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
              {formatAmount(units, asset.decimals, 8)} <span style={{ fontSize: 15, color: MX.fgMute }}>{asset.symbol}</span>
            </div>
            {usd !== undefined && <div style={{ fontSize: 12, color: MX.fgMute, marginTop: 2 }}>{formatUsd(usd)}</div>}
          </Bento>
          <DetailCard>
            <DetailRow label={t('send.to')} value={<span style={{ fontFamily: MX.mono, fontSize: 10.5 }} data-testid="review-to">{recipient}</span>} />
            <DetailRow label={t('common.network')} value={asset.network.name} />
            <DetailRow label={t('send.networkFee')} value={feeText} />
          </DetailCard>
          {ownAddress && <Banner tone="info">{t('send.ownAddress')}</Banner>}
          {asset.network.mode === 'mainnet' && <Banner tone="warn">{t('send.irreversible')}</Banner>}
          {error && <Banner tone="error" testId="send-error">{error}</Banner>}
        </div>
        <div style={{ padding: '10px 14px 14px', borderTop: `1px solid ${MX.border}`, display: 'flex', gap: 8 }}>
          <MSecondary onClick={() => setStep('form')} disabled={sending} style={{ flex: 1 }}>{t('common.back')}</MSecondary>
          <MPrimary onClick={submit} loading={sending} style={{ flex: 1.4 }} testId="send-confirm">{sending ? t('send.sending') : t('send.confirm')}</MPrimary>
        </div>
      </MPopup>
    );
  }

  // ── form ──
  return (
    <MPopup>
      <PageHeader title={t('send.title')} onBack={onBack} />

      {!asset ? (
        loading
          ? <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={22} color={MX.primary} /></div>
          : <EmptyState icon={<MI.wallet size={28} />} title={t('send.empty.title')} body={t('send.empty.body')} />
      ) : (
        <>
          <div style={{ padding: 14, flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', position: 'relative', zIndex: 1 }}>
            {/* asset */}
            <div>
              <Label>{t('send.asset')}</Label>
              <button
                type="button" onClick={() => setPicker(true)} data-testid="send-asset" className="mx-press"
                style={{ width: '100%', padding: '10px 12px', background: MX.surface, border: `1px solid ${MX.border}`, borderRadius: 13, color: MX.fg, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}
              >
                <TokenIcon symbol={asset.symbol} logo={asset.logo} networkLogo={asset.network.logo} palette={asset.network.palette} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{asset.symbol} <span style={{ color: MX.fgMute, fontWeight: 600 }}>· {asset.network.name}</span></div>
                  <div style={{ fontSize: 10.5, color: MX.fgMute }}>{t('send.balance', { amount: formatAmount(asset.balance, asset.decimals), symbol: asset.symbol })}</div>
                </div>
                <MI.chevD size={14} stroke={MX.fgMute} />
              </button>
            </div>

            {/* recipient */}
            <div>
              <Label>{t('send.to')}</Label>
              <MInput
                mono value={to} onChange={v => { setTo(v); setError(''); }} invalid={!!addressError} testId="send-to"
                placeholder={asset.network.family === 'bch' ? (asset.network.mode === 'mainnet' ? 'bitcoincash:q…' : 'bchtest:q…') : asset.network.family === 'evm' ? '0x…' : asset.network.family === 'btc' ? (asset.network.mode === 'mainnet' ? 'bc1…' : 'tb1…') : t('send.addressPlaceholder')}
                suffix={
                  <button
                    type="button" onClick={async () => { try { setTo((await navigator.clipboard.readText()).trim()); } catch { /* clipboard blocked */ } }}
                    style={{ background: MX.primaryDim, color: MX.primary, border: 'none', padding: '4px 9px', borderRadius: 7, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <MI.paste size={11} /> {t('common.paste')}
                  </button>
                }
              />
              {addressError && <div role="alert" data-testid="send-to-error" style={{ marginTop: 5, fontSize: 11, color: MX.red }}>{addressError}</div>}
            </div>

            {/* amount */}
            <div>
              <Label>{t('send.amount')}</Label>
              <Bento style={{ padding: 14, borderRadius: 14, borderColor: amountError ? MX.redBorder : amount ? MX.primaryBorder : MX.border }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <input
                    value={amount} data-testid="send-amount" aria-label={t('send.amount')}
                    onChange={e => { if (/^\d*\.?\d*$/.test(e.target.value)) { setAmount(e.target.value); setError(''); } }}
                    placeholder="0" inputMode="decimal" autoComplete="off"
                    style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: MX.fg, fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', fontFamily: 'inherit' }}
                  />
                  <div style={{ fontSize: 13, fontWeight: 700, color: MX.fgMute }}>{asset.symbol}</div>
                </div>
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 11, color: MX.fgMute }}>{usd !== undefined ? formatUsd(usd) : asset.network.mode === 'testnet' ? t('home.testFunds') : ' '}</span>
                  <button
                    type="button" data-testid="send-max" disabled={!quote}
                    onClick={() => quote && setAmount(formatUnits(quote.max, asset.decimals))}
                    style={{ background: MX.surface2, border: `1px solid ${MX.border}`, color: MX.fg, fontWeight: 700, padding: '3px 9px', borderRadius: 6, cursor: quote ? 'pointer' : 'default', fontSize: 10, opacity: quote ? 1 : 0.5 }}
                  >
                    {t('send.max')}
                  </button>
                </div>
              </Bento>
              {amountError && <div role="alert" data-testid="send-amount-error" style={{ marginTop: 5, fontSize: 11, color: MX.red }}>{amountError}</div>}
            </div>

            <DetailCard>
              <DetailRow label={t('send.networkFee')} value={quoting && !quote ? <Spinner size={11} /> : `~${feeText}`} />
              <DetailRow label={t('common.network')} value={asset.network.name} />
            </DetailCard>

            {cannotPayFee && feeAsset && (
              <Banner tone="warn" testId="send-gas-warning">{t('send.error.gas', { symbol: feeAsset.symbol, network: asset.network.name })}</Banner>
            )}
            {error && <Banner tone="error" testId="send-error">{error}</Banner>}
          </div>

          <div style={{ padding: '10px 14px 14px', borderTop: `1px solid ${MX.border}`, position: 'relative', zIndex: 2 }}>
            <MPrimary onClick={() => setStep('review')} disabled={!ready} icon={<MI.next size={14} />} testId="send-review">{t('send.review')}</MPrimary>
          </div>
        </>
      )}

      {picker && (
        <AssetPicker
          title={t('send.pickAsset')} assets={spendable} selectedId={asset?.id} onClose={() => setPicker(false)}
          onPick={a => { setSelectedId(a.id); setPicker(false); setAmount(''); setTo(''); setQuote(null); }}
        />
      )}
    </MPopup>
  );
}
