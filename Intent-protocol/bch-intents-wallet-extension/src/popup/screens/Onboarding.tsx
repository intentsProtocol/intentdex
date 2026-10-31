/**
 * Onboarding.
 *
 *   Create:  welcome → password → recovery phrase → confirm three words → done
 *   Import:  welcome → enter phrase → password → done
 *
 * Nothing is stored until the last step of either path: the phrase lives in this component's state, and
 * wdk.setupWallet() derives, encrypts and starts the session in one call.
 *
 * Ported from wallet-extension-bundle/morphic-wallet-onboarding.jsx; the confirm step and the import validation
 * are additions.
 */

import { useEffect, useMemo, useState } from 'react';
import { useWDK, normalizePhrase } from '@/context/WDKProvider';
import { useSettings } from '@/context/SettingsProvider';
import {
  MX, MPopup, MPrimary, MSecondary, Bento, MInput, ChainGlyph, MI, Banner, IconBtn, CHAIN, useCopy, type ChainKey,
} from '@/design-system/primitives';
import { Chameleon, type ChamMood } from '@/design-system/Chameleon';
import { errorMessage } from '@/lib/format';

type Step = 'welcome' | 'password' | 'phrase' | 'confirm' | 'import' | 'done';
type Path = 'create' | 'import';

export const surfaceOf = () => document.documentElement.getAttribute('data-surface') ?? 'popup';

// ─── header strip ─────────────────────────────────────────────────────────────
function MHeader({ title, sub, onBack, step, of }: { title: string; sub?: string; onBack?: () => void; step?: number; of?: number }) {
  const { t } = useSettings();
  return (
    <div style={{ padding: '14px 16px 8px', position: 'relative', zIndex: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {onBack && <IconBtn label={t('common.back')} onClick={onBack} testId="back"><MI.back size={14} /></IconBtn>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.01em' }}>{title}</h1>
          {sub && <div style={{ fontSize: 11.5, color: MX.fgMute, marginTop: 2 }}>{sub}</div>}
        </div>
      </div>
      {step !== undefined && of !== undefined && (
        <div aria-label={t('onboarding.stepOf', { step, of })} style={{ display: 'flex', gap: 4, marginTop: 12 }}>
          {Array.from({ length: of }).map((_, i) => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i < step ? MX.primary : MX.surface2, transition: 'background 0.3s' }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── password strength ────────────────────────────────────────────────────────
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < 8) return 1;
  return Math.max(1, Math.min(4, score)) as 1 | 2 | 3 | 4;
}

export function PasswordFields({ password, confirm, onPassword, onConfirm, onSubmit, autoFocus = true }: {
  password: string; confirm: string; onPassword: (v: string) => void; onConfirm: (v: string) => void; onSubmit?: () => void; autoFocus?: boolean;
}) {
  const { t } = useSettings();
  const [show, setShow] = useState(false);
  const strength = passwordStrength(password);
  const colors = ['', MX.red, MX.amber, MX.amber, MX.primary];
  const labels = ['', t('password.weak'), t('password.fair'), t('password.good'), t('password.strong')];
  const mismatch = confirm.length > 0 && password !== confirm;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <MInput
        placeholder={t('password.new')} value={password} onChange={onPassword} autoFocus={autoFocus}
        type={show ? 'text' : 'password'} testId="password"
        suffix={
          <button type="button" aria-label={show ? t('common.hide') : t('common.show')} onClick={() => setShow(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MX.fgFaint, display: 'flex' }}>
            {show ? <MI.eyeOff size={15} /> : <MI.eye size={15} />}
          </button>
        }
      />
      <MInput placeholder={t('password.confirm')} value={confirm} onChange={onConfirm} onEnter={onSubmit} type={show ? 'text' : 'password'} invalid={mismatch} testId="password-confirm" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 16 }}>
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= strength ? colors[strength] : MX.surface2, transition: 'background 0.3s' }} />
          ))}
        </div>
        <div style={{ fontSize: 10.5, color: colors[strength] || MX.fgFaint, fontWeight: 700, minWidth: 44, textAlign: 'right' }}>
          {mismatch ? '' : labels[strength]}
        </div>
      </div>
      {mismatch && <div role="alert" style={{ fontSize: 11.5, color: MX.red }}>{t('password.mismatch')}</div>}
    </div>
  );
}

