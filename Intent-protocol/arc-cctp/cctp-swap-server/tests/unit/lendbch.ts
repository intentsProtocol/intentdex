/**
 * unit/lendbch — the pure read-layer logic: state decoders and the contract maths, checked against the layouts and
 * live numbers recorded in lendbchdocs/01-research.md. No network. The mainnet read-only test is tests/long/.
 */
import { decodeLoan, decodePrice, decodeBorrowingPeriod, decodeStabilityPool, readLeHex } from '../../src/lendbch/state.js';
import * as math from '../../src/lendbch/math.js';
import { deriveDeployment, MAINNET_V1, reverseHex, lockingBytecodeOf } from '../../src/lendbch/deployment.js';
import { ElectrumNetworkProvider, Network } from 'cashscript';
import { check, finish, suite } from '../lib/report.js';

suite('unit/lendbch');

const SATS = 100_000_000n;

// ── little-endian reader ──
check('readLeHex: little-endian byte order', readLeHex('0b6c0000') === 27659n && readLeHex('ae000000') === 174n && readLeHex('') === 0n);
check('readLeHex: single byte and odd length', readLeHex('ff') === 255n && (() => { try { readLeHex('abc'); return false; } catch { return true; } })());

// ── price commitment: 0x00 | seq(4) | price(4), LE; $276.59 = 27659 cents ──
const priceCommit = '00' + 'ae000000' + '0b6c0000';
const price = decodePrice(priceCommit);
check('decodePrice: sequence and price (US cents)', price.sequence === 174 && price.priceCents === 27659, { evidence: JSON.stringify(price) });
check('decodePrice: guarded migrations may append fields', decodePrice(priceCommit + 'deadbeef').priceCents === 27659);
check('decodePrice: wrong identifier is rejected', (() => { try { decodePrice('01' + 'ae000000' + '0b6c0000'); return false; } catch { return true; } })());

// ── loan commitment: 27 bytes, all LE (overview "Interest Rate State") ──
function buildLoan(f: { borrowed: bigint; redeemed: bigint; status: number; lastPeriod: number; rate: number; next: number; mgr: number; min: number; max: number }): string {
    const le = (v: bigint | number, bytes: number) => { let h = ''; let n = BigInt(v); for (let i = 0; i < bytes; i++) { h += (Number(n & 0xffn)).toString(16).padStart(2, '0'); n >>= 8n; } return h; };
    return '01' + le(f.borrowed, 6) + le(f.redeemed, 6) + le(f.status, 1) + le(f.lastPeriod, 4) + le(f.rate, 2) + le(f.next, 2) + le(f.mgr, 1) + le(f.min, 2) + le(f.max, 2);
}
const loanCommit = buildLoan({ borrowed: 51815200n, redeemed: 0n, status: 2, lastPeriod: 174, rate: 137, next: 150, mgr: 0, min: 0, max: 4438 });
check('decodeLoan: a 27-byte commitment round-trips every field', (() => {
    const s = decodeLoan(loanCommit);
    return s.borrowed === 51815200n && s.beingRedeemed === 0n && s.status === 2 && s.lastPeriodInterestPaid === 174
        && s.currentRate === 137 && s.nextRate === 150 && s.interestManager === 0 && s.minRateManager === 0 && s.maxRateManager === 4438;
})(), { evidence: loanCommit });
check('decodeLoan: length and identifier are enforced', (() => {
    try { decodeLoan('01' + '00'); return false; } catch { /* too short */ }
    try { decodeLoan('02' + loanCommit.slice(2)); return false; } catch { return true; }
    return false;
})());

check('decodeBorrowingPeriod: period 174', decodeBorrowingPeriod('ae000000') === 174);
check('decodeStabilityPool: period + staked amounts', (() => {
    const sp = decodeStabilityPool('ae000000' + 'a0c6ea00000000'.slice(0, 12) + '40');  // period 174, totalStaked 6B, remainder
    return sp.period === 174 && sp.totalStakedEpoch >= 0n && sp.remainingStakedEpoch >= 0n;
})());

