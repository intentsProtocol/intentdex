/**
 * whitelist_sanity.ts — per-network fill whitelist resolution. No network calls.
 *
 * The defect this guards against: `buildInventoryConfig()` used to read
 * `FILL_TOKEN_WHITELIST` with no network argument, so ONE list gated both chains.
 * The deployed .env held two chipnet categories, which means a mainnet relayer
 * would have matched nothing and filled ZERO orders. Scenario 2 asserts that
 * directly.
 *
 * Sources are injected rather than set via process.env: `config.ts` snapshots the
 * environment at import time and dotenv repopulates it from the real `.env`, so
 * env mutation in tests silently does nothing.
 *
 * Run:  npx tsx test/whitelist_sanity.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    buildInventoryConfig, isWhitelisted, isInventoryToken, resetLegacyWarning,
} from '../src/bot/InventoryConfig.js';
import type { WhitelistSources } from '../src/bot/InventoryConfig.js';

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
}
const section = (s: string) => console.log(`\n── ${s} ──`);

const CHIP_A = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';
const CHIP_B = '8852fd9f552c0387d81534c3b874efbd59124cfab50bc2b4b170e47f07b684bc';
const CHIP_C = 'cccc'.repeat(16);
const MAIN_A = 'aa11'.repeat(16);
const MAIN_B = 'bb22'.repeat(16);

const POOLED_CHIPNET = [CHIP_A, CHIP_C, 'dddd'.repeat(16)];
const POOLED_MAINNET = [MAIN_A, MAIN_B];

/** Only the fields a scenario cares about; everything else stays unset. */
const src = (s: Partial<WhitelistSources>): WhitelistSources => s;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-sanity-'));
const writeCfg = (name: string, body: unknown) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, JSON.stringify(body));
    return p;
};

console.log('=== WHITELIST SANITY (per-network resolution) ===');

// ── 1. Default: derive from pools ────────────────────────────────────────────
section('1. nothing configured → derive from live pools');
{
    const cfg = buildInventoryConfig('chipnet', POOLED_CHIPNET, [], src({}));
    check('source is "derived"', cfg.source === 'derived', `got '${cfg.source}'`);
    check('admits every pooled token', POOLED_CHIPNET.every(t => isWhitelisted(t, cfg)));
    check('rejects an unpooled token', !isWhitelisted('ffff'.repeat(16), cfg));
}

// ── 2. THE MAINNET BLOCKER ───────────────────────────────────────────────────
section('2. legacy network-blind list must not starve the other network');
{
    resetLegacyWarning();
    // Operator runs NETWORK=chipnet with a chipnet list, as the real .env did.
    const s = src({ envListLegacy: `${CHIP_A},${CHIP_B}`, defaultNetwork: 'chipnet' });

    const chip = buildInventoryConfig('chipnet', POOLED_CHIPNET, [], s);
    check('chipnet still honours the legacy list', isWhitelisted(CHIP_A, chip));
    check('legacy source is flagged', chip.source === 'env-legacy', `got '${chip.source}'`);

    // Pre-fix this same list also gated mainnet, so mainnet saw ONLY chipnet ids,
    // matched nothing, and filled zero orders. It must now fall through instead.
    const main = buildInventoryConfig('mainnet', POOLED_MAINNET, [], s);
    check('mainnet does NOT inherit the chipnet list', !isWhitelisted(CHIP_A, main));
    check('mainnet falls through to derivation', main.source === 'derived', `got '${main.source}'`);
    check('mainnet can actually fill its own tokens',
        POOLED_MAINNET.every(t => isWhitelisted(t, main)));
}

section('3. per-network env vars scope correctly');
{
    const s = src({ envListChipnet: CHIP_A, envListMainnet: MAIN_A });
    const chip = buildInventoryConfig('chipnet', POOLED_CHIPNET, [], s);
    const main = buildInventoryConfig('mainnet', POOLED_MAINNET, [], s);
    check('chipnet admits its own token', isWhitelisted(CHIP_A, chip));
    check('chipnet rejects the mainnet token', !isWhitelisted(MAIN_A, chip));
    check('mainnet admits its own token', isWhitelisted(MAIN_A, main));
    check('mainnet rejects the chipnet token', !isWhitelisted(CHIP_A, main));
    check('source is "env-network"', chip.source === 'env-network' && main.source === 'env-network');
}

