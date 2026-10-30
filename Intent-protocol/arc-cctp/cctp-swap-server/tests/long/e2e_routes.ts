/** Live testnet matrix (routes 1-6; route 7 with SLOW=1). Needs a running server + funded wallets. */
import { ROUTES, runRoute } from '../../scripts/e2e_lib.js';
import { formatUsdc } from '../../src/cctp/encoding.js';
import { serverUp } from '../lib/env.js';
import { check, finish, skip, suite } from '../lib/report.js';

suite('long/e2e_routes');

if (!(await serverUp())) {
    skip('all routes', 'server not running (npm run dev)');
    process.exit(finish());
}

const only = process.env.ONLY?.split(',').map(Number);
for (const r of ROUTES.filter(x => (only ? only.includes(x.n) : !x.slow || process.env.SLOW === '1'))) {
    const res = await runRoute(r);
    check(`route ${r.n}: ${r.src} → ${r.dst} (${res.speed ?? r.speed})`, res.ok, {
        severity: 'HIGH',
        detail: res.ok ? `received ${formatUsdc(res.received!)} USDC, minted at ${res.sec?.minted}s — ${r.note}` : (res.error ?? `status ${res.status}`),
        evidence: res.mintTx ?? res.burnTx,
    });
}
process.exit(finish());
