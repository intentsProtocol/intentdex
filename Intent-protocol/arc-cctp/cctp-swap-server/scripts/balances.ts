/**
 * balances.ts — funding checklist for the relayer and the E2E test user on every enabled chain.
 *   npx tsx scripts/balances.ts
 *
 * Needs for the E2E matrix (scripts/e2e_lib.ts ROUTES, 1 USDC per run, with headroom):
 *   relayer : native gas on every destination (Arc gas is USDC)
 *   e2e user: native gas + USDC on every source chain (Eth/Base/Arb Sepolia, Arc, Solana devnet)
 */
import { ethers } from 'ethers';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { enabledChains, type ChainConfig } from '../src/config.js';
import { getSecret } from '../src/secrets.js';
import { formatUsdc } from '../src/cctp/encoding.js';
import { EvmAdapter } from '../src/evm/EvmAdapter.js';
import { SolanaAdapter, parseSolanaSecret } from '../src/solana/SolanaAdapter.js';

const SOURCES = ['eth-sepolia', 'base-sepolia', 'arb-sepolia', 'arc-testnet', 'solana-devnet'];
const NATIVE_NEED = { relayer: { evm: 0.02, arc: 2, sol: 0.2 }, user: { evm: 0.02, arc: 2, sol: 0.1 } };
const USDC_NEED = 10;   // per source chain for the user (Arc: gas comes out of the same balance)

type Who = { relayerEvm?: string; relayerSol?: string; userEvm?: string; userSol?: string };

async function checkChain(c: ChainConfig, who: Who, todo: string[]) {
    const isSource = SOURCES.includes(c.key);
    if (c.kind === 'evm') {
        const a = new EvmAdapter(c);
        const isArc = !!c.minMaxFeePerGasGwei;
        const gasLabel = isArc ? 'USDC(gas)' : 'ETH';
        for (const role of ['relayer', 'user'] as const) {
            const w = role === 'relayer' ? who.relayerEvm : who.userEvm;
            if (!w) continue;
            const native = Number(ethers.formatEther(await a.provider.getBalance(w)));
            const usdc = await a.usdcBalance(w);
            console.log(`  ${role.padEnd(8)} ${w}  ${gasLabel}=${native.toFixed(4)}  USDC=${formatUsdc(usdc)}`);
            const needGas = NATIVE_NEED[role][isArc ? 'arc' : 'evm'];
            if ((role === 'relayer' || isSource) && native < needGas) {
                todo.push(`${c.name}: ${isArc ? 'faucet.circle.com (Arc testnet USDC)' : `${needGas} Sepolia ETH`} → ${role} ${w}`);
            }
            if (role === 'user' && isSource && !isArc && usdc < BigInt(USDC_NEED * 1e6)) {
                todo.push(`${c.name}: faucet.circle.com USDC → user ${w}`);
            }
        }
    } else {
        const a = new SolanaAdapter(c);
        const conn = new Connection(c.rpcUrl, 'confirmed');
        for (const role of ['relayer', 'user'] as const) {
            const w = role === 'relayer' ? who.relayerSol : who.userSol;
            if (!w) continue;
            const sol = (await conn.getBalance(new PublicKey(w))) / LAMPORTS_PER_SOL;
            const usdc = await a.usdcBalance(w);
            console.log(`  ${role.padEnd(8)} ${w}  SOL=${sol.toFixed(4)}  USDC=${formatUsdc(usdc)}`);
            if (sol < NATIVE_NEED[role].sol) todo.push(`${c.name}: ${NATIVE_NEED[role].sol} devnet SOL (faucet.solana.com) → ${role} ${w}`);
            if (role === 'user' && usdc < BigInt(USDC_NEED * 1e6)) todo.push(`${c.name}: faucet.circle.com USDC → user ${w}`);
        }
    }
}

async function main() {
    const addr = (k: string) => { const v = getSecret(k); return v ? new ethers.Wallet(v).address : undefined; };
    const sol = (k: string) => { const v = getSecret(k); return v ? parseSolanaSecret(v).publicKey.toBase58() : undefined; };
    const who: Who = {
        relayerEvm: addr('CCTP_RELAYER_EVM_KEY'), relayerSol: sol('CCTP_RELAYER_SOLANA_KEY'),
        userEvm: addr('E2E_EVM_KEY'), userSol: sol('E2E_SOLANA_KEY'),
    };
    if (!who.relayerEvm || !who.userEvm) { console.log('keys missing: run `npm run gen:keys` first'); process.exit(1); }

    const todo: string[] = [];
    for (const c of enabledChains()) {
        console.log(`\n${c.name}`);
        try { await checkChain(c, who, todo); }
        catch (e: any) {
            console.log(`  could not read balances: ${e.shortMessage ?? e.message} (RPC ${c.rpcUrl})`);
            todo.push(`${c.name}: RPC unreachable, re-run`);
        }
    }
    console.log(todo.length ? `\nStill needed:\n  - ${todo.join('\n  - ')}` : '\nAll wallets funded for the E2E matrix.');
}

main().catch(e => { console.error(e); process.exit(1); });
