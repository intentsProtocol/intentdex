/**
 * live_scenarios.ts — operator scenarios against a running server with real testnet transfers.
 *   SCENARIO=relay-off npx tsx scripts/live_scenarios.ts
 *
 *   relay-off   relaying switched off: an attested transfer waits; stop it, reopen it, switch relaying on → delivered once
 *   pause       pausing new transfers does not stop one already burned; new ones get 503; resume
 *   parallel    three transfers at once from two wallets, minted on three chains
 *   amounts     several amounts on one route; received = amount − fee every time
 *   fee-hold    (only with a service fee set) the fee transfer is skipped: the mint waits until it is paid
 *
 * Each scenario restores every admin switch it touched. Results append to tests/scenarios.jsonl.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getSecret } from '../src/secrets.js';
import { formatUsdc } from '../src/cctp/encoding.js';
import { getChain } from '../src/config.js';
import { EvmAdapter } from '../src/evm/EvmAdapter.js';
import { SolanaAdapter } from '../src/solana/SolanaAdapter.js';
import { BASE, ROUTES, e2eWallets, signAndSend, startRoute, waitTransfer, type Route } from './e2e_lib.js';

const key = getSecret('ADMIN_API_KEY', { required: true });
async function admin(method: 'GET' | 'POST', p: string, body?: unknown) {
    const res = await fetch(`${BASE}${p}`, {
        method, headers: { 'x-admin-key': key, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    const json: any = await res.json().catch(() => null);
    return { status: res.status, json };
}
const route = (src: string, dst: string, speed: Route['speed'] = 'auto'): Route => ROUTES.find(r => r.src === src && r.dst === dst && r.speed === speed) ?? { n: 0, src, dst, speed, note: '' };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = '') {
    results.push({ name, ok, detail });
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
}

/** Delivered amount on the destination equals what the server recorded (balance can lag a few seconds). */
async function balanceMatches(s: Awaited<ReturnType<typeof startRoute>>, received: string): Promise<string> {
    let delta = 0n;
    for (let i = 0; i < 15; i++) {
        delta = (await s.balance()) - s.before;
        if (delta.toString() === received) break;
        await sleep(2000);
    }
    return delta.toString();
}

async function relayOff() {
    console.log('\n▶ relay-off: Solana devnet → Ethereum Sepolia with relaying switched off');
    await admin('POST', '/admin/settings', { cctp: { relayEnabled: false }, note: 'scenario relay-off' });
    try {
        const s = await startRoute(route('solana-devnet', 'eth-sepolia'));
        console.log(`      transfer ${s.id}  burn ${s.burnTx}`);
        let t = await waitTransfer(s.id, 5 * 60_000, x => x.status === 'ATTESTED');
        check('attested while relaying is off', t.status === 'ATTESTED', t.status);
        await sleep(40_000);
        t = (await admin('GET', `/admin/cctp/transfers/${s.id}`)).json.transfer;
        check('still waiting 40 s later, with the reason shown, no mint sent', t.status === 'ATTESTED' && !t.mintTxHash && /switched off/.test(t.lastError ?? ''), `${t.status} · ${t.lastError}`);
        check('the user could mint it themselves meanwhile (message + attestation exposed)', !!t.selfMint?.message && !!t.selfMint?.attestation);
        const stopped = (await admin('POST', `/admin/cctp/transfers/${s.id}/fail`, { reason: 'scenario: stopped by operator' })).json;
        check('stop → FAILED with the operator reason', stopped.status === 'FAILED' && stopped.failReason === 'scenario: stopped by operator', stopped.status);
        await admin('POST', '/admin/settings', { cctp: { relayEnabled: true } });
        const reopened = (await admin('POST', `/admin/cctp/transfers/${s.id}/reopen`)).json;
        check('reopen resumes at the mint step', reopened.status === 'ATTESTED', reopened.status);
        t = await waitTransfer(s.id, 5 * 60_000);
        check('relaying on → delivered', t.status === 'COMPLETED', `${t.status} mint ${t.mintTxHash}`);
        check('exactly one mint broadcast', (t.mintTxHashes?.length ?? 0) === 1, `${t.mintTxHashes?.length} broadcast(s)`);
        const delta = await balanceMatches(s, t.received);
        check('recipient balance moved by exactly the recorded amount', delta === t.received, `received ${formatUsdc(t.received)} · delta ${formatUsdc(delta)}`);
        const ev = (await admin('GET', `/admin/events?subject=${s.id}&limit=50`)).json.events.map((e: any) => e.type);
        check('the event log has the whole story', ['transfer.created', 'transfer.attested', 'transfer.failed', 'transfer.completed'].every(x => ev.includes(x)), ev.reverse().join(' → '));
    } finally {
        await admin('POST', '/admin/settings', { cctp: { relayEnabled: true } });
    }
}

