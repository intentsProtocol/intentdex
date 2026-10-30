/**
 * REST checks against a running server (npm run dev). No funded wallets needed:
 * transfers are built for 0x…dEaD, which holds testnet USDC on Base Sepolia.
 */
import { ethers } from 'ethers';
import { Keypair, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_MESSENGER_ABI, ERC20_ABI } from '../../src/evm/EvmAdapter.js';
import { evmToBytes32, solanaToBytes32 } from '../../src/cctp/encoding.js';
import { BASE, http, serverUp } from '../lib/env.js';
import { check, finish, skip, suite } from '../lib/report.js';

suite('short/rest_api');
if (!(await serverUp())) { skip('all REST checks', 'server not running (npm run dev)'); process.exit(finish()); }

const DEAD = '0x000000000000000000000000000000000000dEaD';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const tm = new ethers.Interface(TOKEN_MESSENGER_ABI);
const erc20 = new ethers.Interface(ERC20_ABI);

// health + chains
const h = await http('GET', '/health');
check('/health 200 with chains', h.status === 200 && h.json.chains.length >= 6, { severity: 'HIGH', detail: JSON.stringify(h.json.chains) });
const chains = (await http('GET', '/chains')).json as any[];
const arc = chains.find(c => c.key === 'arc-testnet');
check('/chains: Arc domain 26, chainId 5042002, 20 gwei floor, not a Fast source',
    arc?.domain === 26 && arc?.chainId === 5042002 && arc?.minMaxFeePerGasGwei === 20 && arc?.fastSource === false, { severity: 'HIGH' });
check('/chains: Solana devnet programs', chains.find(c => c.key === 'solana-devnet')?.messageTransmitter === 'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC');

// config: one call for both products
const cfg = (await http('GET', '/config')).json;
check('/config: the chains of /chains, the pause state of /health', cfg?.cctp?.chains.map((c: any) => c.key).join() === chains.map(c => c.key).join()
    && JSON.stringify(cfg.cctp.chains[0]) === JSON.stringify(chains[0]) && cfg.cctp.paused === h.json.paused && cfg.cctp.network === 'testnet', { severity: 'HIGH' });
check('/config: limits, TTL and fee policy for the form', cfg.cctp.minTransferUsdc > 0 && cfg.cctp.maxTransferUsdc >= cfg.cctp.minTransferUsdc && cfg.cctp.createdTtlSec >= 60
    && typeof cfg.cctp.fee.bps === 'number' && typeof cfg.cctp.fee.enforced === 'boolean' && typeof cfg.cctp.fee.collecting.evm === 'boolean' && Array.isArray(cfg.cctp.closedRoutes), { severity: 'HIGH', detail: JSON.stringify(cfg.cctp.fee) });
check('/config: Solana swaps on mainnet with slippage bounds and the stocks switch', cfg.solana.network === 'mainnet' && cfg.solana.enabled === h.json.solanaSwaps.enabled && cfg.solana.stocksEnabled === h.json.solanaSwaps.stocksEnabled
    && cfg.solana.slippage.maxBps >= cfg.solana.slippage.defaultBps && cfg.solana.orderTtlSec > 0 && cfg.solana.nativeMint === 'So11111111111111111111111111111111111111112', { severity: 'HIGH', detail: JSON.stringify(cfg.solana) });
check('/config: server time, and nothing private', Math.abs(cfg.serverTime - Date.now()) < 60_000 && !/rpc|secret|private|apiKey|relayer/i.test(JSON.stringify(cfg)), { severity: 'CRITICAL' });
check('/config: the quoted fee follows the fee policy', (BigInt((await http('GET', '/quote?src=base-sepolia&dst=arc-testnet&amount=1')).json.protocolFee) > 0n) === cfg.cctp.fee.collecting.evm, { severity: 'HIGH' });

// quotes
const q = await http('GET', '/quote?src=base-sepolia&dst=arc-testnet&amount=1');
check('quote Base→Arc: 200, Fast, threshold 1000', q.status === 200 && q.json.speed === 'fast' && q.json.minFinalityThreshold === 1000, { severity: 'HIGH', detail: JSON.stringify(q.json).slice(0, 220) });
check('quote maxFee ≥ expectedFee; burn = amount − our fee; receive = burn − Circle fee', BigInt(q.json.maxFee) >= BigInt(q.json.expectedFee)
    && BigInt(q.json.burnAmount) === 1_000_000n - BigInt(q.json.protocolFee)
    && BigInt(q.json.expectedReceive) === BigInt(q.json.burnAmount) - BigInt(q.json.expectedFee), { severity: 'HIGH', detail: `our fee ${q.json.protocolFee}` });