// ── contract maths: 01-research numbers at $276.59 ──
const P = 27659n;
check('maxBorrowCents: 1 BCH at $276.59 borrows ≈ $251.4 (collateral ×10/11 × price)', (() => {
    const m = math.maxBorrowCents(SATS, P);
    return m > 25100n && m < 25160n;
})(), { evidence: String(math.maxBorrowCents(SATS, P)) });
check('maxBorrowCents sits right at the 110% line', (() => {
    const m = math.maxBorrowCents(SATS, P);
    const ratio = math.collateralRatioPct(SATS, m, P);
    return ratio !== null && ratio >= 110 && ratio <= 111;
})(), { evidence: String(math.collateralRatioPct(SATS, math.maxBorrowCents(SATS, P), P)) });
check('collateralRatioPct: 1 BCH collateral, 100 PUSD debt = 276%', math.collateralRatioPct(SATS, 100_00n, P) === 276);
check('collateralRatioPct: no debt → null', math.collateralRatioPct(SATS, 0n, P) === null);
check('liquidationPriceCents: 100 PUSD debt on 1 BCH liquidates at $110.00', math.liquidationPriceCents(SATS, 100_00n) === 11000n);
check('liquidationPriceCents: no debt/collateral → null', math.liquidationPriceCents(SATS, 0n) === null && math.liquidationPriceCents(0n, 100_00n) === null);

check('protocolBorrowFeeSats: 0.25% of the borrowed BCH value', (() => {
    const fee = math.protocolBorrowFeeSats(25000n, P);                 // ~0.904 BCH borrowed value → ~0.00226 BCH
    const borrowedBch = 25000n * SATS / P;
    return fee === (borrowedBch * 25n) / 10_000n;
})());
// The 0.25% fee only falls under the 1000-sat floor for sub-dollar borrows (never reachable above the 100-PUSD min),
// so exercise the clamp with a tiny synthetic amount; a real 100-PUSD borrow pays ~90k sats, well above the floor.
check('protocolBorrowFeeSats: clamped to the 1000-sat floor for a sub-dollar borrow', math.protocolBorrowFeeSats(1n, P) === 1000n && math.protocolBorrowFeeSats(100_00n, P) > 1000n);
check('frontendFeeSats: 25 bps (D1 default) and zero when off', (() => {
    const borrowedBch = 25000n * SATS / P;
    return math.frontendFeeSats(25000n, P, 25) === (borrowedBch * 25n) / 10_000n && math.frontendFeeSats(25000n, P, 0) === 0n;
})());

// ── interest-rate unit ↔ APR (rate × 365 / 100000); 01-research: min 0, median 137 ≈0.5%, max 4438 ≈16.2% ──
check('rateToAprPct: 137 ≈ 0.50% APR', Math.abs(math.rateToAprPct(137) - 0.5) < 0.01, { evidence: String(math.rateToAprPct(137)) });
check('rateToAprPct: 4438 ≈ 16.2% APR', Math.abs(math.rateToAprPct(4438) - 16.2) < 0.05, { evidence: String(math.rateToAprPct(4438)) });
check('aprPctToRate: round-trips ≈137 for 0.5%', Math.abs(math.aprPctToRate(0.5) - 137) <= 1);
check('median: odd and even lists', math.median([0, 137, 4438]) === 137 && math.median([10, 20, 30, 40]) === 25 && math.median([]) === 0);
check('periodForHeight: floor((height − start) / periodLength)', math.periodForHeight(948406 + 144 * 174 + 5, 948406, 144) === 174);

// ── deployment derivation (offline: provider only supplies the network prefix) ──
const provider = new ElectrumNetworkProvider(Network.MAINNET);
const dep = deriveDeployment(MAINNET_V1, provider);
check('deriveDeployment: loan + enforcer match the live mainnet addresses from 01-research',
    dep.contracts.loan.address === 'bitcoincash:pv8zrfxplp50apvppy5ku5mjp3gqgkp94dvwf82lg0st4ptk5agfyrtpjvf8a'
    && dep.contracts.loanKeyOriginEnforcer.address === 'bitcoincash:pde2hdurtp3fdlk3t6mtgfw6jmwr6p7gvj04wc7fh3vxm3rg47v32t3nqwrqf',
    { evidence: dep.contracts.loan.address });
check('deriveDeployment: p2sh32 locking bytecode is aa20…87', /^aa20[0-9a-f]{64}87$/.test(dep.contracts.loan.lockingBytecode));
check('deriveDeployment: both price variants derived, Guarded listed first', dep.priceVariants.length === 2 && dep.priceVariants[0].name === 'priceContractGuarded');
check('reverseHex / lockingBytecodeOf helpers', reverseHex('0011aa') === 'aa1100' && lockingBytecodeOf(dep.contracts.loan.address) === dep.contracts.loan.lockingBytecode);

process.exitCode = finish();
