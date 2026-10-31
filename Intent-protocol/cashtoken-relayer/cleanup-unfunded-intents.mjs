/**
 * cleanup-unfunded-intents.mjs
 *
 * Marks pending intents that have NO on-chain UTXOs as `cancelled`.
 * Safe to run while the relayer is live — it edits intents.json then
 * calls the live relayer's /router/refresh-pools so the in-memory
 * WATCH_ADDRESSES is pruned on the next rehydrate cycle.
 *
 * Usage:
 *   node cleanup-unfunded-intents.mjs [--dry-run] [--relayer-url http://localhost:3006]
 */

import { ElectrumNetworkProvider } from 'cashscript';
import fs from 'fs';
import path from 'path';

const INTENTS_FILE = path.resolve('./intents.json');
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RELAYER_URL = (() => {
    const i = args.indexOf('--relayer-url');
    return i !== -1 ? args[i + 1] : 'http://localhost:3006';
})();
const CONCURRENCY = 5; // parallel Electrum queries

// ── Load intents.json ────────────────────────────────────────────────────────
if (!fs.existsSync(INTENTS_FILE)) {
    console.error(`intents.json not found at ${INTENTS_FILE}`);
    process.exit(1);
}

const intents = JSON.parse(fs.readFileSync(INTENTS_FILE, 'utf8'));
const pending = intents.filter(i => i.status === 'pending');
console.log(`Loaded ${intents.length} total intents, ${pending.length} pending.\n`);

if (pending.length === 0) {
    console.log('Nothing to do.');
    process.exit(0);
}

// ── Electrum providers ───────────────────────────────────────────────────────
const chipnetProvider = new ElectrumNetworkProvider('chipnet');
const mainnetProvider = new ElectrumNetworkProvider('mainnet');

function providerFor(addr) {
    return addr.startsWith('bitcoincash:') ? mainnetProvider : chipnetProvider;
}

// ── Check UTXOs in batches ───────────────────────────────────────────────────
async function checkBatch(batch) {
    return Promise.all(batch.map(async intent => {
        try {
            const utxos = await providerFor(intent.contractAddress)
                .getUtxos(intent.contractAddress);
            return { intent, utxoCount: utxos.length };
        } catch (e) {
            console.warn(`  WARN: Electrum error for ${intent.id}: ${e.message}`);
            return { intent, utxoCount: -1 }; // -1 = unknown, leave as pending
        }
    }));
}

console.log(`Checking ${pending.length} contract addresses via Electrum (batch size ${CONCURRENCY})...\n`);

const results = [];
for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);
    const batchResults = await checkBatch(batch);
    results.push(...batchResults);
    process.stdout.write(`  ${Math.min(i + CONCURRENCY, pending.length)}/${pending.length} checked\r`);
}
console.log(); // newline after progress

// ── Categorise ───────────────────────────────────────────────────────────────
const unfunded = results.filter(r => r.utxoCount === 0);
const funded   = results.filter(r => r.utxoCount  > 0);
const unknown  = results.filter(r => r.utxoCount === -1);

console.log(`\nResults:`);
console.log(`  Unfunded (0 UTXOs) : ${unfunded.length}  ← will be cancelled`);
console.log(`  Funded   (>0 UTXOs): ${funded.length}   ← left as pending`);
console.log(`  Unknown  (error)   : ${unknown.length}   ← left as pending`);

if (funded.length > 0) {
    console.log('\nFunded intents (skipped):');
    for (const { intent, utxoCount } of funded) {
        console.log(`  ${intent.id}  ${utxoCount} UTXO(s)  ${intent.contractAddress}`);
    }
}

if (unfunded.length === 0) {
    console.log('\nNo unfunded intents to cancel.');
    process.exit(0);
}

console.log('\nUnfunded intents to cancel:');
for (const { intent } of unfunded) {
    const now = Math.floor(Date.now() / 1000);
    const expiredAgo = intent.expiryTime
        ? `expired ${Math.round((now - intent.expiryTime) / 3600)}h ago`
        : 'no expiry set';
    console.log(`  ${intent.id}  ${intent.type}  ${expiredAgo}`);
}

if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes written. Remove --dry-run to apply.');
    process.exit(0);
}

// ── Write backup then update intents.json ────────────────────────────────────
const backup = `${INTENTS_FILE}.bak-${Date.now()}`;
fs.copyFileSync(INTENTS_FILE, backup);
console.log(`\nBackup written to ${path.basename(backup)}`);

const cancelledIds = new Set(unfunded.map(r => r.intent.id));
const updated = intents.map(i => {
    if (cancelledIds.has(i.id)) {
        return { ...i, status: 'cancelled', cancelledAt: Date.now(), cancelReason: 'unfunded-cleanup' };
    }
    return i;
});

fs.writeFileSync(INTENTS_FILE, JSON.stringify(updated, null, 2));
console.log(`intents.json updated — ${unfunded.length} intents marked cancelled.`);

// ── Notify live relayer ───────────────────────────────────────────────────────
// The relayer's in-memory WATCH_ADDRESSES won't shrink until it restarts or
// the bot loop naturally stops watching empty contracts. We call /router/refresh-pools
// to at least flush the Cauldron cache; a full address prune needs a restart.
try {
    const res = await fetch(`${RELAYER_URL}/router/refresh-pools`, { method: 'POST' });
    if (res.ok) {
        console.log(`\nRelayer notified via POST ${RELAYER_URL}/router/refresh-pools`);
    } else {
        console.warn(`\nRelayer responded ${res.status} — restart it to prune WATCH_ADDRESSES.`);
    }
} catch {
    console.warn(`\nCould not reach relayer at ${RELAYER_URL} — restart it to prune WATCH_ADDRESSES.`);
}

console.log('\nDone. Restart the relayer to apply WATCH_ADDRESSES pruning.');
process.exit(0);