const qa = await http('GET', '/quote?src=arc-testnet&dst=base-sepolia&amount=1');
check('quote Arc→Base: Standard', qa.json.speed === 'standard' && qa.json.minFinalityThreshold === 2000, { severity: 'HIGH' });
for (const [name, path, code, errorCode] of [
    ['unknown chain', '/quote?src=nope&dst=arc-testnet&amount=1', 400, 'UNKNOWN_CHAIN'],
    ['same chain', '/quote?src=arc-testnet&dst=arc-testnet&amount=1', 400, 'SAME_CHAIN'],
    ['below minimum', '/quote?src=base-sepolia&dst=arc-testnet&amount=0.5', 400, 'BELOW_MINIMUM'],
    ['above maximum', '/quote?src=base-sepolia&dst=arc-testnet&amount=100000000', 400, 'ABOVE_MAXIMUM'],
    ['non-numeric amount', '/quote?src=base-sepolia&dst=arc-testnet&amount=abc', 400, 'INVALID_AMOUNT'],
    ['7 decimals', '/quote?src=base-sepolia&dst=arc-testnet&amount=1.0000001', 400, 'INVALID_AMOUNT'],
    ['Fast from Arc', '/quote?src=arc-testnet&dst=base-sepolia&amount=1&speed=fast', 400, 'FAST_UNAVAILABLE'],
    ['bad speed', '/quote?src=base-sepolia&dst=arc-testnet&amount=1&speed=warp', 400, 'INVALID_SPEED'],
] as const) {
    const r = await http('GET', path);
    check(`quote rejects ${name} (${code})`, r.status === code, { severity: 'MEDIUM', detail: `${r.status} ${r.json?.error}` });
    check(`quote rejects ${name} with code ${errorCode}`, r.json?.code === errorCode && typeof r.json?.error === 'string', { severity: 'HIGH', detail: `${r.json?.code}` });
}

