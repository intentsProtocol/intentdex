/**
 * BCHMesh — Fill User Deployed Strategy Pools Test Script
 *
 * Automatically finds live user strategy pools or takes a specific covenant address / txid,
 * and executes an on-chain partial fill trade (taker sells pUSD tokens, buys BCH from pool).
 *
 * Usage:
 *   node_modules\.bin\tsx scripts/fill_user_pools.ts
 *   node_modules\.bin\tsx scripts/fill_user_pools.ts --address bchtest:pw7heppgcqnd... --amount 10
 */

import { ElectrumNetworkProvider, Contract, TransactionBuilder, SignatureTemplate } from 'cashscript';
import { TestNetWallet } from 'mainnet-js';
import { cashAddressToLockingBytecode, binToHex } from '@bitauth/libauth';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const NETWORK       = 'chipnet';
const PUSDTEST_CAT  = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';
const MESH_API_URL  = process.env.VITE_MESH_SERVER_URL || 'http://localhost:3001';

function ok(msg: string)   { console.log(`\n✅  ${msg}`); }
function log(msg: string)  { console.log(`    ${msg}`); }
function warn(msg: string) { console.log(`⚠️   ${msg}`); }
function section(title: string) {
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(64));
}

function loadArtifact(name: string) {
  const p1 = path.join(__dirname, '..', '..', 'contracts-bch-swap', 'artifacts', `${name}.json`);
  const p2 = path.join(__dirname, '..', 'src', 'artifacts', `${name}.json`);
  if (fs.existsSync(p1)) return JSON.parse(fs.readFileSync(p1, 'utf-8'));
  if (fs.existsSync(p2)) return JSON.parse(fs.readFileSync(p2, 'utf-8'));
  throw new Error(`Artifact not found: ${name}`);
}

function reverseHex(hex: string): string {
  return hex.match(/.{2}/g)!.reverse().join('');
}

function getPkhHex(address: string): string {
  const res = cashAddressToLockingBytecode(address);
  if (typeof res === 'string') throw new Error(`Invalid address: ${address}`);
  return binToHex(res.bytecode.slice(3, 23));
}

