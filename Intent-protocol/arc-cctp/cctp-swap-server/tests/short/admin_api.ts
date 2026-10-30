/**
 * /admin/* against a running server. Flips real switches (pause, closed chain, stocks, blocklist) and puts every
 * one back before it ends, so it is safe to run against the server you are testing with. Needs ADMIN_API_KEY.
 */
import { Keypair } from '@solana/web3.js';
import { BASE, http, serverUp } from '../lib/env.js';
import { check, finish, skip, suite } from '../lib/report.js';

suite('short/admin_api');
if (!(await serverUp())) { skip('all admin checks', 'server not running (npm run dev)'); process.exit(finish()); }
const key = process.env.ADMIN_API_KEY;
if (!key) { skip('all admin checks', 'ADMIN_API_KEY not set in this shell'); process.exit(finish()); }

async function admin(method: 'GET' | 'POST', path: string, body?: unknown, k = key): Promise<{ status: number; json: any }> {
    const headers: Record<string, string> = { 'x-admin-key': k ?? '' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    return { status: res.status, json: await res.json().catch(() => null) };
}

const DEAD = '0x000000000000000000000000000000000000dEaD';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TSLAX = 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB';

// auth
check('no key → 401', (await http('GET', '/admin/overview')).status === 401, { severity: 'CRITICAL' });
check('wrong key → 401 on reads and on actions', (await admin('GET', '/admin/overview', undefined, 'wrong')).status === 401
    && (await admin('POST', '/admin/cctp/pause', {}, 'wrong')).status === 401 && (await admin('POST', '/admin/settings', { cctp: { paused: true } }, 'wrong')).status === 401, { severity: 'CRITICAL' });
check('auth/check with the key → 200', (await admin('GET', '/admin/auth/check')).status === 200);

// remember the settings so the suite can put them back
const before = (await admin('GET', '/admin/settings')).json.settings;
const restore = async () => {
    await admin('POST', '/admin/settings', {
        cctp: { paused: before.cctp.paused, relayEnabled: before.cctp.relayEnabled, fastEnabled: before.cctp.fastEnabled, minTransferUsdc: before.cctp.minTransferUsdc, maxTransferUsdc: before.cctp.maxTransferUsdc, disabledChains: before.cctp.disabledChains, disabledRoutes: before.cctp.disabledRoutes,
            feeBps: before.cctp.feeBps, feeMinUsdc: before.cctp.feeMinUsdc, feeMaxUsdc: before.cctp.feeMaxUsdc, gasFeeUsdc: before.cctp.gasFeeUsdc, feeEnforced: before.cctp.feeEnforced },
        solana: { paused: before.solana.paused, stocksEnabled: before.solana.stocksEnabled, allowUnverified: before.solana.allowUnverified, maxSlippageBps: before.solana.maxSlippageBps, defaultSlippageBps: before.solana.defaultSlippageBps, maxSwapUsd: before.solana.maxSwapUsd, blockedMints: before.solana.blockedMints },
        note: 'admin_api test: restore',
    });
};

try {
    // overview
    const o = (await admin('GET', '/admin/overview')).json;
    check('overview has both products, chains with relayer gas, alerts and events', o.cctp.stats.total >= 0 && o.cctp.chains.length >= 6 && o.cctp.chains.every((c: any) => c.relayer)
        && Array.isArray(o.alerts) && o.solana.stats.total >= 0 && Array.isArray(o.events.recent) && o.cctp.stats.hourly.length === 24, { severity: 'CRITICAL', detail: `${o.cctp.chains.length} chains, ${o.alerts.length} alerts` });
    check('overview never leaks a secret', !/PRIVATE|secretKey|signedTransaction/i.test(JSON.stringify(o)), { severity: 'CRITICAL' });
    const sys = (await admin('GET', '/admin/system')).json;
    check('system lists secret names only', Array.isArray(sys.secrets) && sys.secrets.every((s: string) => /^[A-Z0-9_]+$/.test(s)) && sys.memoryMb > 0, { severity: 'HIGH', detail: sys.secrets.join(',') });

    // cross-chain: pause
    const p = await admin('POST', '/admin/cctp/pause', { reason: 'admin_api test' });
    check('cctp pause → paused, reason kept', p.status === 200 && p.json.paused === true && p.json.settings.pauseReason === 'admin_api test', { severity: 'HIGH' });
    check('paused: new transfers 503, quotes still 200, /health says paused', (await http('POST', '/transfers', { src: 'base-sepolia', dst: 'arc-testnet', amount: '1', sender: DEAD, recipient: RECIPIENT })).status === 503
        && (await http('GET', '/quote?src=base-sepolia&dst=arc-testnet&amount=1')).status === 200 && (await http('GET', '/health')).json.paused === true, { severity: 'CRITICAL' });
    const refused = await http('POST', '/transfers', { src: 'base-sepolia', dst: 'arc-testnet', amount: '1', sender: DEAD, recipient: RECIPIENT });
    const pausedCfg = (await http('GET', '/config')).json;
    check('paused: the refusal carries code PAUSED, and /config says paused with the reason', refused.json?.code === 'PAUSED' && pausedCfg.cctp.paused === true && pausedCfg.cctp.pauseReason === 'admin_api test'
        && pausedCfg.solana.paused === false, { severity: 'CRITICAL', detail: `${refused.status} ${refused.json?.code}` });
    check('paused shows as an alert', (await admin('GET', '/admin/overview')).json.alerts.some((a: any) => a.section === 'cctp' && /paused/.test(a.text)), { severity: 'HIGH' });
    check('cctp resume → transfers accepted again', (await admin('POST', '/admin/cctp/resume')).json.paused === false
        && (await http('POST', '/transfers', { src: 'base-sepolia', dst: 'arc-testnet', amount: '1', sender: DEAD, recipient: RECIPIENT })).status === 201, { severity: 'CRITICAL' });

    // cross-chain: chains and routes
    check('close a chain → gone from /chains, quotes to it 503', (await admin('POST', '/admin/cctp/chains/op-sepolia', { open: false })).json.open === false
        && !(await http('GET', '/chains')).json.some((c: any) => c.key === 'op-sepolia')
        && (await http('GET', '/quote?src=base-sepolia&dst=op-sepolia&amount=1')).status === 503 && (await http('GET', '/quote?src=op-sepolia&dst=base-sepolia&amount=1')).status === 503, { severity: 'CRITICAL' });
    check('closed chain: code ROUTE_CLOSED, and /config no longer lists it', (await http('GET', '/quote?src=base-sepolia&dst=op-sepolia&amount=1')).json?.code === 'ROUTE_CLOSED'
        && !(await http('GET', '/config')).json.cctp.chains.some((c: any) => c.key === 'op-sepolia'), { severity: 'HIGH' });
    check('other routes unaffected', (await http('GET', '/quote?src=base-sepolia&dst=arc-testnet&amount=1')).status === 200, { severity: 'HIGH' });
    check('reopen the chain', (await admin('POST', '/admin/cctp/chains/op-sepolia', { open: true })).json.open === true && (await http('GET', '/quote?src=base-sepolia&dst=op-sepolia&amount=1')).status === 200, { severity: 'HIGH' });
    check('unknown chain → 404; bad body → 400', (await admin('POST', '/admin/cctp/chains/mars', { open: false })).status === 404 && (await admin('POST', '/admin/cctp/chains/op-sepolia', {})).status === 400);
    check('close one route → that direction 503, the reverse open', (await admin('POST', '/admin/cctp/routes', { src: 'base-sepolia', dst: 'arb-sepolia', open: false })).json.open === false
        && (await http('GET', '/quote?src=base-sepolia&dst=arb-sepolia&amount=1')).status === 503 && (await http('GET', '/quote?src=arb-sepolia&dst=base-sepolia&amount=1')).status === 200, { severity: 'HIGH' });
    check('closed route: code ROUTE_CLOSED, listed in /config closedRoutes', (await http('GET', '/quote?src=base-sepolia&dst=arb-sepolia&amount=1')).json?.code === 'ROUTE_CLOSED'
        && (await http('GET', '/config')).json.cctp.closedRoutes.includes('base-sepolia>arb-sepolia'), { severity: 'HIGH' });
    await admin('POST', '/admin/cctp/routes', { src: 'base-sepolia', dst: 'arb-sepolia', open: true });

    // cross-chain: limits and Fast
    await admin('POST', '/admin/settings', { cctp: { maxTransferUsdc: 2 } });
    check('lowered maximum applies to the next quote', (await http('GET', '/quote?src=base-sepolia&dst=arc-testnet&amount=5')).status === 400 && (await http('GET', '/quote?src=base-sepolia&dst=arc-testnet&amount=2')).status === 200, { severity: 'CRITICAL' });
    await admin('POST', '/admin/settings', { cctp: { maxTransferUsdc: before.cctp.maxTransferUsdc, fastEnabled: false } });
    const std = await http('GET', '/quote?src=base-sepolia&dst=arc-testnet&amount=1');
    check('Fast off → auto quotes Standard, speed=fast refused', std.json.speed === 'standard' && (await http('GET', '/quote?src=base-sepolia&dst=arc-testnet&amount=1&speed=fast')).status === 400, { severity: 'HIGH', detail: std.json.speed });
    await admin('POST', '/admin/settings', { cctp: { fastEnabled: true } });
    check('invalid setting → 400 and nothing changes', (await admin('POST', '/admin/settings', { cctp: { maxTransferUsdc: -1 } })).status === 400
        && (await admin('POST', '/admin/settings', { cctp: { nope: true } })).status === 400 && (await admin('GET', '/admin/settings')).json.settings.cctp.maxTransferUsdc === before.cctp.maxTransferUsdc, { severity: 'HIGH' });

    // cross-chain: transfers and actions
    const c = await http('POST', '/transfers', { src: 'base-sepolia', dst: 'arc-testnet', amount: '1', sender: DEAD, recipient: RECIPIENT });
    const id = c.json.transfer.id;
    const list = (await admin('GET', '/admin/cctp/transfers?status=CREATED&limit=200')).json;
    check('transfer list: filter by status, counts by status', list.transfers.some((t: any) => t.id === id) && list.transfers.every((t: any) => t.status === 'CREATED') && list.byStatus.CREATED >= 1, { severity: 'HIGH' });
    check('transfer list: search by id', (await admin('GET', `/admin/cctp/transfers?q=${id}`)).json.total === 1);
    const det = (await admin('GET', `/admin/cctp/transfers/${id}`)).json;
    check('transfer detail carries its events', det.transfer.id === id && det.events.some((e: any) => e.type === 'transfer.created'), { severity: 'HIGH' });
    check('reopen refuses a transfer that is not FAILED (409)', (await admin('POST', `/admin/cctp/transfers/${id}/reopen`)).status === 409);
    const stopped = await admin('POST', `/admin/cctp/transfers/${id}/fail`, { reason: 'admin_api test' });
    check('stop an unburned transfer → EXPIRED with the reason', stopped.json.status === 'EXPIRED' && stopped.json.failReason === 'admin_api test', { severity: 'HIGH' });
    check('stop / retry on a finished transfer → 409', (await admin('POST', `/admin/cctp/transfers/${id}/fail`)).status === 409 && (await admin('POST', `/admin/cctp/transfers/${id}/retry`)).status === 409);
    check('unknown transfer → 404', (await admin('GET', '/admin/cctp/transfers/nope')).status === 404);
    const bal = (await admin('GET', '/admin/cctp/balances')).json;
    check('balances per chain with a low flag', bal.balances.length >= 6 && bal.balances.every((b: any) => b.error || typeof b.low === 'boolean'), { detail: bal.balances.map((b: any) => `${b.chain}:${b.amount ?? b.error}`).join(' ') });

    // Solana
    const sp = await admin('POST', '/admin/solana/pause', { reason: 'admin_api test' });
    check('solana pause → new swaps 503', sp.json.paused === true
        && (await http('POST', '/solana/swaps', { inputMint: USDC, outputMint: SOL, amount: '1000000', taker: Keypair.generate().publicKey.toBase58() })).status === 503
        && (await http('GET', '/health')).json.solanaSwaps.paused === true, { severity: 'CRITICAL' });
    check('solana pause: code PAUSED, /config says so', (await http('POST', '/solana/swaps', { inputMint: USDC, outputMint: SOL, amount: '1000000', taker: Keypair.generate().publicKey.toBase58() })).json?.code === 'PAUSED'
        && (await http('GET', '/config')).json.solana.paused === true, { severity: 'CRITICAL' });
    check('solana pause does not pause cross-chain', (await http('GET', '/health')).json.paused === false, { severity: 'CRITICAL' });
    check('solana resume', (await admin('POST', '/admin/solana/resume')).json.paused === false && (await http('GET', '/health')).json.solanaSwaps.paused === false, { severity: 'HIGH' });

    await admin('POST', '/admin/settings', { solana: { stocksEnabled: false } });
    check('stocks off → /solana/stocks 403, stock gone from lists and from /tokens/:mint, quote 403', (await http('GET', '/solana/stocks')).status === 403
        && (await http('GET', '/solana/tokens?q=TSLAx')).json.tokens.every((t: any) => !t.isStock) && (await http('GET', `/solana/tokens/${TSLAX}`)).status === 404
        && (await http('GET', `/solana/quote?inputMint=${USDC}&outputMint=${TSLAX}&amount=1000000`)).status === 403, { severity: 'CRITICAL' });
    check('stocks off: code STOCKS_DISABLED on the list and on a stock quote, /config says off', (await http('GET', '/solana/stocks')).json?.code === 'STOCKS_DISABLED'
        && (await http('GET', `/solana/quote?inputMint=${USDC}&outputMint=${TSLAX}&amount=1000000`)).json?.code === 'STOCKS_DISABLED'
        && (await http('GET', '/config')).json.solana.stocksEnabled === false, { severity: 'CRITICAL' });
    await admin('POST', '/admin/settings', { solana: { stocksEnabled: true } });
    check('stocks back on', (await http('GET', '/solana/stocks?limit=1')).status === 200, { severity: 'HIGH' });
    check('stocks back on: /config follows', (await http('GET', '/config')).json.solana.stocksEnabled === true, { severity: 'HIGH' });

    const blk = await admin('POST', '/admin/solana/tokens/block', { mint: TSLAX, blocked: true });
    check('block a token → named in the blocklist, hidden, quote 403', blk.json.blockedMints.some((t: any) => t.mint === TSLAX && t.symbol === 'TSLAx')
        && (await http('GET', `/solana/tokens/${TSLAX}`)).status === 404 && (await http('GET', `/solana/quote?inputMint=${TSLAX}&outputMint=${USDC}&amount=1000000`)).status === 403, { severity: 'CRITICAL' });
    check('blocked token: code TOKEN_BLOCKED', (await http('GET', `/solana/quote?inputMint=${TSLAX}&outputMint=${USDC}&amount=1000000`)).json?.code === 'TOKEN_BLOCKED', { severity: 'HIGH' });
    check('unblock restores it', (await admin('POST', '/admin/solana/tokens/block', { mint: TSLAX, blocked: false })).json.blockedMints.every((t: any) => t.mint !== TSLAX)
        && (await http('GET', `/solana/tokens/${TSLAX}`)).status === 200, { severity: 'HIGH' });
    check('block: bad mint → 400', (await admin('POST', '/admin/solana/tokens/block', { mint: 'nope', blocked: true })).status === 400);
    const sw = (await admin('GET', '/admin/solana/swaps?limit=5')).json;
    check('swap list answers with counts', Array.isArray(sw.swaps) && typeof sw.total === 'number' && !JSON.stringify(sw).includes('signedTransaction'), { severity: 'HIGH' });
    check('unknown swap → 404', (await admin('GET', '/admin/solana/swaps/nope')).status === 404 && (await admin('POST', '/admin/solana/swaps/nope/recheck')).status === 404);

    // profits, margins, treasury
    const pr = (await admin('GET', '/admin/profits')).json;
    check('profits: stats for both products, a 14-day series, margins, wallets, referral status', typeof pr.stats.cctp.paid === 'string' && pr.stats.daily.length === 14 && typeof pr.stats.solana.estimatedUsd === 'number'
        && typeof pr.collecting.evm === 'boolean' && Array.isArray(pr.treasury) && Array.isArray(pr.referral.tokenAccounts), { severity: 'CRITICAL', detail: `paid ${pr.stats.cctp.paid} · ${pr.treasury.length} wallet(s)` });
    check('profits and treasury never carry a key', !/"secret"|privateKey|secretKey/i.test(JSON.stringify(pr)) && !/"secret"|privateKey/i.test(JSON.stringify((await admin('GET', '/admin/treasury')).json)), { severity: 'CRITICAL' });
    check('profits without the key → 401', (await http('GET', '/admin/profits')).status === 401 && (await http('POST', '/admin/treasury/wallets', { kind: 'evm' })).status === 401, { severity: 'CRITICAL' });

    const evmActive = pr.treasury.find((w: any) => w.kind === 'evm' && w.active);
    await admin('POST', '/admin/settings', { cctp: { feeBps: 50, feeMinUsdc: 0, feeMaxUsdc: 0, gasFeeUsdc: { 'arc-testnet': 0.02 } } });
    const fq = (await http('GET', '/quote?src=base-sepolia&dst=arc-testnet&amount=10')).json;
    if (evmActive) {
        check('margin applies to the next quote: 50 bps + destination gas charge, paid to the active treasury', fq.protocolFee === '70000' && fq.feeRecipient === evmActive.address && fq.burnAmount === '9930000', { severity: 'CRITICAL', detail: `${fq.protocolFee} → ${fq.feeRecipient}` });
        check('other destinations carry no gas charge', (await http('GET', '/quote?src=base-sepolia&dst=op-sepolia&amount=10')).json.protocolFee === '50000', { severity: 'HIGH' });
        await admin('POST', '/admin/settings', { cctp: { feeMinUsdc: 0.25 } });
        check('minimum fee lifts small transfers', (await http('GET', '/quote?src=base-sepolia&dst=op-sepolia&amount=10')).json.protocolFee === '250000', { severity: 'HIGH' });
        await admin('POST', '/admin/settings', { cctp: { feeMinUsdc: 0, feeMaxUsdc: 0.03 } });
        check('maximum fee caps the rate part', (await http('GET', '/quote?src=base-sepolia&dst=op-sepolia&amount=10')).json.protocolFee === '30000', { severity: 'HIGH' });
        const ft = await http('POST', '/transfers', { src: 'base-sepolia', dst: 'op-sepolia', amount: '10', sender: DEAD, recipient: RECIPIENT });
        check('fee hash: garbage → 400', (await http('POST', `/transfers/${ft.json.transfer.id}/fee`, { txHash: 'zz' })).status === 400, { severity: 'HIGH' });
        await admin('POST', `/admin/cctp/transfers/${ft.json.transfer.id}/fail`, { reason: 'admin_api test' });
    } else {
        check('a margin with no treasury wallet charges nothing', fq.protocolFee === '0' && fq.burnAmount === '10000000', { severity: 'CRITICAL' });
    }
    check('fee settings validated', (await admin('POST', '/admin/settings', { cctp: { feeBps: 5000 } })).status === 400 && (await admin('POST', '/admin/settings', { cctp: { gasFeeUsdc: { mars: 1 } } })).status === 400, { severity: 'HIGH' });

    // treasury wallets: add a watch-only address, switch to it and back, archive it
    const ext = await admin('POST', '/admin/treasury/wallets', { kind: 'evm', address: '0x00000000000000000000000000000000000A11cE', label: 'admin_api test' });
    check('add an external wallet → 201, watch-only, with balances per chain', ext.status === 201 && ext.json.wallet.origin === 'external' && ext.json.wallet.hasKey === false && ext.json.wallet.balances.length >= 5, { severity: 'HIGH', detail: `${ext.status} ${ext.json?.error ?? ''}` });
    check('same address again → 409; bad address → 400; bad kind → 400', (await admin('POST', '/admin/treasury/wallets', { kind: 'evm', address: '0x00000000000000000000000000000000000A11cE' })).status === 409
        && (await admin('POST', '/admin/treasury/wallets', { kind: 'evm', address: '0x12' })).status === 400 && (await admin('POST', '/admin/treasury/wallets', { kind: 'btc' })).status === 400, { severity: 'HIGH' });
    if (evmActive && ext.status === 201) {
        check('activate → new quotes pay the new wallet', (await admin('POST', `/admin/treasury/wallets/${ext.json.wallet.id}/activate`)).json.wallet.active === true
            && (await http('GET', '/quote?src=base-sepolia&dst=op-sepolia&amount=10')).json.feeRecipient === ext.json.wallet.address, { severity: 'CRITICAL' });
        check('the active wallet cannot be archived (409)', (await admin('POST', `/admin/treasury/wallets/${ext.json.wallet.id}/archive`)).status === 409, { severity: 'HIGH' });
        await admin('POST', `/admin/treasury/wallets/${evmActive.id}/activate`);
        check('switched back; the test wallet archived', (await http('GET', '/quote?src=base-sepolia&dst=op-sepolia&amount=10')).json.feeRecipient === evmActive.address
            && (await admin('POST', `/admin/treasury/wallets/${ext.json.wallet.id}/archive`)).json.wallet.archived === true, { severity: 'CRITICAL' });
    }
    check('unknown wallet → 404', (await admin('POST', '/admin/treasury/wallets/nope/activate')).status === 404);
    const ref = (await admin('GET', '/admin/solana/referral')).json;
    check('referral status lists the fee currencies (SOL, USDC, USDT)', ['SOL', 'USDC', 'USDT'].every(sym => ref.feeMints.some((m: any) => m.symbol === sym)), { severity: 'HIGH', detail: ref.feeMints.map((m: any) => m.symbol).join(',') });
    check('Solana fee without a referral account → 400', !!ref.account || (await admin('POST', '/admin/settings', { solana: { referralFeeBps: 50 } })).status === 400, { severity: 'HIGH' });

    // events
    const ev = (await admin('GET', '/admin/events?type=admin.&limit=100')).json;
    const types = new Set(ev.events.map((e: any) => e.type));
    check('every action above is in the event log', ['admin.pause', 'admin.resume', 'admin.chain.close', 'admin.chain.open', 'admin.route.close', 'admin.settings', 'admin.transfer.fail', 'admin.token.block', 'admin.token.unblock'].every(t => types.has(t)),
        { severity: 'HIGH', detail: [...types].join(' ') });
    check('events filter by product', (await admin('GET', '/admin/events?section=solana&limit=50')).json.events.every((e: any) => e.section === 'solana'));
    const note = await admin('POST', '/admin/events/note', { text: 'admin_api test note', section: 'cctp' });
    check('notes are recorded; an empty note is refused', note.json.event.summary === 'admin_api test note' && (await admin('POST', '/admin/events/note', { text: ' ' })).status === 400);
    check('settings history lists the changes', (await admin('GET', '/admin/settings')).json.history.length > 0);
} finally {
    await restore();
}
const after = (await admin('GET', '/admin/settings')).json.settings;
check('every switch is back where the suite found it', JSON.stringify({ ...after, updatedAt: 0 }) === JSON.stringify({ ...before, updatedAt: 0 }), { severity: 'CRITICAL', detail: JSON.stringify(after.cctp).slice(0, 160) });

process.exit(finish());