// build EVM → EVM
const c = await http('POST', '/transfers', { src: 'base-sepolia', dst: 'arc-testnet', amount: '1', sender: DEAD, recipient: RECIPIENT });
check('POST /transfers Base→Arc: 201', c.status === 201, { severity: 'CRITICAL', detail: `${c.status} ${c.json?.error ?? ''}` });
if (c.status === 201) {
    const burn = c.json.txs.find((t: any) => t.kind === 'burn');
    const args = tm.decodeFunctionData('depositForBurn', burn.data);
    check('burn tx targets TokenMessengerV2 on chain 84532', burn.to === '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA' && burn.chainId === 84532, { severity: 'CRITICAL' });
    const burned = BigInt(c.json.quote.burnAmount);
    check('burn args: amount (after our fee), domain 26, recipient, USDC', args[0] === burned && Number(args[1]) === 26
        && args[2].toLowerCase() === evmToBytes32(RECIPIENT) && args[3] === '0x036CbD53842c5426634e7929541eC2318f3dCF7e', { severity: 'CRITICAL' });
    check('burn args: destinationCaller = 0 (anyone, incl. the user, can mint)', args[4] === ethers.ZeroHash, { severity: 'CRITICAL' });
    check('burn args: maxFee + threshold match the quote', args[5].toString() === c.json.quote.maxFee && Number(args[6]) === c.json.quote.minFinalityThreshold, { severity: 'HIGH' });
    const approve = c.json.txs.find((t: any) => t.kind === 'approve');
    if (approve) {
        const a = erc20.decodeFunctionData('approve', approve.data);
        check('approve: exact burn amount to TokenMessengerV2 (not unlimited)', a[0] === '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA' && a[1] === burned, { severity: 'HIGH' });
    }
    const feeTx = c.json.txs.find((t: any) => t.kind === 'fee');
    if (BigInt(c.json.quote.protocolFee) > 0n) {
        const f = erc20.decodeFunctionData('transfer', feeTx.data);
        check('our fee: a USDC transfer of exactly the quoted fee to the quoted treasury, after the burn', feeTx.to === '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
            && f[0] === c.json.quote.feeRecipient && f[1] === BigInt(c.json.quote.protocolFee) && c.json.txs.at(-1).kind === 'fee', { severity: 'CRITICAL' });
        check('amount sent = burned + our fee', burned + BigInt(c.json.quote.protocolFee) === 1_000_000n && c.json.transfer.feeStatus === 'pending', { severity: 'CRITICAL' });
    } else {
        check('no fee configured → no fee transaction, full amount burned', !feeTx && burned === 1_000_000n && c.json.transfer.feeStatus === 'none', { severity: 'HIGH' });
    }
    const id = c.json.transfer.id;
    check('record CREATED', c.json.transfer.status === 'CREATED');
    check('unsigned transfer: expiresAt and a countdown from the created TTL', c.json.transfer.expiresAt === c.json.transfer.createdAt + cfg.cctp.createdTtlSec * 1000
        && c.json.transfer.expiresInSec > cfg.cctp.createdTtlSec - 30 && c.json.transfer.expiresInSec <= cfg.cctp.createdTtlSec, { severity: 'HIGH', detail: `${c.json.transfer.expiresInSec}s` });
    const badHash = await http('POST', `/transfers/${id}/burn`, { txHash: '0x1234' });
    check('burn: bad hash → code INVALID_TX_HASH', badHash.json?.code === 'INVALID_TX_HASH', { severity: 'HIGH' });
    check('burn: bad hash → 400', (await http('POST', `/transfers/${id}/burn`, { txHash: '0x1234' })).status === 400);
    const fakeHash = ethers.hexlify(ethers.randomBytes(32));   // never lands: the worker fails it after BURN_NOT_FOUND_MIN
    const b1 = await http('POST', `/transfers/${id}/burn`, { txHash: fakeHash });
    check('burn: valid hash → BURN_SUBMITTED', b1.status === 200 && b1.json.status === 'BURN_SUBMITTED', { severity: 'HIGH', detail: `${b1.status} ${b1.json?.error ?? b1.json?.status}` });
    check('burn: same hash again is idempotent', (await http('POST', `/transfers/${id}/burn`, { txHash: fakeHash })).status === 200);
    const other = await http('POST', `/transfers/${id}/burn`, { txHash: ethers.hexlify(ethers.randomBytes(32)) });
    check('burn: different hash on a submitted transfer → 409', other.status === 409, { severity: 'HIGH', detail: `${other.status}` });
    check('burn: different hash → code WRONG_STATE', other.json?.code === 'WRONG_STATE', { severity: 'HIGH' });
    check('burn posted: the transfer no longer expires', b1.json.expiresAt === undefined && b1.json.expiresInSec === undefined, { severity: 'HIGH' });
    const c2 = await http('POST', '/transfers', { src: 'base-sepolia', dst: 'arc-testnet', amount: '1', sender: DEAD, recipient: RECIPIENT });
    const reuse = await http('POST', `/transfers/${c2.json.transfer.id}/burn`, { txHash: fakeHash });
    check('burn: hash already registered to another transfer → 409', reuse.status === 409, { severity: 'HIGH', detail: `${reuse.status} ${reuse.json?.error}` });
    check('burn: hash already registered → code BURN_ALREADY_REGISTERED', reuse.json?.code === 'BURN_ALREADY_REGISTERED', { severity: 'HIGH' });
    check('fee hash on a transfer: no fee → NO_FEE_DUE; the burn hash offered as the fee → INVALID_TX_HASH',
        (await http('POST', `/transfers/${id}/fee`, { txHash: fakeHash })).json?.code === (BigInt(c.json.quote.protocolFee) > 0n ? 'INVALID_TX_HASH' : 'NO_FEE_DUE'), { severity: 'HIGH' });
    const g = await http('GET', `/transfers/${id}`);
    check('GET /transfers/:id has display + links', g.status === 200 && g.json.display.grossAmount === '1' && /basescan/.test(g.json.links.burn ?? ''));
    const list = await http('GET', `/transfers?address=${DEAD}`);
    check('GET /transfers?address lists it', list.json.some((t: any) => t.id === id));

    // activity: one list for a wallet, and the public feed
    const mine = await http('GET', `/activity?address=${DEAD}&limit=200`);
    const rowA = mine.json?.items?.find((i: any) => i.id === id), rowB = mine.json?.items?.find((i: any) => i.id === c2.json.transfer.id);
    check('GET /activity?address: the burned transfer is processing, with both sides and a source link', mine.status === 200 && rowA?.kind === 'transfer' && rowA.product === 'cctp' && rowA.status === 'BURN_SUBMITTED'
        && rowA.phase === 'processing' && rowA.terminal === false && rowA.sell.chain === 'base-sepolia' && rowA.buy.chain === 'arc-testnet' && rowA.sell.symbol === 'USDC'
        && rowA.sell.display === '1' && rowA.buy.estimated === true && /basescan/.test(rowA.links.source ?? '') && rowA.owner === DEAD, { severity: 'CRITICAL', detail: JSON.stringify(rowA ?? mine.json).slice(0, 260) });
    check('GET /activity?address: the unsigned transfer awaits a signature, with a countdown', rowB?.phase === 'awaiting_signature' && rowB.expiresInSec > 0 && rowB.expiresAt === c2.json.transfer.expiresAt, { severity: 'HIGH' });
    check('activity row carries our fee exactly when the quote had one', (rowA?.fee !== undefined) === (BigInt(c.json.quote.protocolFee) > 0n) && (!rowA?.fee || rowA.fee.amount === c.json.quote.protocolFee), { severity: 'HIGH' });
    check('activity: newest first, with the server time', mine.json.items.every((i: any, n: number, a: any[]) => n === 0 || a[n - 1].createdAt >= i.createdAt) && Math.abs(mine.json.serverTime - Date.now()) < 60_000, { severity: 'HIGH' });
    check('activity: an EVM address matches in lower case too', (await http('GET', `/activity?address=${DEAD.toLowerCase()}&limit=200`)).json.items.some((i: any) => i.id === id), { severity: 'HIGH' });
    check('activity: the recipient sees it as well', (await http('GET', `/activity?address=${RECIPIENT}&limit=200`)).json.items.some((i: any) => i.id === id), { severity: 'HIGH' });
    const two = await http('GET', `/activity?address=${DEAD},${Keypair.generate().publicKey.toBase58()}&limit=2`);
    check('activity: several addresses, limit respected', two.status === 200 && two.json.items.length === 2, { severity: 'HIGH' });
    const older = await http('GET', `/activity?address=${DEAD}&limit=200&before=${rowB.createdAt}`);
    check('activity: before is a cursor', older.json.items.every((i: any) => i.createdAt < rowB.createdAt) && !older.json.items.some((i: any) => i.id === rowB.id), { severity: 'HIGH' });
    const feed = await http('GET', '/activity?limit=200');
    check('public feed: lists the burned transfer, leaves out the one never signed', feed.status === 200 && feed.json.items.some((i: any) => i.id === id)
        && !feed.json.items.some((i: any) => i.status === 'CREATED' || i.status === 'EXPIRED'), { severity: 'CRITICAL', detail: `${feed.json?.items?.length} rows` });
    check('feed and history never expose a message, an attestation or a signed transaction', !/"attestation"|"message"|signedTransaction/.test(JSON.stringify(feed.json) + JSON.stringify(mine.json)), { severity: 'CRITICAL' });
    for (const [name, path] of [['six addresses', `/activity?address=${Array.from({ length: 6 }, () => Keypair.generate().publicKey.toBase58()).join(',')}`], ['not an address', '/activity?address=0x1234'], ['bad cursor', '/activity?before=abc']] as const) {
        const r = await http('GET', path);
        check(`activity rejects ${name} (400)`, r.status === 400 && (name === 'bad cursor' ? r.json?.code === 'INVALID_REQUEST' : r.json?.code === 'INVALID_ADDRESS'), { detail: `${r.status} ${r.json?.code}` });
    }
}
const missing = await http('GET', '/transfers/nope');
check('GET unknown transfer → 404', missing.status === 404);
check('unknown transfer → code NOT_FOUND; unknown route → the same shape', missing.json?.code === 'NOT_FOUND' && (await http('GET', '/no/such/route')).json?.code === 'NOT_FOUND', { severity: 'HIGH' });

