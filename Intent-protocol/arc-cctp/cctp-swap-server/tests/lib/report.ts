/**
 * tests/lib/report.ts — shared pass/fail + severity aggregator for the
 * cctp-swap-server test suites.
 *
 * Standalone (no framework). Suites import { suite, check, expectReject, finish };
 * run-all.ts aggregates tests/.results.jsonl into tests/REPORT.md.
 */
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type Status   = 'PASS' | 'FAIL' | 'SKIP';

export interface Result {
    suite: string; name: string; status: Status; severity: Severity; detail: string; evidence?: string;
}

const RESULTS_FILE = path.resolve(process.cwd(), 'tests', '.results.jsonl');
let currentSuite = 'unknown';
const local: Result[] = [];

export function suite(name: string): void {
    currentSuite = name;
    console.log(chalk.blue(`\n══ ${name} ══`));
}

function record(r: Result): void {
    local.push(r);
    const icon = r.status === 'PASS' ? chalk.green('PASS') : r.status === 'FAIL' ? chalk.red('FAIL') : chalk.yellow('SKIP');
    console.log(`  ${icon}  [${r.severity}] ${r.name}`);
    if (r.detail)   console.log(chalk.gray(`        ${r.detail}`));
    if (r.evidence) console.log(chalk.gray(`        evidence: ${r.evidence}`));
    try { fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true }); fs.appendFileSync(RESULTS_FILE, JSON.stringify(r) + '\n'); } catch { /* best-effort */ }
}

export function check(name: string, ok: boolean, opts: { severity?: Severity; detail?: string; evidence?: string } = {}): boolean {
    record({ suite: currentSuite, name, status: ok ? 'PASS' : 'FAIL', severity: opts.severity ?? 'MEDIUM', detail: opts.detail ?? '', evidence: opts.evidence });
    return ok;
}

export function skip(name: string, detail = '', severity: Severity = 'INFO'): void {
    record({ suite: currentSuite, name, status: 'SKIP', severity, detail });
}

export async function expectReject(
    name: string, fn: () => Promise<any>,
    opts: { severity?: Severity; matcher?: RegExp; drainedEvidence?: () => string } = {},
): Promise<void> {
    const severity = opts.severity ?? 'CRITICAL';
    try {
        const out = await fn();
        record({ suite: currentSuite, name, status: 'FAIL', severity, detail: 'attack SUCCEEDED — action was not rejected (funds drainable)', evidence: opts.drainedEvidence?.() ?? (typeof out === 'string' ? out : undefined) });
    } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (opts.matcher && !opts.matcher.test(msg)) record({ suite: currentSuite, name, status: 'FAIL', severity, detail: `rejected but wrong reason: ${msg}` });
        else record({ suite: currentSuite, name, status: 'PASS', severity, detail: `correctly rejected: ${msg.split('\n')[0].slice(0, 120)}` });
    }
}

export function allResults(): Result[] {
    const persisted: Result[] = [];
    try { if (fs.existsSync(RESULTS_FILE)) for (const line of fs.readFileSync(RESULTS_FILE, 'utf8').split('\n')) if (line.trim()) persisted.push(JSON.parse(line)); } catch { /* ignore */ }
    return persisted.length ? persisted : local;
}

export function resetResults(): void {
    try { if (fs.existsSync(RESULTS_FILE)) fs.unlinkSync(RESULTS_FILE); } catch { /* ignore */ }
}

export function finish(opts: { gateSeverities?: Severity[] } = {}): number {
    const rs = local;
    const pass = rs.filter(r => r.status === 'PASS').length;
    const fail = rs.filter(r => r.status === 'FAIL').length;
    const skipN = rs.filter(r => r.status === 'SKIP').length;
    console.log(chalk.blue(`\n── ${currentSuite || 'summary'}: ${pass} pass / ${fail} fail / ${skipN} skip ──`));
    const gate = opts.gateSeverities ?? ['CRITICAL', 'HIGH'];
    const blockers = rs.filter(r => r.status === 'FAIL' && gate.includes(r.severity));
    if (blockers.length) { console.log(chalk.red(`\n❌ ${blockers.length} blocking failure(s):`)); blockers.forEach(b => console.log(chalk.red(`   • [${b.severity}] ${b.name} — ${b.detail}`))); }
    return fail > 0 ? 1 : 0;
}