async function main() {
  console.log('\n' + '═'.repeat(64));
  console.log('  🪐  BCHMesh — Fill Live Strategy Pools Test Suite');
  console.log('═'.repeat(64));

  const args = process.argv.slice(2);
  const targetAddressArg = args.find((_, i) => args[i - 1] === '--address');
  const targetTxidArg = args.find((_, i) => args[i - 1] === '--txid');
  const fillAmountArg = args.find((_, i) => args[i - 1] === '--amount');
  const fillUnits = BigInt(fillAmountArg ? parseInt(fillAmountArg, 10) : 5); // default 5 pUSD

  const provider = new ElectrumNetworkProvider(NETWORK as any);

  // Load master wallet (holds test BCH and fee UTXOs)
  const envWif = process.env.RELAYER_PRIVATE_KEY_WIF;
  const masterWif = envWif ?? JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'wallet.json'), 'utf-8')).wif;
  const masterWallet = await TestNetWallet.fromWIF(masterWif);
  const masterAddress = (masterWallet as any).cashaddr;
  const masterTokenAddress = (masterWallet as any).tokenaddr ?? 'bchtest:zqmhr60gt2w2kz7aps6ds9rgv2e3f4ksdgkzh8ftxc';

  log(`Taker / Master Wallet: ${masterAddress}`);

  // Find pUSD token UTXOs
  const PUSD_HOLDER_WIF = 'cPQQEX4tmyy49t5ZyPzhSnhmuCudeGBpGJis14S8hypzRyPnwMbQ';
  const PUSD_HOLDER_ADDR = 'bchtest:zzufsn0wtcmc4lhc3s3trhl0nxn6dgkpmgtgqkcqqd';

  const addressesToScan = [
    PUSD_HOLDER_ADDR,
    masterAddress,
    masterTokenAddress,
  ];

  let pUtxo: any = null;
  let pUtxoWif = PUSD_HOLDER_WIF;

  for (const addr of addressesToScan) {
    try {
      const utxos = await provider.getUtxos(addr);
      const found = utxos.find((u: any) => u.token?.category === PUSDTEST_CAT && BigInt(u.token!.amount) >= fillUnits);
      if (found) {
        pUtxo = found;
        pUtxoWif = addr === masterAddress || addr === masterTokenAddress ? masterWif : PUSD_HOLDER_WIF;
        log(`Found pUSD Token UTXO on ${addr.slice(0, 24)}… (${found.token!.amount} pUSD)`);
        break;
      }
    } catch {}
  }

  if (!pUtxo) {
    warn(`No pUSD token UTXO found with ≥${fillUnits} units. Proceeding in simulation mode if needed.`);
  }

  // Identify target strategy pools to fill
  section('Step 1: Fetching Active Pools from MeshServer / On-Chain');

  interface TargetPool {
    txid: string;
    vout: number;
    address: string;
    priceNum: bigint;
    priceDen: bigint;
    feeBps: bigint;
    ownerPkh: string;
    contractType: string;
    reserveSats: bigint;
  }

  const poolsToFill: TargetPool[] = [];

  if (targetAddressArg) {
    const utxos = await provider.getUtxos(targetAddressArg);
    const mainUtxo = utxos.find(u => !u.token && u.satoshis > 1000) || utxos[0];
    if (mainUtxo) {
      poolsToFill.push({
        txid: mainUtxo.txid,
        vout: mainUtxo.vout,
        address: targetAddressArg,
        priceNum: 300n,
        priceDen: 1n,
        feeBps: 30n,
        ownerPkh: getPkhHex(masterAddress),
        contractType: 'StrategyCovenant',
        reserveSats: BigInt(mainUtxo.satoshis),
      });
    }
  } else {
    try {
      const res = await fetch(`${MESH_API_URL}/api/v1/positions`);
      if (res.ok) {
        const data = await res.json();
        for (const p of (data.positions || [])) {
          if (targetTxidArg && p.txid !== targetTxidArg) continue;
          poolsToFill.push({
            txid: p.txid,
            vout: p.vout,
            address: p.address,
            priceNum: BigInt(p.priceNum || 300),
            priceDen: BigInt(p.priceDen || 1),
            feeBps: BigInt(p.feeBps || 30),
            ownerPkh: p.ownerPkh || getPkhHex(masterAddress),
            contractType: p.contractType || 'StrategyCovenant',
            reserveSats: BigInt(p.reserveSats || 10000),
          });
        }
      }
    } catch {
      log('Could not connect to MeshServer, scanning local addresses...');
    }
  }

  log(`Found ${poolsToFill.length} target pool(s) for swap execution`);

  let selectedPool: TargetPool | null = null;
  let covenantUtxo: any = null;

  for (const pool of poolsToFill) {
    try {
      const lockRes = cashAddressToLockingBytecode(pool.address);
      if (typeof lockRes === 'string') continue;
      const liveUtxos = await provider.getUtxos(pool.address);
      const utxo = liveUtxos.find(u => u.txid === pool.txid && u.vout === pool.vout) || liveUtxos.find(u => !u.token && u.satoshis > 2000);
      if (utxo) {
        selectedPool = pool;
        covenantUtxo = utxo;
        break;
      }
    } catch {
      // invalid address format or not found on-chain, skip
    }
  }

  // If no live pool found on-chain, deploy a fresh real StrategyCovenant pool now!
  if (!selectedPool || !covenantUtxo) {
    section('Auto-Deploying a Live StrategyCovenant Pool on Chipnet (25,000 sats / 0.00025 BCH)');
    const artifact = loadArtifact('StrategyCovenant');
    const pusdCatBytes = `0x${reverseHex(PUSDTEST_CAT)}`;
    const PRICE_NUM = 300n;
    const PRICE_DEN = 1n;
    const FEE_BPS = 30n;
    const INITIAL_RESERVE = 25000n;
    const ownerPkhHex = getPkhHex(masterAddress);
    const ownerPkhBytes = Buffer.from(ownerPkhHex, 'hex');

    const contract = new Contract(
      artifact,
      [ownerPkhBytes, pusdCatBytes, '0x', PRICE_NUM, PRICE_DEN, FEE_BPS],
      { provider }
    );

    log(`Deploying Covenant Address: ${contract.address}`);
    const fundTx = await masterWallet.send([
      { cashaddr: contract.address, value: Number(INITIAL_RESERVE), unit: 'sat' }
    ]);
    ok(`Fresh StrategyCovenant deployed! TXID: ${fundTx.txId}`);
    log(`Explorer: https://chipnet.chaingraph.cash/tx/${fundTx.txId}`);

    // Register in MeshServer
    try {
      await fetch(`${MESH_API_URL}/api/v1/positions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txid: fundTx.txId,
          vout: 0,
          address: contract.address,
          contractType: 'StrategyCovenant',
          ownerPkh: ownerPkhHex,
          reserveSats: INITIAL_RESERVE.toString(),
          tokenCategoryIn: PUSDTEST_CAT,
          tokenCategoryOut: '0x',
          priceNum: Number(PRICE_NUM),
          priceDen: Number(PRICE_DEN),
          feeBps: Number(FEE_BPS),
        }),
      });
      log(`Registered in MeshServer indexer.`);
    } catch {}

    await new Promise(r => setTimeout(r, 4000)); // wait for mempool

    const live = await provider.getUtxos(contract.address);
    covenantUtxo = live.find(u => u.txid === fundTx.txId) || live[0];
    selectedPool = {
      txid: fundTx.txId!,
      vout: 0,
      address: contract.address,
      priceNum: PRICE_NUM,
      priceDen: PRICE_DEN,
      feeBps: FEE_BPS,
      ownerPkh: ownerPkhHex,
      contractType: 'StrategyCovenant',
      reserveSats: INITIAL_RESERVE,
    };
  }

  if (!selectedPool || !covenantUtxo) {
    throw new Error('Could not establish a target strategy covenant on-chain');
  }

  section(`Step 2: Executing Fill Trade against Pool`);
  log(`Selected Pool: ${selectedPool.address}`);
  log(`Pool Rate: ${selectedPool.priceNum}/${selectedPool.priceDen} sats/pUSD | Fee: ${selectedPool.feeBps} bps`);

  const currentReserve = BigInt(covenantUtxo.satoshis);
  log(`Live Covenant UTXO: ${covenantUtxo.txid}:${covenantUtxo.vout} (${currentReserve} sats)`);

  // Compute exact integer fill math from StrategyCovenant bytecode
  const amountOut = (fillUnits * selectedPool.priceNum * (10000n - selectedPool.feeBps)) / (selectedPool.priceDen * 10000n);
  const grossBchOut = (fillUnits * selectedPool.priceNum) / selectedPool.priceDen;
  const feeSats = grossBchOut - amountOut;
  const remainingReserve = currentReserve - amountOut;

  log(`Taker Selling:    ${fillUnits} pUSD`);
  log(`Gross Output:     ${grossBchOut} sats`);
  log(`Maker Fee Earned: ${feeSats} sats (auto-compounded into covenant reserve)`);
  log(`Amount Out (BCH): ${amountOut} sats (${Number(amountOut) / 1e8} BCH)`);
  log(`Remaining Pool:   ${remainingReserve} sats`);

  if (remainingReserve < 546n) {
    warn(`Pool reserve (${currentReserve} sats) too small for ${fillUnits} pUSD fill. Needs at least ${amountOut + 546n} sats.`);
    return;
  }

  // Instantiate Strategy Contract
  const artifact = loadArtifact(selectedPool.contractType === 'DutchDecayStrategyCovenant' ? 'DutchDecayStrategyCovenant' : 'StrategyCovenant');
  const pusdCatBytes = `0x${reverseHex(PUSDTEST_CAT)}`;
  const ownerPkhBytes = Buffer.from(selectedPool.ownerPkh, 'hex');

  const contract = new Contract(
    artifact,
    [ownerPkhBytes, pusdCatBytes, '0x', selectedPool.priceNum, selectedPool.priceDen, selectedPool.feeBps],
    { provider }
  );

  // Fetch fee UTXO
  const mUtxos = await provider.getUtxos(masterAddress);
  const feeUtxo = mUtxos.find((u: any) => !u.token && BigInt(u.satoshis) > 5000n);
  if (!feeUtxo) throw new Error('No fee UTXO in master wallet');

  if (pUtxo) {
    const txBuilder = new TransactionBuilder({ provider });

    // Input 0: Covenant (unlocked with fill(amountIn))
    txBuilder.addInput(covenantUtxo, contract.unlock.fill(fillUnits));
    // Input 1: Taker pUSD Token UTXO
    txBuilder.addInput(pUtxo, new SignatureTemplate(pUtxoWif).unlockP2PKH());
    // Input 2: Master fee UTXO
    txBuilder.addInput(feeUtxo, new SignatureTemplate(masterWif).unlockP2PKH());

    const DUST_SATS = 1000n;
    const TX_FEE_SATS = 1000n;

    // Output 0: Recreated Covenant with exact remaining reserve (mandatory by covenant)
    txBuilder.addOutput({ to: selectedPool.address, amount: remainingReserve });
    // Output 1: Taker receives net BCH (mandatory >= amountOut)
    txBuilder.addOutput({ to: masterAddress, amount: amountOut });

    // Output 2: Maker receives token payment
    txBuilder.addOutput({
      to: masterTokenAddress,
      amount: DUST_SATS,
      token: { category: PUSDTEST_CAT, amount: fillUnits },
    });

    // Output 3: Token change returned to taker (if any)
    const tokenChangeAmt = BigInt(pUtxo.token.amount) - fillUnits;
    if (tokenChangeAmt > 0n) {
      txBuilder.addOutput({
        to: PUSD_HOLDER_ADDR,
        amount: DUST_SATS,
        token: { category: PUSDTEST_CAT, amount: tokenChangeAmt },
      });
    }

    // Output 4: BCH fee change returned to master wallet
    const totalBchIn = covenantUtxo.satoshis + BigInt(pUtxo.satoshis) + BigInt(feeUtxo.satoshis);
    const totalBchOut = remainingReserve + amountOut + DUST_SATS + (tokenChangeAmt > 0n ? DUST_SATS : 0n);
    const bchChangeAmt = totalBchIn - totalBchOut - TX_FEE_SATS;
    if (bchChangeAmt > 546n) {
      txBuilder.addOutput({ to: masterAddress, amount: bchChangeAmt });
    }

    const tx = await txBuilder.send();
    const fillTxid = tx.txid || (tx as any).txId;

    ok(`🎉 Swap Fill Executed on Chipnet! TXID: ${fillTxid}`);
    log(`Explorer: https://chipnet.chaingraph.cash/tx/${fillTxid}`);

    // Register Fill in MeshServer
    try {
      await fetch(`${MESH_API_URL}/api/v1/positions/fills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyTxid: selectedPool.txid,
          strategyVout: selectedPool.vout,
          strategyAddress: selectedPool.address,
          fillTxid,
          tokenAmountIn: fillUnits.toString(),
          tokenCategoryIn: PUSDTEST_CAT,
          tokenAmountOut: netBchOut.toString(),
          tokenCategoryOut: '0x',
          feeSats: feeSats.toString(),
          makerPkh: selectedPool.ownerPkh,
        }),
      });
      log(`Fill record pushed to MeshServer API for real-time UI display.`);
    } catch {}
  } else {
    log(`Simulation fill complete (pUSD token UTXO not on network, simulated calculations printed).`);
  }

  section('Summary');
  ok(`Maker Pool:     ${selectedPool.address}`);
  ok(`Maker Fee:      +${feeSats} sats accrued`);
  ok(`New Pool Sats:  ${remainingReserve} sats`);
}

main().catch(console.error);
