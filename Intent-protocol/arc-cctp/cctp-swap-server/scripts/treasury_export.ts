/**
 * treasury_export.ts — print the secret key of a treasury wallet that was generated on this server, so its
 * owner can import it into a wallet and move the funds. Local use only: the key is never served over HTTP.
 *   npx tsx scripts/treasury_export.ts                 # list wallets
 *   npx tsx scripts/treasury_export.ts <address> --show # print that wallet's secret key
 */
import { config } from '../src/config.js';
import { Treasury } from '../src/treasury/Treasury.js';

const treasury = new Treasury(config.dataDir);
const [address, flag] = process.argv.slice(2);
if (!address) {
    for (const w of treasury.list()) {
        console.log(`${w.kind.padEnd(6)} ${w.address}  ${w.active ? 'ACTIVE ' : w.archived ? 'archived' : 'standby '} ${w.origin.padEnd(9)} ${w.label}`);
    }
    console.log('\nPrint a key: npx tsx scripts/treasury_export.ts <address> --show');
    process.exit(0);
}
const secret = treasury.secretOf(address);
if (!secret) { console.error('No key on this server for that address (external wallets are watch-only).'); process.exit(1); }
if (flag !== '--show') { console.log('A key exists for this address. Add --show to print it. Anyone who sees it can spend the wallet.'); process.exit(0); }
console.log(secret);
