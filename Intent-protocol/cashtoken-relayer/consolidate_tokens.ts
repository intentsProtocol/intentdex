/**
 * Consolidates relayer CashToken UTXOs into single UTXOs with enough BCH sats.
 * Combines all token UTXOs of a category + one BCH UTXO → one token UTXO (5000 sats) + BCH change.
 */
import { ElectrumNetworkProvider, SignatureTemplate, TransactionBuilder } from 'cashscript';
import * as dotenv from 'dotenv';
dotenv.config();

const NETWORK      = 'chipnet';
const WIF          = process.env.RELAYER_PRIVATE_KEY_WIF!;
const TARGET_SATS  = 5000n; // sats to put in the consolidated token UTXO

async function main() {
    if (!WIF) throw new Error('RELAYER_PRIVATE_KEY_WIF not set in .env');

    const provider = new ElectrumNetworkProvider(NETWORK);

    // Derive addresses from WIF
    const { TestNetWallet } = await import('mainnet-js');
    const wallet = await TestNetWallet.fromWIF(WIF);
    const relayerAddr  = (wallet as any).cashaddr as string;
    const tokenAddr    = (wallet as any).tokenaddr as string;
    const relayerPKH   = Buffer.from((wallet as any).publicKeyHash).toString('hex');
    const sigTemplate  = new SignatureTemplate(WIF);

    console.log(`Relayer address:     ${relayerAddr}`);
    console.log(`Relayer token addr:  ${tokenAddr}`);

    // Fetch Cauldron token symbols/metadata to print nice logs
    let cauldronTokens: any[] = [];
    try {
        const listRes = await fetch('https://indexer-chipnet.riften.net/cauldron/tokens/list_cached');
        if (listRes.ok) cauldronTokens = await listRes.json();
    } catch {}
    const symbolMap = new Map<string, string>();
    for (const t of cauldronTokens) {
        symbolMap.set(t.token_id, t.bcmr?.token?.symbol || t.display_symbol || 'UNKNOWN');
    }

    // Fetch all UTXOs
    const utxos1 = await provider.getUtxos(relayerAddr);
    const utxos2 = await provider.getUtxos(tokenAddr);
    
    // Deduplicate by txid:vout
    const seen = new Set<string>();
    const allUtxos = [...utxos1, ...utxos2].filter((u: any) => {
        const key = `${u.txid}:${u.vout}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const bchUtxos = utxos1.filter((u: any) => !u.token);

    // Identify target token categories
    const cliCategory = process.argv[2];
    let categoriesToConsolidate: string[] = [];

    if (cliCategory) {
        const cleanCat = cliCategory.startsWith('0x') ? cliCategory.slice(2) : cliCategory;
        categoriesToConsolidate.push(cleanCat);
    } else {
        // Auto-detect all unique token categories
        const allCats = new Set<string>();
        for (const u of allUtxos) {
            if (u.token?.category) {
                allCats.add(u.token.category);
            }
        }

        for (const cat of allCats) {
            const tokenUtxos = allUtxos.filter((u: any) => u.token?.category === cat);
            const needsConsolidation = tokenUtxos.length > 1 || tokenUtxos.some((u: any) => BigInt(u.satoshis) < TARGET_SATS);
            if (needsConsolidation) {
                categoriesToConsolidate.push(cat);
            }
        }
    }

    if (categoriesToConsolidate.length === 0) {
        console.log('No token categories need consolidation. All set!');
        process.exit(0);
    }

    console.log(`Identified ${categoriesToConsolidate.length} token categories for consolidation.`);

    // Perform consolidation sequentially
    for (const cat of categoriesToConsolidate) {
        const ticker = symbolMap.get(cat) || 'UNKNOWN';
        console.log(`\n─── Consolidating ${ticker} (${cat.slice(0, 12)}…) ───`);

        // Re-fetch UTXOs to ensure we have the latest state
        const freshUtxos1 = await provider.getUtxos(relayerAddr);
        const freshUtxos2 = await provider.getUtxos(tokenAddr);
        
        const freshSeen = new Set<string>();
        const freshAll = [...freshUtxos1, ...freshUtxos2].filter((u: any) => {
            const key = `${u.txid}:${u.vout}`;
            if (freshSeen.has(key)) return false;
            freshSeen.add(key);
            return true;
        });

        const tokenUtxos = freshAll.filter((u: any) => u.token?.category === cat);
        const freshBch = freshUtxos1.filter((u: any) => !u.token);

        if (tokenUtxos.length === 0) {
            console.log(`No UTXOs found for ${ticker}. Skipping.`);
            continue;
        }

        const totalTokens = tokenUtxos.reduce((s: bigint, u: any) => s + BigInt(u.token!.amount), 0n);
        const totalTokenSats = tokenUtxos.reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);
        console.log(`Found ${tokenUtxos.length} UTXOs, total ${totalTokens} units, current sats = ${totalTokenSats}`);

        if (tokenUtxos.length === 1 && totalTokenSats >= TARGET_SATS) {
            console.log(`Already consolidated. Skipping.`);
            continue;
        }

        // Dynamically calculate estimated fee (148 bytes per P2PKH input, 34 bytes per output, 10 bytes overhead)
        const numInputs = BigInt(tokenUtxos.length);
        const estimatedSizeNoBch = numInputs * 148n + 68n + 10n;
        const feeNoBch = estimatedSizeNoBch * 2n;

        let fee = feeNoBch;
        let needed = TARGET_SATS - totalTokenSats + fee;

        let bchUtxo: any = null;
        if (needed > 0n || totalTokenSats < TARGET_SATS) {
            // Adding a BCH input adds 148 bytes to the transaction size, so recalculate fee
            const estimatedSizeWithBch = (numInputs + 1n) * 148n + 68n + 10n;
            fee = estimatedSizeWithBch * 2n;
            needed = TARGET_SATS - totalTokenSats + fee;

            bchUtxo = freshBch
                .sort((a: any, b: any) => Number(BigInt(a.satoshis) - BigInt(b.satoshis)))
                .find((u: any) => BigInt(u.satoshis) >= needed);
        }

        if (!bchUtxo && totalTokenSats < TARGET_SATS) {
            console.error(`No BCH UTXO covers top-up (need ${needed} sats). Skipping this token.`);
            continue;
        }

        const tb = new TransactionBuilder({ provider });
        const unlocker = sigTemplate.unlockP2PKH();

        // Add all token inputs
        for (const u of tokenUtxos) {
            tb.addInput({
                txid: u.txid, vout: u.vout, satoshis: BigInt(u.satoshis),
                token: { amount: BigInt(u.token!.amount), category: cat }
            }, unlocker);
        }

        let bchInputSats = 0n;
        if (bchUtxo && needed > 0n) {
            bchInputSats = BigInt(bchUtxo.satoshis);
            tb.addInput({ txid: bchUtxo.txid, vout: bchUtxo.vout, satoshis: bchInputSats }, unlocker);
        }

        const consolidatedSats = totalTokenSats + bchInputSats - fee;
        const tokenOutputSats = consolidatedSats > TARGET_SATS ? TARGET_SATS : consolidatedSats;
        const p2pkhBytecode = Uint8Array.from(Buffer.from(`76a914${relayerPKH}88ac`, 'hex'));

        // Output 0: consolidated token UTXO
        tb.addOutput({
            to: p2pkhBytecode,
            amount: tokenOutputSats,
            token: { amount: totalTokens, category: cat },
        });

        // Output 1: BCH change
        const bchChange = totalTokenSats + bchInputSats - tokenOutputSats - fee;
        if (bchChange > 546n) {
            tb.addOutput({ to: p2pkhBytecode, amount: bchChange });
        }

        console.log(`Sending consolidation tx for ${ticker}…`);
        try {
            const txDetails = await tb.send();
            console.log(`✅ Consolidated! TXID: ${txDetails.txid}`);
        } catch (e: any) {
            console.error(`❌ Consolidation failed for ${ticker}: ${e.message}`);
        }
    }

    console.log('\nAll consolidations processed!');
    process.exit(0);
}

main().catch(e => { console.error('Failed:', e.message); process.exit(1); });
