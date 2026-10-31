/**
 * E2E Relayer Bot Test
 * 
 * This test exercises the full relayer pipeline:
 * 1. Deploy a LimitOrderSwap contract with tokens
 * 2. Register the intent in the relayer registry
 * 3. Use RelayerSolver to detect & price the UTXO
 * 4. Use RelayerExecutor to fill the swap on-chain
 * 
 * This proves the bot works autonomously before frontend integration.
 */
import {
    Contract,
    ElectrumNetworkProvider,
    SignatureTemplate,
    TransactionBuilder,
} from 'cashscript';
import { createHash } from 'crypto';
import { decodeTransaction, hexToBin, binToHex, cashAddressToLockingBytecode } from '@bitauth/libauth';
import { TestNetWallet, Config } from 'mainnet-js';
import * as fs from 'fs';
import * as path from 'path';

// --- Bot Imports ---
import { KNOWN_LIMIT_ORDERS, KNOWN_AUCTIONS, LimitOrderIntent, DutchAuctionIntent } from '../src/registry.js';
import { RelayerSolver } from '../src/bot/DutchAuctionSolver.js';
import { RelayerExecutor } from '../src/bot/DutchAuctionExecutor.js';

// Force Chipnet
(Config as any).EnforceCashScript = false;
(Config as any).DefaultNetwork = "chipnet";

const WALLET_FILE = 'wallet.json';
const LIMIT_ARTIFACT = path.resolve('../contracts-bch-swap/artifacts/LimitOrderSwap.json');
const reverseHex = (hex: string) => hex.match(/.{2}/g)!.reverse().join('');