// ─── Welcome ──────────────────────────────────────────────────────────────────
const CHAIN_ROWS: [ChainKey, 'onboarding.chain.bch' | 'onboarding.chain.evm' | 'onboarding.chain.sol' | 'onboarding.chain.btc'][] = [
  ['bch', 'onboarding.chain.bch'], ['eth', 'onboarding.chain.evm'], ['sol', 'onboarding.chain.sol'], ['btc', 'onboarding.chain.btc'],
];

function WelcomeScreen({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  const { t } = useSettings();
  const [hover, setHover] = useState<ChainKey>('bch');
  return (
    <MPopup>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '26px 22px 20px', position: 'relative', zIndex: 1, overflow: 'auto' }}>
        <Chameleon size={150} tone={CHAIN[hover].color} />
        <div style={{ marginTop: 10, textAlign: 'center' }}>
          <h1 style={{ fontSize: 23, fontWeight: 900, letterSpacing: '-0.02em' }}>{t('app.name')}</h1>
          <div style={{ marginTop: 4, fontSize: 13, color: MX.fgMute }}>{t('onboarding.tagline')}</div>
        </div>

        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
          {CHAIN_ROWS.map(([c, key]) => (
            <div
              key={c} onMouseEnter={() => setHover(c)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: MX.surface, border: `1px solid ${hover === c ? CHAIN[c].border : MX.border}`, borderRadius: 11, transition: 'border-color 0.2s' }}
            >
              <ChainGlyph chain={c} size={20} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{CHAIN[c].name}</div>
                <div style={{ fontSize: 10.5, color: MX.fgFaint }}>{t(key)}</div>
              </div>
              <MI.check size={13} stroke={MX.primary} />
            </div>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 16 }} />

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <MPrimary icon={<MI.plus size={15} />} onClick={onCreate} testId="create-wallet">{t('onboarding.create')}</MPrimary>
          <MSecondary icon={<MI.download size={15} />} onClick={onImport} testId="import-wallet">{t('onboarding.import')}</MSecondary>
        </div>
        <div style={{ marginTop: 12, fontSize: 10.5, color: MX.fgFaint, textAlign: 'center' }}>{t('onboarding.footnote')}</div>
      </div>
    </MPopup>
  );
}

// ─── Password ─────────────────────────────────────────────────────────────────
function PasswordScreen({ path, busy, error, onBack, onSubmit }: { path: Path; busy: boolean; error: string; onBack: () => void; onSubmit: (pw: string) => void }) {
  const { t } = useSettings();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreed, setAgreed] = useState(false);
  const valid = password.length >= 8 && password === confirm && agreed;
  return (
    <MPopup>
      <MHeader title={t('onboarding.password.title')} sub={t('onboarding.password.sub')} onBack={onBack} step={path === 'create' ? 1 : 2} of={path === 'create' ? 3 : 2} />
      <div style={{ padding: '6px 18px 16px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'center', margin: '2px 0 10px' }}>
          <Chameleon size={104} mood="shy" />
        </div>
        <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} onSubmit={() => valid && onSubmit(password)} />

        <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 12, fontSize: 11.5, color: MX.fgMute, lineHeight: 1.45, cursor: 'pointer' }}>
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} data-testid="password-agree" style={{ marginTop: 2, accentColor: 'hsl(161,100%,38%)' }} />
          <span>{t('onboarding.password.agree')}</span>
        </label>

        {error && <div style={{ marginTop: 10 }}><Banner tone="error">{error}</Banner></div>}
        <div style={{ flex: 1, minHeight: 12 }} />
        <MPrimary icon={<MI.lock size={14} />} onClick={() => onSubmit(password)} disabled={!valid} loading={busy} testId="password-submit">
          {path === 'create' ? t('common.continue') : t('onboarding.password.finishImport')}
        </MPrimary>
      </div>
    </MPopup>
  );
}

