/**
 * tests/run-all.ts — run the cctp-swap-server suites, aggregate into tests/REPORT.md.
 *
 *   npx tsx tests/run-all.ts                 # unit + short (short skips if the server is down)
 *   npx tsx tests/run-all.ts --only=unit     # unit only (no network)
 *   npx tsx tests/run-all.ts --only=short    # REST checks against a running server
 *   npx tsx tests/run-all.ts --long          # + live testnet transfers (funded E2E wallets)
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { allResults, resetResults, type Result } from './lib/report.js';

const ROOT = path.resolve(process.cwd(), 'tests');
const only = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];
const withLong = process.argv.includes('--long');

const UNIT = ['unit/encoding.ts', 'unit/quote.ts', 'unit/store.ts', 'unit/worker.ts', 'unit/jupiter.ts', 'unit/admin.ts', 'unit/fees.ts', 'unit/public_api.ts', 'unit/chain_routes.ts', 'unit/lend.ts', 'unit/lendbch.ts', 'unit/lendbch_builders.ts', 'unit/lendbch_service.ts', 'unit/bch.ts'];
const SHORT = ['short/rest_api.ts', 'short/solana_swap.ts', 'short/admin_api.ts', 'short/chain_routes.ts'];
const LONG = ['long/e2e_routes.ts', 'long/track_and_self_mint.ts', 'long/lendbch_mainnet.ts'];

const SUITES = only === 'unit' ? UNIT : only === 'short' ? SHORT : [...UNIT, ...SHORT, ...(withLong ? LONG : [])];

function run(rel: string): void {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) { console.log(`  (skip missing ${rel})`); return; }
    console.log(`\n▶ ${rel}`);
    try { execFileSync('npx', ['tsx', path.posix.join('tests', rel)], { stdio: 'inherit', cwd: process.cwd(), shell: process.platform === 'win32' }); }
    catch { /* failures already recorded */ }
}

function render(results: Result[]): string {
    const bySuite = new Map<string, Result[]>();
    for (const r of results) { if (!bySuite.has(r.suite)) bySuite.set(r.suite, []); bySuite.get(r.suite)!.push(r); }
    const pass = results.filter(r => r.status === 'PASS').length;
    const fail = results.filter(r => r.status === 'FAIL').length;
    const skipN = results.filter(r => r.status === 'SKIP').length;
    let md = `# cctp-swap-server — Test Report\n\n_Generated ${new Date().toISOString()}_\n\n**${pass} pass · ${fail} fail · ${skipN} skip**\n\n`;
    for (const [suite, rs] of bySuite) {
        md += `## ${suite}\n\n| Test | Status | Severity | Detail |\n|---|---|---|---|\n`;
        for (const r of rs) md += `| ${r.name} | ${r.status} | ${r.severity} | ${(r.detail || '').replace(/\|/g, '\\|')} |\n`;
        md += '\n';
    }
    return md;
}

resetResults();
for (const s of SUITES) run(s);
const results = allResults();
fs.writeFileSync(path.join(ROOT, 'REPORT.md'), render(results));
const failed = results.filter(r => r.status === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} non-failing · report: tests/REPORT.md`);
process.exit(failed.some(r => r.severity === 'CRITICAL' || r.severity === 'HIGH') ? 1 : failed.length ? 2 : 0);
