/**
 * e2e_transfer.ts — run live USDC transfers through a running server.
 *   ONLY=2 npx tsx scripts/e2e_transfer.ts          # one route by number
 *   npx tsx scripts/e2e_transfer.ts                 # routes 1-6
 *   SLOW=1 npx tsx scripts/e2e_transfer.ts          # + route 7 (Standard, 15-19 min)
 *   AMOUNT=2 RELAYER_URL=https://… npx tsx scripts/e2e_transfer.ts
 */
import { BASE, ROUTES, runRoute } from './e2e_lib.js';

const only = process.env.ONLY?.split(',').map(Number);
const routes = ROUTES.filter(r => (only ? only.includes(r.n) : !r.slow || process.env.SLOW === '1'));

console.log(`cctp-swap-server E2E against ${BASE}: routes ${routes.map(r => r.n).join(',')}`);
let failed = 0;
for (const r of routes) {
    const res = await runRoute(r);
    if (!res.ok) failed++;
}
console.log(`\n${routes.length - failed}/${routes.length} routes OK · timings in ../docs/04-measurements.md`);
process.exit(failed ? 1 : 0);