// ─── Recovery phrase ──────────────────────────────────────────────────────────
function PhraseScreen({ phrase, onBack, onContinue }: { phrase: string; onBack: () => void; onContinue: () => void }) {
  const { t } = useSettings();
  const [revealed, setRevealed] = useState(false);
  const [copied, copy] = useCopy(2000);
  const words = phrase.split(' ');
  return (
    <MPopup>
      <MHeader title={t('onboarding.phrase.title')} sub={t('onboarding.phrase.sub', { count: words.length })} onBack={onBack} step={2} of={3} />
      <div style={{ padding: '4px 16px', flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Banner tone="warn">{t('onboarding.phrase.warning')}</Banner>

        <Bento style={{ padding: 12 }}>
          <div style={{ position: 'relative' }}>
            {!revealed && (
              <button
                type="button" onClick={() => setRevealed(true)} data-testid="reveal-phrase"
                style={{
                  position: 'absolute', inset: -2, zIndex: 10, borderRadius: 10, border: 'none', color: MX.fg,
                  background: MX.glassStrong, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer',
                }}
              >
                <MI.eye size={20} stroke={MX.fgMute} />
                <span style={{ fontSize: 12, color: MX.fgMute, fontWeight: 600 }}>{t('onboarding.phrase.reveal')}</span>
              </button>
            )}
            <div data-testid="phrase-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, filter: revealed ? 'none' : 'blur(6px)', userSelect: revealed ? 'text' : 'none' }}>
              {words.map((w, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px', background: MX.bg2, border: `1px solid ${MX.border}`, borderRadius: 9, fontFamily: MX.mono, fontSize: 11.5, fontWeight: 500, minWidth: 0 }}>
                  <span style={{ color: MX.fgFaint, fontSize: 9, minWidth: 12 }}>{i + 1}</span>
                  <span data-word={revealed ? w : undefined} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{revealed ? w : '•••••'}</span>
                </div>
              ))}
            </div>
          </div>
        </Bento>

        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, color: MX.fgMute, lineHeight: 1.6 }}>
          <li>{t('onboarding.phrase.tip1')}</li>
          <li>{t('onboarding.phrase.tip2')}</li>
          <li>{t('onboarding.phrase.tip3')}</li>
        </ul>

        <MSecondary icon={copied ? <MI.check size={14} /> : <MI.copy size={14} />} h={40} disabled={!revealed} onClick={() => copy(phrase)} style={{ color: copied ? MX.primary : undefined }}>
          {copied ? t('common.copied') : t('onboarding.phrase.copy')}
        </MSecondary>
      </div>

      <div style={{ padding: '12px 16px 16px', position: 'relative', zIndex: 2 }}>
        <MPrimary onClick={onContinue} disabled={!revealed} testId="phrase-continue">
          <span>{t('onboarding.phrase.saved')}</span>
          <MI.next size={14} />
        </MPrimary>
      </div>
    </MPopup>
  );
}

// ─── Confirm three words ──────────────────────────────────────────────────────
function pickPositions(count: number): number[] {
  const picked = new Set<number>();
  while (picked.size < 3) picked.add(Math.floor(Math.random() * count));
  return [...picked].sort((a, b) => a - b);
}

function ConfirmScreen({ phrase, busy, error, onBack, onConfirmed, onSkip }: {
  phrase: string; busy: boolean; error: string; onBack: () => void; onConfirmed: () => void; onSkip: () => void;
}) {
  const { t } = useSettings();
  const words = useMemo(() => phrase.split(' '), [phrase]);
  const positions = useMemo(() => pickPositions(words.length), [words]);
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [checked, setChecked] = useState(false);
  const correct = positions.every((p, i) => answers[i].trim().toLowerCase() === words[p]);
  const filled = answers.every(a => a.trim());

  const submit = () => {
    setChecked(true);
    if (correct) onConfirmed();
  };

  return (
    <MPopup>
      <MHeader title={t('onboarding.confirm.title')} sub={t('onboarding.confirm.sub')} onBack={onBack} step={3} of={3} />
      <div style={{ padding: '8px 18px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Chameleon size={96} mood={checked && !correct ? 'error' : 'idle'} />
        </div>
        {positions.map((p, i) => (
          <div key={p}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: MX.fgMute, marginBottom: 5 }}>{t('onboarding.confirm.word', { n: p + 1 })}</div>
            <MInput
              mono value={answers[i]} autoFocus={i === 0} testId={`confirm-word-${p + 1}`} ariaLabel={t('onboarding.confirm.word', { n: p + 1 })}
              invalid={checked && answers[i].trim().toLowerCase() !== words[p]}
              onChange={v => { setChecked(false); setAnswers(a => a.map((x, j) => (j === i ? v : x))); }}
              onEnter={() => filled && submit()}
            />
          </div>
        ))}
        {checked && !correct && <Banner tone="error">{t('onboarding.confirm.wrong')}</Banner>}
        {error && <Banner tone="error">{error}</Banner>}
        <div style={{ flex: 1, minHeight: 8 }} />
        <MPrimary onClick={submit} disabled={!filled} loading={busy} testId="confirm-submit">{t('onboarding.confirm.finish')}</MPrimary>
        <button type="button" onClick={onSkip} disabled={busy} data-testid="confirm-skip" style={{ background: 'none', border: 'none', color: MX.fgMute, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: 6 }}>
          {t('onboarding.confirm.skip')}
        </button>
      </div>
    </MPopup>
  );
}