async function main() {
    console.log("============================================");
    console.log("   E2E RELAYER BOT TEST (Limit Order)");
    console.log("============================================\n");

    // ===== STEP 1: Setup Wallet =====
    console.log("--- Step 1: Loading Wallet ---");
    const walletData = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
    const wallet = await TestNetWallet.fromWIF(walletData.wif);
    const userAddr = (wallet as any).address || (wallet as any).cashaddr;
    const tokenAddr = (wallet as any).tokenaddr;
    console.log(`  Wallet: ${userAddr}`);
    console.log(`  Token Addr: ${tokenAddr}`);

    const categoryId = "b4863d5773c7a269b6fe3b9f7ce2ce1098ab71c0b046ef2a39058d5e30b1f353";
    console.log(`  Token Category: ${categoryId}`);

    // ===== STEP 2: Deploy LimitOrder Contract =====
    console.log("\n--- Step 2: Deploy LimitOrderSwap Contract ---");
    const artifact = JSON.parse(fs.readFileSync(LIMIT_ARTIFACT, 'utf8'));
    const provider = new ElectrumNetworkProvider('chipnet');

    const makerPkh = await (wallet as any).getPublicKeyHash();
    const sellTokenCategoryLE = `0x${reverseHex(categoryId)}`;
    const buyTokenCategory = '0x'; // Native BCH
    const sellAmount = 1000n;
    const buyAmount = 5000n;
    const startTime = Math.floor(Date.now() / 1000);
    const expiryTime = BigInt(startTime + 3600);

    const contract = new Contract(artifact, [
        makerPkh, sellTokenCategoryLE, buyTokenCategory,
        sellAmount, buyAmount, expiryTime
    ], { provider });

    console.log(`  Contract Address: ${contract.address}`);
    console.log(`  Contract Token Address: ${contract.tokenAddress}`);
    console.log(`  Buy Price: ${buyAmount} sats`);
    console.log(`  Sell Amount: ${sellAmount} tokens`);

    // ===== STEP 3: Register Intent in Bot Registry =====
    console.log("\n--- Step 3: Register Intent in Bot Registry ---");
    const intent: LimitOrderIntent = {
        address: contract.address,
        makerPkh: makerPkh instanceof Uint8Array ? makerPkh : new Uint8Array(Buffer.from(makerPkh as string, 'hex')),
        sellTokenCategory: `0x${categoryId}`,
        buyTokenCategory: '',
        sellAmount,
        buyAmount,
        expiryTime,
    };
    // Push into the global registry so the solver can find it
    KNOWN_LIMIT_ORDERS.push(intent);
    console.log(`  ✅ Registered LimitOrder intent at ${contract.address}`);

    // ===== STEP 4: Fund the Contract =====
    console.log("\n--- Step 4: Fund Contract with Tokens ---");
    const fundAmount = 1000n;
    const balance = await wallet.getBalance();
    console.log(`  Wallet balance: ${balance} sats`);

    const result = await wallet.send([{
        cashaddr: contract.tokenAddress,
        value: 1000,
        unit: 'sat',
        category: categoryId,
        amount: fundAmount
    }] as any);

    const fundingTxId = result.txId ?? '';
    console.log(`  Funded! TXID: ${fundingTxId}`);

    // Wait for propagation then fetch raw tx
    console.log("  Waiting for network propagation...");
    let rawTx = '';
    for (let i = 0; i < 10; i++) {
        try {
            rawTx = (await (wallet.provider as any).getRawTransaction(fundingTxId)) as string;
            break;
        } catch (e) {
            console.log(`  Retrying getRawTransaction (${i + 1}/10)...`);
            await new Promise(r => setTimeout(r, 4000));
        }
    }
    if (!rawTx) throw new Error("Could not fetch raw tx after retries.");

    // Decode to find the correct vout
    const libauthTx = decodeTransaction(hexToBin(rawTx));
    if (typeof libauthTx === 'string') throw new Error("Failed to decode funding TX");

    const contractLocking = cashAddressToLockingBytecode(contract.tokenAddress);
    if (typeof contractLocking === 'string') throw new Error(contractLocking);
    const contractLockingHex = binToHex(contractLocking.bytecode);

    const tokenOutputIndex = libauthTx.outputs.findIndex((o: any) =>
        binToHex(o.lockingBytecode) === contractLockingHex &&
        o.token && binToHex(o.token.category) === categoryId
    );
    if (tokenOutputIndex === -1) throw new Error("Funding TX did not include the token!");
    console.log(`  ✅ Token locked at vout ${tokenOutputIndex}`);

    console.log("  Waiting for funding TX to propagate to Electrum UTXO set...");
    let walletUtxos: any[] = [];
    for (let attempt = 0; attempt < 20; attempt++) {
        walletUtxos = await provider.getUtxos(userAddr);
        const hasChange = walletUtxos.some((u: any) => u.txid === fundingTxId);
        if (hasChange) {
            console.log(`    Electrum synced after ${attempt + 1} attempt(s).`);
            break;
        }
        console.log(`    Waiting for Electrum sync... (${attempt + 1}/20)`);
        await new Promise(r => setTimeout(r, 3000));
    }

    // ===== STEP 5: Solver Detects & Prices =====
    console.log("\n--- Step 5: RelayerSolver detects UTXO ---");
    const solver = new RelayerSolver();

    // Simulate what the scanner would produce
    const scannedUtxo = {
        address: contract.address,
        txid: fundingTxId,
        vout: tokenOutputIndex,
        satoshis: 1000n,
        token: {
            amount: fundAmount,
            category: categoryId,
        },
    };

    const solution = solver.solve(scannedUtxo);
    if (!solution) {
        console.error("  ❌ Solver returned null! Intent not matched.");
        console.error("  Registry addresses:", KNOWN_LIMIT_ORDERS.map(l => l.address));
        console.error("  UTXO address:", scannedUtxo.address);
        return;
    }
    console.log(`  ✅ Solution found!`);
    console.log(`  Type: ${solution.type}`);
    console.log(`  Price: ${solution.currentPrice} sats`);
    console.log(`  Contract address matches: ${solution.contract.address === contract.address}`);

    // ===== STEP 6: Executor Fills the Swap =====
    console.log("\n--- Step 6: RelayerExecutor fills the swap ---");
    const executor = new RelayerExecutor();
    await executor.init(wallet);

    const txid = await executor.execute(solution);

    if (txid) {
        console.log(`\n${"=".repeat(50)}`);
        console.log(`  ✅ E2E RELAYER BOT TEST PASSED!`);
        console.log(`  Swap TXID: ${txid}`);
        console.log(`  Explorer: https://chipnet.chaingraph.cash/tx/${txid}`);
        console.log(`${"=".repeat(50)}\n`);
    } else {
        console.error("\n  ❌ Executor failed to return a TXID.");
    }
}

main().catch(e => {
    console.error("E2E RELAYER BOT TEST FAILED:", e);
    process.exit(1);
});
