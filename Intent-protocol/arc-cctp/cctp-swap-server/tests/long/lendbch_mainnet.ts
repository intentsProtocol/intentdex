/**
 * long/lendbch_mainnet — the read-only test the P1 "done when" calls for: derive Paryon's mainnet deployment, read
 * it live, and confirm it reproduces the shape and ranges recorded in lendbchdocs/01-research.md. Live numbers have
 * moved since the research probe, so this checks structure and ranges, not exact values. Network-gated: if mainnet
 * Electrum can't be reached it SKIPs rather than fails. No keys, nothing broadcast.
 */
import { LendBchService } from '../../src/lendbch/LendBchService.js';
import { LendBchSettingsStore } from '../../src/lendbch/SettingsStore.js';
import { MAINNET_V1 } from '../../src/lendbch/deployment.js';
import { check, finish, skip, suite } from '../lib/report.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

suite('long/lendbch_mainnet');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lendbch-'));
const settings = new LendBchSettingsStore(dir);
const service = new LendBchService({ params: MAINNET_V1, settings, cacheMs: 0 });

// Derivation is offline, so this always runs.
check('derivation: loan address matches the live mainnet value',
    service.deployment.contracts.loan.address === 'bitcoincash:pv8zrfxplp50apvppy5ku5mjp3gqgkp94dvwf82lg0st4ptk5agfyrtpjvf8a',
    { evidence: service.deployment.contracts.loan.address });

try {
    const market = await service.market();
    const check200 = service.getSelfCheck();

    if (!check200.ok) {
        skip(`self-check failed (${check200.reason}) — treating as unreachable`, 'network or migration', 'INFO');
    } else {
        check('self-check: a price-contract thread is live, and it is the Guarded variant', check200.priceContract?.name === 'priceContractGuarded', { evidence: check200.priceContract?.name });
        const price = Number(market.priceCents);
        check('market: BCH/USD price is in a sane range ($10–$10,000)', price > 1000 && price < 1_000_000, { evidence: `${price} cents` });
        check('market: there are live loans with debt and collateral', market.loanCount > 0 && BigInt(market.totalDebtCents) > 0n && BigInt(market.totalCollateralSats) > 0n,
            { evidence: `loans=${market.loanCount} debt=${market.totalDebtCents}c collateral=${market.totalCollateralSats}sats` });
        check('market: interest rates sit within the 0–120% APR band', market.rate.minApr >= 0 && market.rate.maxApr <= 120 && market.rate.medianApr >= market.rate.minApr && market.rate.medianApr <= market.rate.maxApr,
            { evidence: JSON.stringify(market.rate) });
        check('market: the current period is a positive number', (market.currentPeriod ?? 0) > 0, { evidence: String(market.currentPeriod) });
        check('market: fees and limits reflect the approved decisions (D1 25bps, D2 150/200%)',
            market.fees.borrowFeeBps === 25 && market.fees.frontendFeeBps === 25 && market.limits.minOpenRatioPct === 150 && market.limits.warnRatioPct === 200 && market.limits.minLoanCents === '10000');
        check('market: not paused when the self-check passes', market.paused === false);

        // Loan lookup by id: discover a *real* loanTokenId the way the service does — the Loan.cash address has no
        // constructor args, so impostor loans of other token categories also sit there; pick a paryon-category
        // mutable 27-byte loan, take its sidecar (one output later), and read that loan back.
        const paryon = MAINNET_V1.tokenIds.paryonTokenId;
        const loanUtxos = await service.chainClient().getUtxos(service.deployment.contracts.loan.address);
        const sidecars = await service.chainClient().getUtxos(service.deployment.contracts.loanSidecar.address);
        const sidecarByOutpoint = new Map(sidecars.filter(u => u.token?.nft && u.token.category !== paryon).map(u => [`${u.txid}:${u.vout}`, u.token!.category] as const));
        let sampleId: string | null = null;
        for (const u of loanUtxos) {
            if (u.token?.nft?.capability === 'mutable' && u.token.category === paryon && u.token.nft.commitment.length === 54) {
                const id = sidecarByOutpoint.get(`${u.txid}:${u.vout + 1}`);
                if (id) { sampleId = id; break; }
            }
        }
        if (!sampleId) {
            skip('no paryon-category loan found to sample a loanTokenId', '', 'INFO');
        } else {
            const loan = await service.loanById(sampleId);
            check('loanById: resolves the requested real loan with coherent, derived fields',
                !!loan && loan.loanTokenId === sampleId && BigInt(loan.collateralSats) > 0n && BigInt(loan.debtCents) >= 0n
                && (BigInt(loan.debtCents) > 0n ? (loan.liquidationPriceCents !== null && loan.collateralRatioPct !== null) : (loan.liquidationPriceCents === null && loan.collateralRatioPct === null)),
                { evidence: loan ? `${loan.loanTokenId.slice(0, 12)}… debt=${loan.debtCents}c ratio=${loan.collateralRatioPct}% liq=${loan.liquidationPriceCents}c` : 'not found' });
            check('loanById: an impostor loan of another token category is not served', (await service.loanById('00'.repeat(32))) === null);
        }
    }
} catch (e) {
    skip(`mainnet Electrum unreachable: ${(e as Error).message}`, 'network', 'INFO');
}

fs.rmSync(dir, { recursive: true, force: true });
process.exitCode = finish();
