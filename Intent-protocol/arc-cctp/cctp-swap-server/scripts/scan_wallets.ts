/**
 * scan_wallets.ts — find funded wallets in the sibling servers' .env files and show what each holds on
 * every CCTP chain and on Solana mainnet (for Jupiter swaps). Prints addresses and balances, never keys.
 *   npx tsx scripts/scan_wallets.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { config, enabledChains } from '../src/config.js';
import { formatUsdc } from '../src/cctp/encoding.js';
import { EvmAdapter } from '../src/evm/EvmAdapter.js';
import { SolanaAdapter, parseSolanaSecret } from '../src/solana/SolanaAdapter.js';

const ROOT = path.resolve(process.cwd(), '..', '..');
export const SOURCES: { file: string; evm: string[]; solana: string[] }[] = [
    { file: 'bsc-bch-server/.env', evm: ['EVM_SOLVER_PRIVATE_KEY', 'TEST_USER_EVM_KEY'], solana: [] },
    { file: 'bch-solana-relayer/.env', evm: [], solana: ['SOLANA_PRIVATE_KEY'] },
    { file: 'arc-cctp/cctp-swap-server/.env', evm: ['CCTP_RELAYER_EVM_KEY', 'E2E_EVM_KEY'], solana: ['CCTP_RELAYER_SOLANA_KEY', 'E2E_SOLANA_KEY'] },
];
const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const evm: { label: string; address: string }[] = [];
const sol: { label: string; address: string }[] = [];
for (const s of SOURCES) {
    const p = path.join(ROOT, s.file);
    if (!fs.existsSync(p)) { console.log(`(missing ${s.file})`); continue; }
    const env = dotenv.parse(fs.readFileSync(p));
    for (const k of s.evm) if (env[k]) { try { evm.push({ label: `${s.file.split('/').at(-2)}:${k}`, address: new ethers.Wallet(env[k].trim()).address }); } catch { console.log(`(unreadable ${k} in ${s.file})`); } }
    for (const k of s.solana) if (env[k]) { try { sol.push({ label: `${s.file.split('/').at(-2)}:${k}`, address: parseSolanaSecret(env[k].trim()).publicKey.toBase58() }); } catch { console.log(`(unreadable ${k} in ${s.file})`); } }
}

console.log('EVM wallets');
for (const w of evm) console.log(`  ${w.address}  ${w.label}`);
console.log('Solana wallets');
for (const w of sol) console.log(`  ${w.address}  ${w.label}`);

for (const c of enabledChains()) {
    console.log(`\n${c.name}`);
    try {
        if (c.kind === 'evm') {
            const a = new EvmAdapter(c);
            for (const w of evm) {
                const [native, usdc] = await Promise.all([a.provider.getBalance(w.address), a.usdcBalance(w.address)]);
                console.log(`  ${w.address}  ${c.minMaxFeePerGasGwei ? 'USDC(gas)' : 'ETH'}=${Number(ethers.formatEther(native)).toFixed(5)}  USDC=${formatUsdc(usdc)}`);
            }
        } else {
            const a = new SolanaAdapter(c);
            const conn = new Connection(c.rpcUrl, 'confirmed');
            for (const w of sol) {
                const lamports = await conn.getBalance(new PublicKey(w.address));
                console.log(`  ${w.address}  SOL=${(lamports / LAMPORTS_PER_SOL).toFixed(4)}  USDC=${formatUsdc(await a.usdcBalance(w.address))}`);
            }
        }
    } catch (e: any) { console.log(`  could not read: ${e.shortMessage ?? e.message}`); }
}

console.log('\nSolana mainnet (Jupiter swaps)');
try {
    const conn = new Connection(config.jupiter.solanaRpcUrl, 'confirmed');
    for (const w of sol) {
        const owner = new PublicKey(w.address);
        const lamports = await conn.getBalance(owner);
        const ata = getAssociatedTokenAddressSync(new PublicKey(MAINNET_USDC), owner);
        const usdc = await conn.getTokenAccountBalance(ata).then(r => r.value.uiAmountString ?? '0').catch(() => '0');
        console.log(`  ${w.address}  SOL=${(lamports / LAMPORTS_PER_SOL).toFixed(4)}  USDC=${usdc}`);
    }
} catch (e: any) { console.log(`  could not read: ${e.message}`); }
process.exit(0);