// build EVM → Solana: mintRecipient must be the recipient's USDC token account
const solWallet = Keypair.generate().publicKey.toBase58();
const cs = await http('POST', '/transfers', { src: 'base-sepolia', dst: 'solana-devnet', amount: '1', sender: DEAD, recipient: solWallet });
check('POST /transfers Base→Solana: 201', cs.status === 201, { severity: 'CRITICAL', detail: `${cs.status} ${cs.json?.error ?? ''}` });
if (cs.status === 201) {
    const ata = getAssociatedTokenAddressSync(new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'), new PublicKey(solWallet)).toBase58();
    const args = tm.decodeFunctionData('depositForBurn', cs.json.txs.find((t: any) => t.kind === 'burn').data);
    check('Solana destination: mintRecipient = recipient USDC token account (ATA), not the wallet', args[2].toLowerCase() === solanaToBytes32(ata)
        && cs.json.transfer.recipientTokenAccount === ata, { severity: 'CRITICAL' });
}

// build Solana source: an empty wallet gets a clear 400
const cso = await http('POST', '/transfers', { src: 'solana-devnet', dst: 'arc-testnet', amount: '1', sender: Keypair.generate().publicKey.toBase58(), recipient: RECIPIENT });
check('Solana source with no USDC → 400 insufficient USDC', cso.status === 400 && /insufficient USDC/.test(cso.json?.error ?? ''), { detail: `${cso.status} ${cso.json?.error}` });
check('Solana source with no USDC → code INSUFFICIENT_FUNDS', cso.json?.code === 'INSUFFICIENT_FUNDS', { severity: 'HIGH' });

// validation
check('EVM sender invalid → 400', (await http('POST', '/transfers', { src: 'base-sepolia', dst: 'arc-testnet', amount: '1', sender: '0x123', recipient: RECIPIENT })).status === 400, { severity: 'HIGH' });
check('EVM address as Solana recipient → 400', (await http('POST', '/transfers', { src: 'base-sepolia', dst: 'solana-devnet', amount: '1', sender: DEAD, recipient: RECIPIENT })).status === 400, { severity: 'HIGH' });
check('track: bad hash → 400', (await http('POST', '/track', { src: 'base-sepolia', txHash: 'zzz' })).status === 400);
check('codes: bad sender → INVALID_ADDRESS, bad tracked hash → INVALID_TX_HASH',
    (await http('POST', '/transfers', { src: 'base-sepolia', dst: 'arc-testnet', amount: '1', sender: '0x123', recipient: RECIPIENT })).json?.code === 'INVALID_ADDRESS'
    && (await http('POST', '/track', { src: 'base-sepolia', txHash: 'zzz' })).json?.code === 'INVALID_TX_HASH', { severity: 'HIGH' });
const badJson = await fetch(`${BASE}/transfers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
check('a body that is not JSON → 400 INVALID_REQUEST, not a 500', badJson.status === 400 && (await badJson.json()).code === 'INVALID_REQUEST', { severity: 'HIGH', detail: String(badJson.status) });

// admin
const noKey = await http('GET', '/admin/balances');
check('admin without key → 401/503', noKey.status === 401 || noKey.status === 503, { severity: 'HIGH', detail: String(noKey.status) });
const key = process.env.ADMIN_API_KEY;
if (key) {
    const auth = async (method: string, p: string) => {
        const r = await fetch(`${process.env.RELAYER_URL || `http://localhost:${process.env.PORT || 3012}`}${p}`, { method, headers: { 'x-admin-key': key } });
        return { status: r.status, json: await r.json().catch(() => null) };
    };
    check('admin with wrong key → 401', (await fetch(`${process.env.RELAYER_URL || `http://localhost:${process.env.PORT || 3012}`}/admin/balances`, { headers: { 'x-admin-key': 'wrong' } })).status === 401, { severity: 'HIGH' });
    check('admin balances with key → 200', (await auth('GET', '/admin/balances')).status === 200);
    await auth('POST', '/admin/pause');
    const paused = await http('POST', '/transfers', { src: 'base-sepolia', dst: 'arc-testnet', amount: '1', sender: DEAD, recipient: RECIPIENT });
    check('paused → new transfers 503', paused.status === 503, { severity: 'HIGH' });
    check('paused → code PAUSED', paused.json?.code === 'PAUSED', { severity: 'HIGH' });
    await auth('POST', '/admin/resume');
    check('resumed → quotes still fine', (await http('GET', '/quote?src=base-sepolia&dst=arc-testnet&amount=1')).status === 200);
} else {
    skip('admin with key', 'ADMIN_API_KEY not set in this shell');
}

process.exit(finish());
