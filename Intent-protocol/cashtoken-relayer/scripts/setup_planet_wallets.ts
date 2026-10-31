/**
 * Planet Wallets Setup & Funding Script
 *
 * Generates 6 valid 12-word BIP39 planet test actors + Saturn solver:
 *   - Saturn (BCHMesh Solver):  1.0 BCH + 5,000 pUSD
 *   - Mercury (Best Bid LP):    0.05 BCH + 1,000 pUSD
 *   - Venus (Comp Bid 2 LP):    0.05 BCH + 1,000 pUSD
 *   - Earth (Ask Side LP):      0.05 BCH + 1,000 pUSD
 *   - Mars (Dutch Trader):      0.05 BCH + 1,000 pUSD
 *   - Jupiter (Limit Trader):   0.05 BCH + 1,000 pUSD
 *
 * Saves keys to `planet_wallets.json` and outputs initial Chipnet balances.
 *
 * Usage:
 *   node_modules\.bin\tsx scripts/setup_planet_wallets.ts
 */

import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider } from 'cashscript';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const NETWORK       = 'chipnet';
const WALLETS_FILE  = path.join(__dirname, '..', 'planet_wallets.json');

// Valid 12-word BIP39 mnemonics for each planet actor
const PLANET_MNEMONICS: Record<string, string> = {
  Saturn:  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon agent',
  Mercury: 'atom alpha apple asset ability anchor action advice advance agent agree alert',
  Venus:   'badge banana bar basic beach beam beauty beef begin behave belief benefit',
  Earth:   'cabin cactus cage cake call camel camera camp canal cancel candy canvas',
  Mars:    'damage damp dance danger daring dark date daughter dawn day deal debate',
  Jupiter: 'eager eagle early earn earth easy echo ecology economy edge edit educate',
};

// Funding targets
const SOLVER_BCH_SATS   = 100_000_000n; // 1.0 BCH
const PLANET_BCH_SATS   = 5_000_000n;   // 0.05 BCH

