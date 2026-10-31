/**
 * redust_inventory.ts — report and repair DIRECT-unusable token inventory.
 *
 * A token UTXO below MIN_TOKEN_UTXO_DUST_SATS cannot fund a DIRECT fill: the
 * covenant allows exactly 2 inputs, so the fee has to come from that UTXO's own
 * sats. Such holdings look like healthy inventory on the dashboard while forcing
 * every token intent through a Cauldron pre-fill — an extra transaction, swap fee,
 * LP fee and mempool wait each time.
 *
 * The executor now mints token change at the shared floor, so fills are
 * self-sustaining from here on. This script clears a pre-existing backlog.
 *
 *   npx tsx scripts/redust_inventory.ts                 # report only (read-only)
 *   npx tsx scripts/redust_inventory.ts --apply         # re-dust every starved token
 *   npx tsx scripts/redust_inventory.ts --apply --token <categoryHex>
 *
 * BROADCASTS one transaction per token when --apply is given. Chipnet by default.
 */
import { TestNetWallet, Wallet, Config } from 'mainnet-js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ElectrumSupervisor } from '../src/electrum.js';
import { ENV } from '../src/config.js';
import * as Inventory from '../src/bot/InventoryMaintenance.js';

(Config as any).EnforceCashScript = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const NETWORK = (args.includes('--mainnet') ? 'mainnet' : 'chipnet') as 'mainnet' | 'chipnet';
const ONLY_TOKEN = (() => {
    const i = args.indexOf('--token');
    return i !== -1 ? args[i + 1]?.replace(/^0x/, '') : undefined;
})();

const txUrl = (id: string) => NETWORK === 'mainnet'
    ? `https://blockchair.com/bitcoin-cash/transaction/${id}`
    : `https://chipnet.chaingraph.cash/tx/${id}`;

(async () => {
    console.log(`=== INVENTORY DUST ${APPLY ? 'REPAIR' : 'REPORT'} (${NETWORK}) ===`);
    if (APPLY) console.log('⚠️  --apply given: this WILL broadcast transactions\n');

    const wif = NETWORK === 'mainnet'
        ? ENV.MAINNET_PRIVATE_KEY_WIF
        : (ENV.RELAYER_PRIVATE_KEY_WIF
            ?? JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', ENV.WALLET_PATH), 'utf8')).wif);
    if (!wif) { console.error(`No WIF available for ${NETWORK}`); process.exit(2); }

    const wallet: any = NETWORK === 'mainnet' ? await Wallet.fromWIF(wif) : await TestNetWallet.fromWIF(wif);
    const sup = new ElectrumSupervisor(NETWORK);
    await sup.start();

    const addrs = { cashaddr: wallet.cashaddr as string, tokenaddr: wallet.tokenaddr as string };
    const before = await Inventory.summarize(sup.provider, addrs);

    console.log(`dust floor: ${before.dustFloorSats} sats\n`);
    if (before.holdings.length === 0) console.log('  (no token holdings)');
    for (const h of before.holdings) {
        const flag = h.usableUnits === 0n && h.units > 0n ? '  ← STARVED' : '';
        console.log(`  ${h.tokenId.slice(0, 20)}…`);
        console.log(`      units ${h.units}  usable ${h.usableUnits}  ` +
            `utxos ${h.utxoCount} (${h.usableUtxoCount} usable)  ` +
            `largest usable ${h.largestUsableUnits}${flag}`);
    }
    console.log(`\nstarved tokens: ${before.starvedTokenIds.length}`);

    if (!APPLY) {
        if (before.starvedTokenIds.length) {
            console.log('\nRe-run with --apply to consolidate and top these up.');
        }
        await sup.stop();
        process.exit(0);
    }

    const targets = ONLY_TOKEN ? [ONLY_TOKEN] : before.starvedTokenIds;
    if (targets.length === 0) { console.log('\nNothing to repair.'); await sup.stop(); process.exit(0); }

    console.log(`\n── repairing ${targets.length} token(s) ──`);
    const results = await Inventory.redustStarved(sup.provider, {
        ...addrs,
        privateKeyWif: wallet.privateKeyWif as string,
        publicKeyHash: wallet.publicKeyHash as Uint8Array,
    }, { tokenIds: targets });

    for (const r of results) {
        if (r.skipped) console.log(`  ${r.tokenId.slice(0, 20)}… skipped: ${r.skipped}`);
        else console.log(`  ${r.tokenId.slice(0, 20)}… → ${r.unitsConsolidated} units on ${r.satsAttached} sats — ${txUrl(r.txid!)}`);
    }

    // Re-read so the operator sees the post-state, not just the broadcast txids.
    console.log('\n── waiting ~8s for mempool propagation, then re-checking ──');
    await new Promise(r => setTimeout(r, 8000));
    const after = await Inventory.summarize(sup.provider, addrs);
    for (const h of after.holdings) {
        console.log(`  ${h.tokenId.slice(0, 20)}… units ${h.units} usable ${h.usableUnits} ` +
            `(${h.usableUtxoCount}/${h.utxoCount} utxos usable)`);
    }
    console.log(`\nstarved before: ${before.starvedTokenIds.length} → after: ${after.starvedTokenIds.length}`);

    await sup.stop();
    process.exit(0);
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