section('4. per-network JSON config file (allow / deny)');
{
    const p = writeCfg('chipnet.json', { allow: [CHIP_A, CHIP_B], deny: [CHIP_B] });
    const cfg = buildInventoryConfig('chipnet', POOLED_CHIPNET, [], src({ configFileChipnet: p }));
    check('source is "file"', cfg.source === 'file', `got '${cfg.source}'`);
    check('allow admits listed token', isWhitelisted(CHIP_A, cfg));
    check('deny beats allow', !isWhitelisted(CHIP_B, cfg));
    check('explicit allow-list overrides derivation', !isWhitelisted(CHIP_C, cfg));
}

section('5. file takes precedence over both env forms');
{
    const p = writeCfg('prec.json', { allow: [MAIN_A] });
    const cfg = buildInventoryConfig('mainnet', POOLED_MAINNET, [], src({
        configFileMainnet: p, envListMainnet: MAIN_B,
        envListLegacy: CHIP_A, defaultNetwork: 'mainnet',
    }));
    check('file wins', cfg.source === 'file' && isWhitelisted(MAIN_A, cfg));
    check('env-network ignored when file present', !isWhitelisted(MAIN_B, cfg));
    check('legacy env ignored when file present', !isWhitelisted(CHIP_A, cfg));
}

section('6. deny applies even under derivation');
{
    const p = writeCfg('deny-only.json', { deny: [CHIP_C] });
    const cfg = buildInventoryConfig('chipnet', POOLED_CHIPNET, [], src({ configFileChipnet: p }));
    check('deny-only file still derives', cfg.source === 'derived', `got '${cfg.source}'`);
    check('derived token admitted', isWhitelisted(CHIP_A, cfg));
    check('denied token rejected despite having a pool', !isWhitelisted(CHIP_C, cfg));
}

section('7. derivation cannot admit a poolless token');
{
    // CHIP_B has no pool on chipnet — it sat hand-whitelisted for months while
    // being permanently unfillable. Derivation makes that state impossible.
    const cfg = buildInventoryConfig('chipnet', POOLED_CHIPNET, [], src({}));
    check('poolless CHIP_B rejected under derivation', !isWhitelisted(CHIP_B, cfg));
}

section('8. cold pool cache falls back to unrestricted, not blocked');
{
    const cfg = buildInventoryConfig('chipnet', [], [], src({}));
    check('source is "unrestricted"', cfg.source === 'unrestricted', `got '${cfg.source}'`);
    check('does not block every fill during startup', isWhitelisted(CHIP_A, cfg));
}

section('9. 0x-prefixed ids normalise');
{
    const cfg = buildInventoryConfig('chipnet', POOLED_CHIPNET, [], src({ envListChipnet: `0x${CHIP_A}` }));
    check('0x-prefixed entry matches bare id', isWhitelisted(CHIP_A, cfg));
    check('bare entry matches 0x-prefixed query', isWhitelisted(`0x${CHIP_A}`, cfg));
}

section('10. inventory tokens seed from holdings, env overrides');
{
    const held = buildInventoryConfig('chipnet', POOLED_CHIPNET, [CHIP_A], src({}));
    check('held token is an inventory token', isInventoryToken(CHIP_A, held));
    check('unheld token is not', !isInventoryToken(CHIP_C, held));

    const forced = buildInventoryConfig('chipnet', POOLED_CHIPNET, [CHIP_A], src({ inventoryTokenIds: CHIP_C }));
    check('env override replaces holdings', isInventoryToken(CHIP_C, forced) && !isInventoryToken(CHIP_A, forced));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${'═'.repeat(60)}`);
console.log(`  ${failed === 0 ? `ALL ${passed} CHECKS PASSED ✅` : `${failed} FAILED ❌ (${passed} passed)`}`);
console.log('═'.repeat(60));
process.exit(failed === 0 ? 0 : 1);
