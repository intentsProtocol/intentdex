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

// Force Chipnet
(Config as any).EnforceCashScript = false;
(Config as any).DefaultNetwork = "chipnet";

const WALLET_FILE = 'wallet.json';
const TOKEN_DATA_FILE = 'token-data.json';
const ARTIFACT_FILE = path.resolve('../contracts-bch-swap/artifacts/DutchAuctionSwap.json');

// Reverse hex for Little-Endian (wire format for introspection opcodes)
const reverseHex = (hex: string) => hex.match(/.{2}/g)!.reverse().join('');

async function main() {
    console.log("=== Starting E2E Dutch Auction Test on Chipnet ===");
    console.log("VERSION 4 - CashScript v0.12 TransactionBuilder API");

    // 1. Load Wallet
    if (!fs.existsSync(WALLET_FILE)) {
        throw new Error("Wallet file not found. Run 'npm run setup-wallet' first.");
    }
    const walletData = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
    const wallet = await TestNetWallet.fromWIF(walletData.wif);
    const userAddr = (wallet as any).address || (wallet as any).cashaddr;
    const tokenAddr = (wallet as any).tokenaddr;
    console.log(`User Wallet: ${userAddr}`);
    console.log(`Token Address: ${tokenAddr}`);

    // 2. Load Token Data
    // We must use a token category the wallet actually possesses, otherwise mainnet-js silently ignores it
    const categoryId = "b4863d5773c7a269b6fe3b9f7ce2ce1098ab71c0b046ef2a39058d5e30b1f353";
    console.log(`Token Category: ${categoryId}`);

    // 3. Load Artifact
    console.log("Loading DutchAuctionSwap artifact...");
    if (!fs.existsSync(ARTIFACT_FILE)) {
        throw new Error(`Artifact not found at ${ARTIFACT_FILE}. Run 'npm run build' first.`);
    }
    const artifact = JSON.parse(fs.readFileSync(ARTIFACT_FILE, 'utf8'));

    // 4. Initialize Contract
    // Note: Reverse category ID to Little-Endian for introspection opcode matching
    const makerPkh = await (wallet as any).getPublicKeyHash();
    const sellTokenCategoryLE = `0x${reverseHex(categoryId)}`;
    const buyTokenCategory = '0x'; // Native BCH
    const sellAmount = 1000n;

    // 6. Integrate Cauldron DEX Oracle (Fetch Price)
    console.log("\n--- Fetching Oracle Price from Cauldron DEX ---");
    let tokenPriceSats = 0; // Price of 1 token in satoshis (from price_now)
    let tokenPriceUsd = 0;
    let oracleFound = false;
    try {
        const response = await fetch(`https://indexer-chipnet.riften.net/cauldron/tokens/search_cached?q=${categoryId}`);
        if (response.ok) {
            const data = await response.json();
            const tokenInfo = Array.isArray(data) ? data[0] : data;
            if (tokenInfo) {
                console.log(`  Token Name: ${tokenInfo.display_name || 'Unknown'}`);
                console.log(`  Symbol: ${tokenInfo.display_symbol || 'N/A'}`);
                console.log(`  Price (BCH): ${tokenInfo.price_now} sats/token`);
                console.log(`  Price (USD): $${tokenInfo.price_now_usd}`);
                console.log(`  TVL: ${tokenInfo.tvl_sats} sats / ${tokenInfo.tvl_tokens} tokens`);
                console.log(`  Trade Volume: ${tokenInfo.trade_volume} sats`);
                if (tokenInfo.price_now && tokenInfo.price_now > 0) {
                    tokenPriceSats = tokenInfo.price_now;
                    tokenPriceUsd = tokenInfo.price_now_usd || 0;
                    oracleFound = true;
                }
            }
        }
    } catch (e) {
        console.log("Failed to fetch from Cauldron Oracle:", e);
    }

    // Calculate how many sats 1000 tokens are worth using the BCH price directly
    // price_now is sats per token (e.g. 0.48 sats/token)
    // For 1000 tokens: 1000 * 0.48 = 480 sats total
    let equivalentSats: bigint;
    if (oracleFound && tokenPriceSats > 0) {
        // price_now is in sats (can be fractional), multiply by sellAmount
        equivalentSats = BigInt(Math.ceil(1000 * tokenPriceSats));
        console.log(`\n  Oracle Price: ${tokenPriceSats} sats/token`);
        console.log(`  1000 tokens = ${equivalentSats} sats`);
    } else {
        // Fallback: use a reasonable test value
        equivalentSats = 5000n;
        console.log(`  No oracle price. Using fallback: ${equivalentSats} sats`);
    }

    // The starting amount is a 10% premium over spot price (maker wants more)
    const startBuyAmount = equivalentSats + (equivalentSats * 10n / 100n);
    // The ending amount is a 10% discount under spot price (maker accepts less over time)
    const endBuyAmount = equivalentSats - (equivalentSats * 10n / 100n);

    // Ensure we don't go below absolute dust limit (546 sats)
    const safeStartBuyAmount = startBuyAmount < 1000n ? 2000n : startBuyAmount;
    const safeEndBuyAmount = endBuyAmount < 546n ? 1000n : endBuyAmount;

    console.log(`\n  Dutch Auction Range: ${safeStartBuyAmount} sats (start) → ${safeEndBuyAmount} sats (end)`);

    const duration = 120n; // 2 minutes
    // Set startTime to 2.5 hours ago so MTP check passes immediately (time travel)
    const startTime = BigInt(Math.floor(Date.now() / 1000) - 9000);

    const provider = new ElectrumNetworkProvider('chipnet');

    const contract = new Contract(artifact, [
        makerPkh,
        sellTokenCategoryLE,  // Little-Endian for introspection
        buyTokenCategory,
        sellAmount,
        safeStartBuyAmount,
        safeEndBuyAmount,
        startTime,
        duration
    ], { provider });

    console.log(`Contract Address: ${contract.address}`);
    console.log(`Contract Token Address: ${contract.tokenAddress}`);
    console.log(`Contract Size: ${contract.bytesize} bytes`);
    console.log(`Contract Opcount: ${contract.opcount} ops`);

    // 5. Fund the Contract (Lock 1000 tokens)
    console.log("\n--- Funding Contract ---");
    const fundAmount = 1000n;

    // Construct the contract UTXO directly from the funding TX we just created.
    // The Chipnet Electrum server doesn't reliably return token data in UTXOs,
    // so we build the UTXO object ourselves since we know exactly what we funded.
    let fundingTxId: string;
    try {
        const balance = await wallet.getBalance();
        if (balance < 10000) {
            throw new Error(`Insufficient BCH balance (${balance}). Need ~10000.`);
        }

        const result = await wallet.send([
            {
                cashaddr: contract.tokenAddress,
                value: 1000,
                unit: 'sat',
                category: categoryId,
                amount: fundAmount
            }
        ] as any);
        fundingTxId = result.txId ?? '';
        console.log(`Funded! TXID: ${fundingTxId}`);
        console.log(`Waiting for confirmation...`);
        await new Promise(r => setTimeout(r, 5000));
    } catch (e) {
        console.error("Funding failed:", e);
        return;
    }

    // Construct UTXO from the known funding TX
    // To find the correct `vout`, we decode the raw TX and find the output sent to the token address
    // with the correct category ID.
    console.log("Waiting for network propagation via mainnet-js provider...");
    let rawTx = '';
    for (let i = 0; i < 5; i++) {
        try {
            // Use mainnet-js provider which broadcasted the TX to get it
            // Wrap in a 5 second timeout because mainnet-js sometimes hangs indefinitely here
            rawTx = (await Promise.race([
                (wallet.provider as any).getRawTransaction(fundingTxId),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000))
            ])) as string;
            break;
        } catch (e) {
            console.log(`Still un-synced. Retrying mainnet-js provider (${i + 1}/5)...`);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
    if (!rawTx) throw new Error("Could not fetch raw tx from mainnet-js provider after retries.");

    const libauthTx = decodeTransaction(hexToBin(rawTx));
    if (typeof libauthTx === 'string') throw new Error("Failed to decode funding TX");

    // contract.tokenAddress uses P2SH20 locking script
    const contractLocking = cashAddressToLockingBytecode(contract.tokenAddress);
    if (typeof contractLocking === 'string') throw new Error(contractLocking);
    const contractLockingHex = binToHex(contractLocking.bytecode);

    const tokenOutputIndex = libauthTx.outputs.findIndex((o: any) =>
        binToHex(o.lockingBytecode) === contractLockingHex &&
        o.token && binToHex(o.token.category) === categoryId
    );

    if (tokenOutputIndex === -1) {
        throw new Error("Funding TX did not include the token! Wallet may not have the token balance.");
    }

    const utxo = {
        txid: fundingTxId,
        vout: tokenOutputIndex,
        satoshis: 1000n,
        token: {
            amount: fundAmount,
            category: categoryId,
        },
    };

    console.log("Using UTXO:", JSON.stringify(utxo, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));

    // Get Wallet UTXOs for paying the buy price + fees
    const walletUtxos = await provider.getUtxos(userAddr);
    console.log(`Found ${walletUtxos.length} wallet UTXOs via provider.`);

    if (walletUtxos.length === 0) {
        console.error("No wallet UTXOs found. Cannot pay for the swap.");
        return;
    }

    try {
        console.log("\n--- Attempting Cancel (Refund) ---");
        const sigTemplate = new SignatureTemplate(walletData.wif);

        // Build the transaction using CashScript v0.12 TransactionBuilder
        const txBuilder = new TransactionBuilder({ provider });

        // Input 0: The contract UTXO (sell tokens locked in covenant)
        txBuilder.addInput(utxo, contract.unlock.cancel());

        let totalWalletInput = 0n;
        const pureBchUtxos = walletUtxos.filter((u: any) => !u.token);
        const sortedUtxos = pureBchUtxos.sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)));

        if (sortedUtxos.length === 0) {
            throw new Error(`No wallet UTXO found to pay fees.`);
        }

        const wUtxo = sortedUtxos[0];
        txBuilder.addInput(wUtxo, sigTemplate.unlockP2PKH());
        totalWalletInput = BigInt(wUtxo.satoshis);
        console.log(`Total wallet input: ${totalWalletInput} sats`);

        // Output 0: Pay the maker back their locked tokens
        // Construct raw P2PKH locking bytecode for the maker
        const makerPkhBytes = Buffer.from(await (wallet as any).getPublicKeyHash(), 'hex');
        const p2pkhLockingBytecode = new Uint8Array([
            0x76, 0xa9, 0x14, ...makerPkhBytes, 0x88, 0xac,
        ]);

        txBuilder.addOutput({
            to: p2pkhLockingBytecode,
            amount: 1000n, // dust sats
            token: {
                amount: fundAmount,
                category: categoryId,
            },
        });

        // Output 1: Change
        const totalInput = utxo.satoshis + totalWalletInput;
        const totalOutput = 1000n; // required Output 0
        const fee = 1000n;
        const change = totalInput - totalOutput - fee;
        if (change > 546n) {
            txBuilder.addOutput({
                to: userAddr,
                amount: change,
            });
        }

        const currentLocktime = Number(startTime + duration) + 60;
        txBuilder.setLocktime(currentLocktime);

        console.log(`Locktime set to: ${currentLocktime}`);
        console.log(`ExpiryTime: ${startTime + duration}`);
        console.log(`Fee: ${fee} sats`);

        // Send the transaction
        const tx = await txBuilder.send();

        console.log(`\n✅ Dutch Auction Cancel/Refund Complete!`);
        console.log(`Transaction ID: ${tx.txid}`);
        console.log(`Explorer: https://chipnet.chaingraph.cash/tx/${tx.txid}`);

    } catch (e: any) {
        console.error("Swap failed:", e);
        if (e.message) console.error("Error Message:", e.message);
        if (e.logs) console.error("Debug Logs:", e.logs);
    }
}

main().catch(console.error);
