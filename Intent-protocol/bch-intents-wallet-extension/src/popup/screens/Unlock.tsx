/**
 * Unlock screen — shown when an encrypted wallet exists in chrome.storage.local
 * but the session has expired or the wallet was locked.
 * Ported from wallet-extension-bundle/morphic-wallet-onboarding.jsx (MScreenUnlock).
 */

import { useState } from 'react';
import { useWDK } from '@/context/WDKProvider';
import { useT } from '@/context/SettingsProvider';
import { MX, MPopup, MPrimary, MInput, MI, Banner, Sheet, MSecondary } from '@/design-system/primitives';
import { Chameleon, type ChamMood } from '@/design-system/Chameleon';

export function UnlockScreen({ pendingCount = 0 }: { pendingCount?: number }) {
  const wdk = useWDK();
  const t = useT();
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mood, setMood] = useState<ChamMood>('idle');
  const [forgot, setForgot] = useState(false);
  const [resetText, setResetText] = useState('');

  const handleUnlock = async () => {
    if (!password || loading) return;
    setLoading(true);
    setError('');
    setMood('busy');
    const ok = await wdk.unlockWallet(password);
    if (!ok) {
      setError(t('unlock.wrong'));
      setMood('error');
      setLoading(false);
      setTimeout(() => setMood('idle'), 700);
    }
    // On success App.tsx re-renders to the wallet automatically
  };

  return (
    <MPopup>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 22px 20px', position: 'relative', zIndex: 1, overflow: 'auto' }}>
        <Chameleon size={170} mood={password && !showPw && mood === 'idle' ? 'shy' : mood} />

        <h1 style={{ marginTop: 14, fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em' }}>{t('unlock.title')}</h1>
        <div style={{ marginTop: 4, fontSize: 12.5, color: MX.fgMute, textAlign: 'center' }}>{t('unlock.sub')}</div>

        {pendingCount > 0 && (
          <div style={{ width: '100%', marginTop: 14 }}>
            <Banner tone="info" icon={<MI.plug size={14} />}>{t('unlock.pending', { count: pendingCount })}</Banner>
          </div>
        )}

        <div style={{ width: '100%', marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <MInput
            placeholder={t('unlock.password')} value={password} autoFocus testId="unlock-password"
            onChange={v => { setPassword(v); setError(''); }}
            onEnter={handleUnlock} invalid={!!error}
            type={showPw ? 'text' : 'password'}
            suffix={
              <button type="button" aria-label={showPw ? t('common.hide') : t('common.show')} onClick={() => setShowPw(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MX.fgFaint, display: 'flex' }}>
                {showPw ? <MI.eyeOff size={15} /> : <MI.eye size={15} />}
              </button>
            }
          />
          {error && <div role="alert" data-testid="unlock-error" style={{ fontSize: 11.5, color: MX.red, fontWeight: 600 }}>{error}</div>}
          <MPrimary icon={<MI.lock size={14} />} onClick={handleUnlock} disabled={!password} loading={loading} testId="unlock-submit">
            {t('unlock.submit')}
          </MPrimary>
        </div>

        <div style={{ flex: 1, minHeight: 16 }} />
        <button type="button" onClick={() => setForgot(true)} data-testid="forgot-password" style={{ background: 'none', border: 'none', color: MX.fgMute, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: 6 }}>
          {t('unlock.forgot')}
        </button>
      </div>

      {forgot && (
        <Sheet title={t('unlock.forgot')} onClose={() => { setForgot(false); setResetText(''); }}>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, color: MX.fgMute, lineHeight: 1.55 }}>{t('unlock.forgotBody')}</div>
            <Banner tone="error">{t('unlock.resetWarning')}</Banner>
            <MInput placeholder={t('unlock.resetPlaceholder')} value={resetText} onChange={setResetText} testId="reset-confirm" />
            <div style={{ display: 'flex', gap: 8 }}>
              <MSecondary h={40} onClick={() => { setForgot(false); setResetText(''); }}>{t('common.cancel')}</MSecondary>
              <MPrimary h={40} danger disabled={resetText.trim().toUpperCase() !== 'RESET'} onClick={() => wdk.resetWallet()} testId="reset-wallet">
                {t('unlock.reset')}
              </MPrimary>
            </div>
          </div>
        </Sheet>
      )}
    </MPopup>
  );
}
