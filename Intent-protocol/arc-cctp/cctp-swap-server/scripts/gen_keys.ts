/**
 * gen_keys.ts — create the relayer + E2E test-user keys in .env (only the ones that are missing).
 * Prints addresses only; never prints secrets.
 *   npx tsx scripts/gen_keys.ts
 */
import * as fs from 'fs';
import { randomBytes } from 'crypto';
import { ethers } from 'ethers';
import { Keypair } from '@solana/web3.js';
import dotenv from 'dotenv';
import { parseSolanaSecret } from '../src/solana/SolanaAdapter.js';

const ENV = '.env';
const existing = fs.existsSync(ENV) ? dotenv.parse(fs.readFileSync(ENV)) : {};
const add: Record<string, string> = {};

const evmKey = (name: string) => { if (!existing[name]) add[name] = ethers.Wallet.createRandom().privateKey; };
const solKey = (name: string) => { if (!existing[name]) add[name] = JSON.stringify([...Keypair.generate().secretKey]); };

evmKey('CCTP_RELAYER_EVM_KEY');
solKey('CCTP_RELAYER_SOLANA_KEY');
evmKey('E2E_EVM_KEY');
solKey('E2E_SOLANA_KEY');
if (!existing.ADMIN_API_KEY) add.ADMIN_API_KEY = randomBytes(24).toString('hex');

if (Object.keys(add).length) {
    const lines = Object.entries(add).map(([k, v]) => `${k}=${v}`).join('\n');
    fs.appendFileSync(ENV, `${fs.existsSync(ENV) && !fs.readFileSync(ENV, 'utf8').endsWith('\n') ? '\n' : ''}${lines}\n`);
    console.log(`added to ${ENV}: ${Object.keys(add).join(', ')}`);
} else {
    console.log('all keys already present');
}

const all = { ...existing, ...add };
console.log('\nAddresses (fund these):');
console.log(`  relayer EVM     ${new ethers.Wallet(all.CCTP_RELAYER_EVM_KEY).address}`);
console.log(`  relayer Solana  ${parseSolanaSecret(all.CCTP_RELAYER_SOLANA_KEY).publicKey.toBase58()}`);
console.log(`  e2e user EVM    ${new ethers.Wallet(all.E2E_EVM_KEY).address}`);
console.log(`  e2e user Solana ${parseSolanaSecret(all.E2E_SOLANA_KEY).publicKey.toBase58()}`);
console.log('\nRun `npm run check:balances` to see what is still missing.');
