/**
 * REST checks for the routes a browser wallet uses in place of its own RPC: balance, transaction lookup and the
 * Solana broadcast. Against a running server; works on either network (the chains come from /config).
 */
import { Keypair } from '@solana/web3.js';
import { http, serverUp } from '../lib/env.js';
import { check, finish, skip, suite } from '../lib/report.js';

suite('short/chain_routes');
if (!(await serverUp())) { skip('all chain route checks', 'server not running (npm run dev)'); process.exit(finish()); }

const cfg = (await http('GET', '/config')).json;
const chains = cfg.cctp.chains as { key: string; kind: 'evm' | 'solana'; name: string; minMaxFeePerGasGwei?: number }[];
const evm = chains.find(c => c.kind === 'evm' && !c.minMaxFeePerGasGwei)!;
const arc = chains.find(c => !!c.minMaxFeePerGasGwei);
const sol = chains.find(c => c.kind === 'solana')!;
const DEAD = '0x000000000000000000000000000000000000dEaD';
const fresh = Keypair.generate().publicKey.toBase58();

// balance
const b = await http('GET', `/chains/${evm.key}/balance?owner=${DEAD}`);
check(`balance on ${evm.name}: USDC in base units and for display, gas in ETH`,
    b.status === 200 && /^\d+$/.test(b.json.usdc) && typeof b.json.display === 'string' && /^\d+$/.test(b.json.native) && b.json.nativeSymbol === 'ETH' && b.json.nativeDecimals === 18,
    { severity: 'HIGH', detail: JSON.stringify(b.json).slice(0, 200) });
if (arc) {
    const a = await http('GET', `/chains/${arc.key}/balance?owner=${DEAD}`);
    check(`balance on ${arc.name}: gas is USDC`, a.status === 200 && a.json.nativeSymbol === 'USDC', { detail: JSON.stringify(a.json).slice(0, 200) });
}
const s = await http('GET', `/chains/${sol.key}/balance?owner=${fresh}`);
check(`balance on ${sol.name}: a new wallet has 0 USDC and 0 SOL`, s.status === 200 && s.json.usdc === '0' && s.json.native === '0' && s.json.nativeSymbol === 'SOL' && s.json.nativeDecimals === 9,
    { severity: 'HIGH', detail: JSON.stringify(s.json).slice(0, 200) });
const badOwner = await http('GET', `/chains/${evm.key}/balance?owner=${fresh}`);
check('a Solana address on an EVM chain → 400 INVALID_ADDRESS', badOwner.status === 400 && badOwner.json.code === 'INVALID_ADDRESS', { severity: 'HIGH' });
const noOwner = await http('GET', `/chains/${sol.key}/balance`);
check('no owner → 400 INVALID_ADDRESS', noOwner.status === 400 && noOwner.json.code === 'INVALID_ADDRESS');
const noChain = await http('GET', `/chains/nowhere/balance?owner=${DEAD}`);
check('unknown chain → 400 UNKNOWN_CHAIN', noChain.status === 400 && noChain.json.code === 'UNKNOWN_CHAIN', { severity: 'HIGH' });

// transaction lookup
const unknownEvm = await http('GET', `/chains/${evm.key}/tx/0x${'ab'.repeat(32)}`);
check('a hash the chain has never seen → known: false', unknownEvm.status === 200 && unknownEvm.json.known === false, { severity: 'HIGH', detail: JSON.stringify(unknownEvm.json) });
const badHash = await http('GET', `/chains/${evm.key}/tx/0x1234`);
check('not a hash → 400 INVALID_TX_HASH', badHash.status === 400 && badHash.json.code === 'INVALID_TX_HASH');
const unknownSol = await http('GET', `/chains/${sol.key}/tx/${'1'.repeat(87)}`);
check('Solana: an unknown signature → known: false, or 400 when it is not a signature', (unknownSol.status === 200 && unknownSol.json.known === false) || unknownSol.status === 400, { detail: `${unknownSol.status}` });

// broadcast
const none = await http('POST', '/transfers/00000000-0000-0000-0000-000000000000/broadcast', { signedTx: 'AA==' });
check('broadcast for an unknown transfer → 404 NOT_FOUND', none.status === 404 && none.json.code === 'NOT_FOUND', { severity: 'HIGH' });
const open = (await http('GET', `/transfers?address=${DEAD}&limit=20`)).json as { id: string; src: string; status: string }[];
const evmTransfer = open.find(t => chains.find(c => c.key === t.src)?.kind === 'evm');
if (evmTransfer) {
    const r = await http('POST', `/transfers/${evmTransfer.id}/broadcast`, { signedTx: 'AA==' });
    check('broadcast for an EVM source → 400: the wallet sends those itself', r.status === 400 && r.json.code === 'INVALID_REQUEST', { severity: 'HIGH', detail: JSON.stringify(r.json).slice(0, 160) });
} else {
    skip('broadcast for an EVM source', 'no transfer from 0x…dEaD on this server yet (run short/rest_api first)');
}

process.exit(finish());