function ok(msg: string)  { console.log(`\n✅  ${msg}`); }
function log(msg: string) { console.log(`    ${msg}`); }
function section(title: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

async function main() {
  console.log('\n' + '═'.repeat(62));
  console.log('  🪐  BCHMesh — Planet Test Wallets & Solver Funding');
  console.log('═'.repeat(62));

  const provider = new ElectrumNetworkProvider(NETWORK as any);

  // Load primary funding wallet (relayer wallet)
  let fundWallet: TestNetWallet;
  const envWif = process.env.RELAYER_PRIVATE_KEY_WIF;
  if (envWif) {
    fundWallet = await TestNetWallet.fromWIF(envWif);
  } else {
    const wData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'wallet.json'), 'utf-8'));
    fundWallet = await TestNetWallet.fromWIF(wData.wif ?? wData.privateKeyWIF);
  }

  log(`Primary Funding Wallet: ${(fundWallet as any).cashaddr}`);

  // Check funding wallet balances
  const fUtxos1 = await provider.getUtxos((fundWallet as any).cashaddr);
  const totalFBch = fUtxos1.filter((u: any) => !u.token).reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);
  log(`Primary Wallet BCH Balance: ${Number(totalFBch) / 1e8} BCH`);

  if (totalFBch < 120_000_000n) { // 1.2 BCH needed minimum
    throw new Error(`Primary wallet has ${Number(totalFBch) / 1e8} BCH, need ≥1.2 BCH to fund solver & planet actors`);
  }

  section('Step 1: Generating Planet & Solver Wallets');

  const walletRecords: Record<string, { wif: string; address: string; tokenAddress: string; role: string }> = {};

  for (const [name, seed] of Object.entries(PLANET_MNEMONICS)) {
    const wallet = await TestNetWallet.fromSeed(seed);
    const address = (wallet as any).cashaddr;
    const tokenAddr = (wallet as any).tokenaddr ?? address;
    const wif = (wallet as any).privateKeyWIF;

    const role =
      name === 'Saturn'  ? 'BCHMesh Solver Engine (1.0 BCH + 5,000 pUSD)' :
      name === 'Mercury' ? 'Best Bid Strategy LP (310 sats/pUSD)' :
      name === 'Venus'   ? 'Competitive Bid 2 LP (300 sats/pUSD)' :
      name === 'Earth'   ? 'Ask Side / Reverse Strategy LP (280 sats/pUSD)' :
      name === 'Mars'    ? 'Dutch Auction Trader (Sell 10 pUSD)' :
      'Limit Order Trader (Sell 10 pUSD)';

    walletRecords[name] = { wif, address, tokenAddress: tokenAddr, role };
    log(`[${name.padEnd(7)}] ${address} (${role.split('(')[0].trim()})`);
  }

  // Save WIFs to planet_wallets.json
  fs.writeFileSync(WALLETS_FILE, JSON.stringify(walletRecords, null, 2), 'utf-8');
  ok(`Saved ${Object.keys(walletRecords).length} wallet records to: ${WALLETS_FILE}`);

  section('Step 2: Funding Saturn (BCHMesh Solver: 1.0 BCH)');

  const saturnRecord = walletRecords['Saturn']!;
  const saturnUtxos  = await provider.getUtxos(saturnRecord.address);
  const saturnBch    = saturnUtxos.filter((u: any) => !u.token).reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);

  if (saturnBch < SOLVER_BCH_SATS) {
    const sendAmount = SOLVER_BCH_SATS - saturnBch;
    log(`Sending ${Number(sendAmount) / 1e8} BCH to Saturn (${saturnRecord.address})…`);
    const tx = await fundWallet.send([
      { cashaddr: saturnRecord.address, value: Number(sendAmount), unit: 'sat' }
    ]);
    ok(`Saturn funded with 1.0 BCH! Txid: ${tx.txId}`);
  } else {
    log(`Saturn already has ${Number(saturnBch) / 1e8} BCH — skipping transfer.`);
  }

  section('Step 3: Funding Planet Actor Wallets (0.05 BCH each)');

  const planetNames = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter'];
  const transfers: Array<{ cashaddr: string; value: number; unit: string }> = [];

  for (const name of planetNames) {
    const rec   = walletRecords[name]!;
    const utxos = await provider.getUtxos(rec.address);
    const bal   = utxos.filter((u: any) => !u.token).reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);

    if (bal < PLANET_BCH_SATS) {
      const sendAmt = Number(PLANET_BCH_SATS - bal);
      transfers.push({ cashaddr: rec.address, value: sendAmt, unit: 'sat' });
      log(`Staging ${sendAmt / 1e8} BCH for ${name} (${rec.address.slice(0, 24)}…)`);
    } else {
      log(`${name} already has ${Number(bal) / 1e8} BCH — skipping.`);
    }
  }

  if (transfers.length > 0) {
    log(`Executing batch send of ${transfers.length} planet wallet transfers…`);
    const batchTx = await fundWallet.send(transfers as any);
    ok(`All 5 planet wallets funded with BCH! Txid: ${batchTx.txId}`);
  }

  section('Step 4: Final Wallet Balance Verification');

  for (const [name, rec] of Object.entries(walletRecords)) {
    const utxos = await provider.getUtxos(rec.address);
    const bch   = utxos.filter((u: any) => !u.token).reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);
    log(`[${name.padEnd(7)}] ${rec.address}  →  ${(Number(bch) / 1e8).toFixed(4)} BCH`);
  }

  console.log('\n' + '═'.repeat(62));
  console.log('  ✅  PLANET WALLET SETUP & FUNDING COMPLETE!');
  console.log('═'.repeat(62) + '\n');

  process.exit(0);
}

main().catch((e: Error) => {
  console.error('\n❌ Fatal error in wallet setup:', e.message);
  process.exit(1);
});
