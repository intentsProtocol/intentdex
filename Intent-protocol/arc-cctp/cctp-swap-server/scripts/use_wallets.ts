/**
 * use_wallets.ts — point this server's .env at the funded test wallets of the sibling servers.
 * The previous .env is copied to data/env-backup-<time> (gitignored) first. Prints addresses, never keys.
 *   npx tsx scripts/use_wallets.ts
 *
 * Roles:
 *   relayer EVM   ← bsc-bch-server TEST_USER_EVM_KEY        (pays destination gas)
 *   e2e user EVM  ← bsc-bch-server EVM_SOLVER_PRIVATE_KEY   (holds the test USDC)
 *   relayer + e2e user Solana ← bch-solana-relayer SOLANA_PRIVATE_KEY (one funded wallet plays both)
 * The EVM roles stay on two addresses so the relayer's nonce is never raced by the test user.
 */
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { parseSolanaSecret } from '../src/solana/SolanaAdapter.js';

const ROOT = path.resolve(process.cwd(), '..', '..');
const read = (rel: string) => dotenv.parse(fs.readFileSync(path.join(ROOT, rel)));
const bsc = read('bsc-bch-server/.env');
const sol = read('bch-solana-relayer/.env');

const evmKey = (v: string | undefined, name: string) => {
    if (!v) throw new Error(`${name} is missing`);
    const k = v.trim().startsWith('0x') ? v.trim() : `0x${v.trim()}`;
    new ethers.Wallet(k);
    return k;
};
const next: Record<string, string> = {
    CCTP_RELAYER_EVM_KEY: evmKey(bsc.TEST_USER_EVM_KEY, 'TEST_USER_EVM_KEY'),
    E2E_EVM_KEY: evmKey(bsc.EVM_SOLVER_PRIVATE_KEY, 'EVM_SOLVER_PRIVATE_KEY'),
    CCTP_RELAYER_SOLANA_KEY: (sol.SOLANA_PRIVATE_KEY ?? '').trim(),
    E2E_SOLANA_KEY: (sol.SOLANA_PRIVATE_KEY ?? '').trim(),
};
parseSolanaSecret(next.CCTP_RELAYER_SOLANA_KEY);

const ENV = '.env';
const before = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
fs.mkdirSync('data', { recursive: true });
const backup = `data/env-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
if (before) fs.writeFileSync(backup, before);

const seen = new Set<string>();
const lines = before.split(/\r?\n/).map(line => {
    const m = /^([A-Z0-9_]+)=/.exec(line);
    if (m && next[m[1]] !== undefined) { seen.add(m[1]); return `${m[1]}=${next[m[1]]}`; }
    return line;
});
for (const [k, v] of Object.entries(next)) if (!seen.has(k)) lines.push(`${k}=${v}`);
fs.writeFileSync(ENV, lines.join('\n').replace(/\n*$/, '\n'));

console.log(`previous .env saved to ${backup}`);
console.log(`relayer EVM     ${new ethers.Wallet(next.CCTP_RELAYER_EVM_KEY).address}`);
console.log(`e2e user EVM    ${new ethers.Wallet(next.E2E_EVM_KEY).address}`);
console.log(`relayer Solana  ${parseSolanaSecret(next.CCTP_RELAYER_SOLANA_KEY).publicKey.toBase58()}`);
console.log(`e2e user Solana ${parseSolanaSecret(next.E2E_SOLANA_KEY).publicKey.toBase58()}`);