// ─── Import ───────────────────────────────────────────────────────────────────
function ImportScreen({ onBack, onContinue }: { onBack: () => void; onContinue: (phrase: string) => void }) {
  const { t } = useSettings();
  const [phrase, setPhrase] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const count = phrase.trim() ? phrase.trim().split(/\s+/).length : 0;
  const lengthOk = count === 12 || count === 24;

  const submit = async () => {
    setError('');
    try {
      const normalized = normalizePhrase(phrase);
      const { Mnemonic } = await import('ethers');
      if (!Mnemonic.isValidMnemonic(normalized)) { setError(t('onboarding.import.invalid')); return; }
      onContinue(normalized);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <MPopup>
      <MHeader title={t('onboarding.import.title')} sub={t('onboarding.import.sub')} onBack={onBack} step={1} of={2} />
      <div style={{ padding: '8px 18px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Chameleon size={96} mood={show ? 'idle' : 'shy'} />
        </div>
        <div style={{ position: 'relative' }}>
          <textarea
            data-testid="import-phrase" aria-label={t('onboarding.import.title')}
            placeholder={t('onboarding.import.placeholder')}
            value={phrase} autoFocus spellCheck={false} autoComplete="off" rows={5}
            onChange={e => { setPhrase(e.target.value); setError(''); }}
            style={{
              width: '100%', background: MX.surface, border: `1px solid ${error ? MX.redBorder : MX.border}`, borderRadius: 12,
              padding: '12px 40px 12px 14px', color: MX.fg, fontSize: 13, fontFamily: MX.mono, resize: 'none', outline: 'none', lineHeight: 1.6,
              // A hidden phrase is still readable by the input; this only keeps it from a shoulder-surfer.
              WebkitTextSecurity: show ? 'none' : 'disc',
            } as React.CSSProperties}
          />
          <button type="button" aria-label={show ? t('common.hide') : t('common.show')} onClick={() => setShow(v => !v)} style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', cursor: 'pointer', color: MX.fgFaint, display: 'flex' }}>
            {show ? <MI.eyeOff size={15} /> : <MI.eye size={15} />}
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: lengthOk ? MX.primary : MX.fgFaint, fontWeight: 600 }}>
          <span>{t('onboarding.import.count', { count })}</span>
          <button type="button" onClick={async () => { try { setPhrase(await navigator.clipboard.readText()); setError(''); } catch { /* clipboard blocked */ } }} style={{ background: 'none', border: 'none', color: MX.primary, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', display: 'flex', gap: 4, alignItems: 'center' }}>
            <MI.paste size={11} /> {t('common.paste')}
          </button>
        </div>
        {error && <Banner tone="error" testId="import-error">{error}</Banner>}
        <Banner tone="info">{t('onboarding.import.note')}</Banner>
        <div style={{ flex: 1, minHeight: 8 }} />
        <MPrimary icon={<MI.next size={15} />} onClick={submit} disabled={!lengthOk} testId="import-continue">{t('common.continue')}</MPrimary>
      </div>
    </MPopup>
  );
}

// ─── Done ─────────────────────────────────────────────────────────────────────
function DoneScreen({ backedUp, onOpen }: { backedUp: boolean; onOpen: () => void }) {
  const { t } = useSettings();
  const [mood, setMood] = useState<ChamMood>('happy');
  useEffect(() => { const id = setTimeout(() => setMood('idle'), 1200); return () => clearTimeout(id); }, []);
  const inTab = surfaceOf() === 'tab';
  return (
    <MPopup>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 22px 20px', textAlign: 'center', overflow: 'auto' }} data-testid="onboarding-done">
        <Chameleon size={160} mood={mood} />
        <h1 style={{ marginTop: 14, fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em' }}>{t('onboarding.done.title')}</h1>
        <div style={{ marginTop: 6, fontSize: 12.5, color: MX.fgMute, lineHeight: 1.5, maxWidth: 300 }}>{t('onboarding.done.body')}</div>

        <div style={{ marginTop: 18, width: '100%', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
          {!backedUp && <Banner tone="warn">{t('onboarding.done.notBackedUp')}</Banner>}
          <Banner tone="info" icon={<MI.panel size={14} />}>{inTab ? t('onboarding.done.pinTab') : t('onboarding.done.pin')}</Banner>
          <Banner tone="info" icon={<MI.faucet size={14} />}>{t('onboarding.done.testnet')}</Banner>
        </div>

        <div style={{ flex: 1, minHeight: 16 }} />
        <MPrimary onClick={onOpen} testId="open-wallet">{t('onboarding.done.open')}</MPrimary>
      </div>
    </MPopup>
  );
}

// ─── Main export — orchestrates all steps ─────────────────────────────────────
export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const wdk = useWDK();
  const { settings, update, t } = useSettings();
  const initial = window.location.hash === '#import' ? 'import' : window.location.hash === '#create' ? 'password' : 'welcome';
  const [step, setStep] = useState<Step>(initial);
  const [path, setPath] = useState<Path>(initial === 'import' ? 'import' : 'create');
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [backedUp, setBackedUp] = useState(false);

  // The action popup closes as soon as it loses focus, which is exactly when someone writes a phrase down.
  // So from the popup, onboarding continues in a tab.
  const start = (p: Path) => {
    if (surfaceOf() === 'popup' && !new URLSearchParams(window.location.search).has('approval')) {
      chrome.tabs.create({ url: chrome.runtime.getURL(`src/popup/index.html?surface=tab#${p}`) });
      window.close();
      return;
    }
    setPath(p);
    setError('');
    setStep(p === 'create' ? 'password' : 'import');
  };

  const finish = async (seed: string, pw: string, didBackUp: boolean) => {
    setBusy(true);
    setError('');
    try {
      await wdk.setupWallet(seed, pw);
      setBackedUp(didBackUp);
      setPhrase('');
      setPassword('');
      setStep('done');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Record the backup once the wallet (and so its id) exists.
  useEffect(() => {
    if (step !== 'done' || !backedUp || !wdk.evmAddress) return;
    const id = wdk.evmAddress.toLowerCase();
    if (!settings.backedUpWallets.includes(id)) update({ backedUpWallets: [...settings.backedUpWallets, id] });
  }, [step, backedUp, wdk.evmAddress, settings.backedUpWallets, update]);

  const onPassword = async (pw: string) => {
    if (path === 'import') return finish(phrase, pw, true);
    setBusy(true);
    setError('');
    try {
      setPassword(pw);
      setPhrase(await wdk.generatePhrase());
      setStep('phrase');
    } catch (e) {
      setError(errorMessage(e, t('onboarding.error.generate')));
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    if (surfaceOf() === 'tab') {
      // Open the docked wallet next to this tab, then get out of the way.
      try {
        const win = await chrome.windows.getCurrent();
        if (chrome.sidePanel && settings.surface === 'panel' && win.id !== undefined) await chrome.sidePanel.open({ windowId: win.id });
      } catch { /* not allowed here: the toolbar icon still works */ }
    }
    onDone();
  };

  switch (step) {
    case 'password':
      return <PasswordScreen path={path} busy={busy} error={error} onBack={() => setStep(path === 'create' ? 'welcome' : 'import')} onSubmit={onPassword} />;
    case 'phrase':
      return <PhraseScreen phrase={phrase} onBack={() => setStep('password')} onContinue={() => setStep('confirm')} />;
    case 'confirm':
      return (
        <ConfirmScreen
          phrase={phrase} busy={busy} error={error}
          onBack={() => setStep('phrase')}
          onConfirmed={() => finish(phrase, password, true)}
          onSkip={() => finish(phrase, password, false)}
        />
      );
    case 'import':
      return <ImportScreen onBack={() => setStep('welcome')} onContinue={p => { setPhrase(p); setStep('password'); }} />;
    case 'done':
      return <DoneScreen backedUp={backedUp} onOpen={open} />;
    default:
      return <WelcomeScreen onCreate={() => start('create')} onImport={() => start('import')} />;
  }
}
