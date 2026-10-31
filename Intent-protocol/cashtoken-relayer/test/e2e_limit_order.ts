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
const ARTIFACT_FILE = path.resolve('../contracts-bch-swap/artifacts/LimitOrderSwap.json');

// Reverse hex for Little-Endian (wire format for introspection opcodes)
const reverseHex = (hex: string) => hex.match(/.{2}/g)!.reverse().join('');

async function main() {
    console.log("=== Starting E2E Limit Order Test on Chipnet ===");
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
    // We must use a token category the wallet actually possesses
    const categoryId = "b4863d5773c7a269b6fe3b9f7ce2ce1098ab71c0b046ef2a39058d5e30b1f353";
    console.log(`Token Category: ${categoryId}`);

    // 3. Load Artifact
    console.log("Loading LimitOrderSwap artifact...");
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

    // Fixed price for Limit Order (5000 sats)
    const buyAmount = 5000n;
    console.log(`\n  Limit Order Price: ${buyAmount} sats`);

    // Expiry time (1 hour from now)
    const startTime = Math.floor(Date.now() / 1000);
    const expiryTime = BigInt(startTime + 3600);

    const provider = new ElectrumNetworkProvider('chipnet');

    /*
    LimitOrderSwap parameters:
    bytes20 makerPkh,
    bytes sellTokenCategory,
    bytes buyTokenCategory,
    int sellAmount,
    int buyAmount,
    int expiryTime
    */
    const contract = new Contract(artifact, [
        makerPkh,
        sellTokenCategoryLE,
        buyTokenCategory,
        sellAmount,
        buyAmount,
        expiryTime
    ], { provider });

    console.log(`Contract Address: ${contract.address}`);
    console.log(`Contract Token Address: ${contract.tokenAddress}`);
    console.log(`Contract Size: ${contract.bytesize} bytes`);
    console.log(`Contract Opcount: ${contract.opcount} ops`);

    // 5. Fund the Contract (Lock 1000 tokens)
    console.log("\n--- Funding Contract ---");
    const fundAmount = 1000n;

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
        await new Promise(r => setTimeout(r, 8000));
    } catch (e) {
        console.error("Funding failed:", e);
        return;
    }

    // Construct UTXO from the known funding TX
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
    // We explicitly extract the change output from the funding TX we just broadcasted,
    // bypassing Electrum's UTXO indexer which may take 30-60s to reflect the mempool change.
    const userLocking = cashAddressToLockingBytecode(userAddr);
    if (typeof userLocking === 'string') throw new Error(userLocking);
    const userLockingHex = binToHex(userLocking.bytecode);

    const changeOutputIndex = libauthTx.outputs.findIndex((o: any) =>
        binToHex(o.lockingBytecode) === userLockingHex && !o.token
    );

    let walletUtxos: any[] = [];
    if (changeOutputIndex !== -1) {
        walletUtxos.push({
            txid: fundingTxId,
            vout: changeOutputIndex,
            satoshis: libauthTx.outputs[changeOutputIndex].valueSatoshis,
        });
        console.log(`Found change UTXO from funding TX: ${fundingTxId}:${changeOutputIndex} with ${walletUtxos[0].satoshis} sats`);
    } else {
        // Fallback to wallet UTXOs if no change output was produced
        walletUtxos = await wallet.getUtxos();
        console.log(`Found ${walletUtxos.length} wallet UTXOs via mainnet-js fallback.`);
    }

    if (walletUtxos.length === 0) {
        console.error("No wallet UTXOs found. Cannot pay for the swap.");
        return;
    }

    try {
        console.log("\n--- Attempting Fill (Self-Swap) ---");
        const sigTemplate = new SignatureTemplate(walletData.wif);
        const txBuilder = new TransactionBuilder({ provider });

        // Input 0: The contract UTXO
        const resolverPk = await wallet.getPublicKey();
        txBuilder.addInput(utxo, contract.unlock.fill(resolverPk, sigTemplate));

        // Locktime must be <= Median Time Past (MTP ≈ now - 7200s on Chipnet).
        // Set to 2.5 hours ago to be safely below MTP and well before expiryTime.
        const currentLocktime = Math.floor(Date.now() / 1000) - 9000;

        // Input 1: EXACTLY ONE Wallet UTXO to pay the buy price + fees
        // Contract requires exactly 2 inputs (1 contract + 1 funding)
        let totalWalletInput = 0n;
        const neededSats = buyAmount + 2000n; // price + fees + change dust

        // Sort pure BCH UTXOs by value descending and pick the largest one
        const pureBchUtxos = walletUtxos.filter((u: any) => !u.token);
        const sortedUtxos = pureBchUtxos.sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)));

        if (sortedUtxos.length === 0 || BigInt(sortedUtxos[0].satoshis) < neededSats) {
            throw new Error(`No single UTXO is large enough to cover the fill price. Need ${neededSats} sats, largest UTXO is ${sortedUtxos[0]?.satoshis || 0} sats. Consolidate UTXOs first.`);
        }

        const wUtxo = sortedUtxos[0];
        txBuilder.addInput(wUtxo, sigTemplate.unlockP2PKH());
        totalWalletInput = BigInt(wUtxo.satoshis);
        console.log(`Total wallet input: ${totalWalletInput} sats`);

        // Output 0: Pay the maker >= buyAmount in BCH
        txBuilder.addOutput({
            to: userAddr,
            amount: buyAmount,
        });

        // Output 1: Send sell tokens to the resolver (ourselves)
        // Construct raw P2PKH locking bytecode
        const resolverPkBytes = typeof resolverPk === 'string' ? Buffer.from(resolverPk, 'hex') : resolverPk;
        const sha256Hash = createHash('sha256').update(resolverPkBytes).digest();
        const ripemd160Hash = createHash('ripemd160').update(sha256Hash).digest();
        const p2pkhLockingBytecode = new Uint8Array([
            0x76, 0xa9, 0x14, ...ripemd160Hash, 0x88, 0xac,
        ]);

        console.log(`Output 0 → maker: ${userAddr}`);
        console.log(`Output 1 → resolver (raw P2PKH): ${ripemd160Hash.toString('hex')}`);

        txBuilder.addOutput({
            to: p2pkhLockingBytecode,
            amount: 1000n, // dust sats
            token: {
                amount: fundAmount,
                category: categoryId,
            },
        });

        // Output 2: Change
        const totalInput = utxo.satoshis + totalWalletInput;
        const totalOutput = buyAmount + 1000n; // required Output 0 + 1000 dust
        const fee = 1000n;
        const change = totalInput - totalOutput - fee;
        if (change > 546n) {
            txBuilder.addOutput({
                to: userAddr,
                amount: change,
            });
        }

        txBuilder.setLocktime(currentLocktime);

        console.log(`Locktime: ${currentLocktime}`);
        console.log(`ExpiryTime: ${expiryTime}`);
        console.log(`Fee: ${fee} sats`);

        const tx = await txBuilder.send();

        console.log(`\n✅ Limit Order Swap Complete!`);
        console.log(`Transaction ID: ${tx.txid}`);
        console.log(`Explorer: https://chipnet.chaingraph.cash/tx/${tx.txid}`);

    } catch (e: any) {
        console.error("Fill failed! Reason:", e.message || e);
    }
}

main().catch(console.error);