async function pause() {
    console.log('\n▶ pause: Ethereum Sepolia → Solana devnet, then pause while it is in flight');
    try {
        const s = await startRoute(route('eth-sepolia', 'solana-devnet'));
        console.log(`      transfer ${s.id}  burn ${s.burnTx}`);
        const p = await admin('POST', '/admin/cctp/pause', { reason: 'scenario pause' });
        check('paused', p.json.paused === true);
        const refused = await fetch(`${BASE}/transfers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ src: 'eth-sepolia', dst: 'solana-devnet', amount: '1', sender: '0x318a63dEd371020d25670edeeCeD1E193E8D947E', recipient: 'VBmpGVzabx8AsptQXrA2okEwqFVjbuosHvR2NkuBoaS' }) });
        check('a new transfer while paused → 503', refused.status === 503, String(refused.status));
        const t = await waitTransfer(s.id, 6 * 60_000);
        check('the transfer already burned is still delivered', t.status === 'COMPLETED', `${t.status} in ${Math.round((t.completedAt - t.burnSubmittedAt) / 1000)} s`);
        const delta = await balanceMatches(s, t.received);
        check('balance matches', delta === t.received, `received ${formatUsdc(t.received)} · delta ${formatUsdc(delta)}`);
    } finally {
        await admin('POST', '/admin/cctp/resume');
    }
}

async function parallel() {
    console.log('\n▶ parallel: three transfers at once, minted on Ethereum Sepolia, Arc and Solana');
    const routes = [route('solana-devnet', 'eth-sepolia'), route('solana-devnet', 'arc-testnet'), route('eth-sepolia', 'solana-devnet')];
    // The test wallets send and receive at the same time, so balances are checked per wallet, net of every transfer.
    const w = e2eWallets();
    const walletOn = (chain: string) => (getChain(chain)!.kind === 'evm' ? w.evm.address : w.sol.publicKey.toBase58());
    const adapter = (chain: string) => { const c = getChain(chain)!; return c.kind === 'evm' ? new EvmAdapter(c) : new SolanaAdapter(c); };
    const chains = [...new Set(routes.flatMap(r => [r.src, r.dst]))];
    const before = Object.fromEntries(await Promise.all(chains.map(async c => [c, await adapter(c).usdcBalance(walletOn(c))] as const)));
    const started = await Promise.allSettled(routes.map(r => startRoute(r)));
    for (const [i, s] of started.entries()) {
        if (s.status === 'rejected') { check(`${routes[i].src} → ${routes[i].dst} started`, false, String(s.reason?.message ?? s.reason)); continue; }
        console.log(`      ${routes[i].src} → ${routes[i].dst}  ${s.value.id}`);
    }
    const done = await Promise.all(started.map(async (s, i) => {
        if (s.status !== 'fulfilled') return null;
        const t = await waitTransfer(s.value.id, 8 * 60_000).catch(e => ({ status: 'TIMEOUT', lastError: e.message }));
        check(`${routes[i].src} → ${routes[i].dst} delivered in parallel`, t.status === 'COMPLETED' && (t.mintTxHashes?.length ?? 0) === 1,
            `${t.status} · received ${t.received ? formatUsdc(t.received) : '-'} · ${t.completedAt ? Math.round((t.completedAt - t.burnSubmittedAt) / 1000) + ' s' : t.lastError ?? ''}`);
        return t;
    }));
    await sleep(6000);
    for (const c of chains) {
        let expected = 0n;
        for (const [i, t] of done.entries()) {
            if (!t || t.status !== 'COMPLETED') continue;
            if (routes[i].dst === c) expected += BigInt(t.received);
            if (routes[i].src === c) expected -= BigInt(t.amount);
        }
        let delta = 0n;
        for (let k = 0; k < 10; k++) { delta = (await adapter(c).usdcBalance(walletOn(c))) - before[c]; if (delta === expected) break; await sleep(2000); }
        check(`${c}: test wallet USDC moved by exactly received − sent`, delta === expected, `expected ${formatUsdc(expected)} · actual ${formatUsdc(delta)}`);
    }
}

async function amounts() {
    const r = route('solana-devnet', 'eth-sepolia');
    console.log(`\n▶ amounts: ${r.src} → ${r.dst} with several amounts`);
    for (const amount of (process.env.AMOUNTS || '1.5,2.25,3').split(',')) {
        const s = await startRoute(r, amount);
        const t = await waitTransfer(s.id, 5 * 60_000);
        const delta = t.status === 'COMPLETED' ? await balanceMatches(s, t.received) : 'n/a';
        const fee = t.received ? BigInt(t.amount) - BigInt(t.received) : -1n;
        check(`${amount} USDC: delivered, received = amount − fee, fee within the quoted max`, t.status === 'COMPLETED' && delta === t.received && fee >= 0n && fee <= BigInt(t.maxFee),
            `${t.status} · received ${t.received ? formatUsdc(t.received) : '-'} · fee ${fee >= 0n ? formatUsdc(fee) : '-'} (max ${formatUsdc(t.maxFee)})`);
    }
}

/** A user who skips the fee transfer: the mint waits; paying the fee later releases it. Needs a fee and a treasury wallet set. */
async function feeHold() {
    const r = route('base-sepolia', 'arc-testnet');
    console.log(`
▶ fee-hold: ${r.src} → ${r.dst}, burn sent but the fee transfer skipped`);
    const s = await startRoute(r, '1', { skipFee: true });
    const feeTx = s.txs.find(t => t.kind === 'fee');
    if (!feeTx || !s.quote.feeRecipient) { check('a service fee is configured for this route', false, 'set cctp.feeBps and create an EVM treasury wallet first'); return; }
    const fee = BigInt(s.quote.protocolFee);
    console.log(`      transfer ${s.id}  burn ${s.burnTx}  fee owed ${formatUsdc(fee)} USDC to ${s.quote.feeRecipient}`);
    const treasury = new EvmAdapter(getChain(r.src)!);
    const before = await treasury.usdcBalance(s.quote.feeRecipient);
    let t = await waitTransfer(s.id, 5 * 60_000, x => x.status === 'ATTESTED' && x.feeStatus === 'awaiting');
    check('attested, and the mint is on hold for the fee', t.status === 'ATTESTED' && t.feeStatus === 'awaiting' && !t.mintTxHash, `${t.status} · ${t.feeStatus} · ${t.lastError}`);
    await sleep(30_000);
    t = (await admin('GET', `/admin/cctp/transfers/${s.id}`)).json.transfer;
    check('still held 30 s later; the user could mint it themselves', t.status === 'ATTESTED' && !t.mintTxHash && !!t.selfMint?.attestation, `${t.status} · ${t.lastError}`);
    const wrong = await fetch(`${BASE}/transfers/${s.id}/fee`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash: s.burnTx }) });
    check('offering the burn hash as the fee is refused', wrong.status === 400, String(wrong.status));
    const paid = await signAndSend(r.src, [feeTx]);
    const posted = await fetch(`${BASE}/transfers/${s.id}/fee`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash: paid.feeHash }) });
    check('fee transfer sent and its hash accepted', posted.status === 200 && !!paid.feeHash, `${posted.status} ${paid.feeHash}`);
    t = await waitTransfer(s.id, 5 * 60_000);
    check('fee seen → delivered, fee marked paid', t.status === 'COMPLETED' && t.feeStatus === 'paid', `${t.status} · ${t.feeStatus} · mint ${t.mintTxHash}`);
    const got = (await treasury.usdcBalance(s.quote.feeRecipient)) - before;
    check('the treasury received exactly the fee', got === fee, `expected ${formatUsdc(fee)} · got ${formatUsdc(got)}`);
    const delta = await balanceMatches(s, t.received);
    check('the recipient received exactly the recorded amount', delta === t.received, `received ${formatUsdc(t.received)} · delta ${formatUsdc(delta)}`);
}

const SCENARIOS: Record<string, () => Promise<void>> = { 'relay-off': relayOff, pause, parallel, amounts, 'fee-hold': feeHold };
const pick = (process.env.SCENARIO || 'relay-off,pause,parallel,amounts').split(',');
for (const name of pick) {
    const fn = SCENARIOS[name];
    if (!fn) { console.log(`unknown scenario ${name}`); continue; }
    try { await fn(); } catch (e: any) { check(`${name} ran to the end`, false, e.message); }
}
const file = path.resolve('tests', 'scenarios.jsonl');
for (const r of results) fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...r }) + '\n');
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} scenario checks passed`);
process.exit(failed ? 1 : 0);
