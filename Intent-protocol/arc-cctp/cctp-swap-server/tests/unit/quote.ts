import { getChain } from '../../src/config.js';
import { chooseSpeed, computeQuote, feeForBps, type QuoteInputs } from '../../src/cctp/quote.js';
import { HttpError } from '../../src/types.js';
import { check, finish, suite } from '../lib/report.js';

suite('unit/quote');

const base = getChain('base-sepolia')!;
const arb = getChain('arb-sepolia')!;
const arc = getChain('arc-testnet')!;
const sol = getChain('solana-devnet')!;
const FEES = [{ finalityThreshold: 1000, minimumFee: 1.3 }, { finalityThreshold: 2000, minimumFee: 0 }];

const q = (over: Partial<QuoteInputs>) => computeQuote({
    src: base, dst: arb, amount: 1_000_000n, pref: 'auto', fees: FEES, fastAllowanceUsdc: 1e9, onchainMinFee: 0n,
    feeBufferPct: 20, standardFastEnoughSec: 60, mintOverheadSec: 10, minTransfer: 1_000_000n, maxTransfer: 100_000_000n,
    ...over,
});
const status = (fn: () => unknown) => { try { fn(); return 0; } catch (e) { return e instanceof HttpError ? e.statusCode : -1; } };

check('feeForBps: 1 bp of 1 USDC = 100 units', feeForBps(1_000_000n, 1) === 100n, { severity: 'HIGH' });
check('feeForBps: 1.3 bp of 1 USDC = 130 units', feeForBps(1_000_000n, 1.3) === 130n, { severity: 'HIGH' });
check('feeForBps rounds up', feeForBps(1n, 1) === 1n && feeForBps(12_345_678n, 1.3) === 1605n, { severity: 'HIGH', detail: String(feeForBps(12_345_678n, 1.3)) });
check('feeForBps: 0 bps = 0', feeForBps(1_000_000n, 0) === 0n);

const fast = q({});
check('Base→Arb auto picks Fast (slow Standard, allowance ok)', fast.speed === 'fast' && fast.minFinalityThreshold === 1000, { severity: 'HIGH' });
check('Fast fee 1.3 bp, maxFee = fee +20% rounded up', fast.expectedFee === '130' && fast.maxFee === '156', { severity: 'HIGH', detail: `${fast.expectedFee}/${fast.maxFee}` });
check('receive = amount − fee', fast.expectedReceive === '999870', { severity: 'HIGH' });
check('Fast ETA = 8 s + mint overhead', fast.etaSec === 18);

const lowAllowance = q({ fastAllowanceUsdc: 0.5 });
check('auto falls back to Standard when Fast allowance is too low', lowAllowance.speed === 'standard' && lowAllowance.maxFee === '0', { severity: 'HIGH' });
check('slow Standard carries an ETA warning', lowAllowance.warnings.some(w => /minutes/.test(w)));

const fromArc = q({ src: arc, dst: base });
check('Arc source auto → Standard (Arc is not a Fast source)', fromArc.speed === 'standard' && fromArc.etaSec === 11, { severity: 'HIGH' });
check('Arc source warns about USDC gas', fromArc.warnings.some(w => /USDC/.test(w)));
check('explicit fast from Arc → 400', status(() => q({ src: arc, dst: base, pref: 'fast' })) === 400, { severity: 'HIGH' });
check('explicit fast with low allowance → 409', status(() => q({ pref: 'fast', fastAllowanceUsdc: 0.1 })) === 409);

const fromSol = q({ src: sol, dst: arc });
check('Solana source auto → Standard (~25 s is fast enough)', fromSol.speed === 'standard');
const toSol = q({ src: base, dst: sol });
check('Solana destination warns about token account creation', toSol.warnings.some(w => /token account/.test(w)));

const minFee = q({ onchainMinFee: 500n });
check('on-chain min fee floors maxFee and expectedFee', minFee.maxFee === '500' && minFee.expectedFee === '500', { severity: 'HIGH', detail: `${minFee.expectedFee}/${minFee.maxFee}` });

check('same chain → 400', status(() => q({ dst: base })) === 400, { severity: 'HIGH' });
check('below minimum → 400', status(() => q({ amount: 999_999n })) === 400, { severity: 'HIGH' });
check('above maximum → 400', status(() => q({ amount: 100_000_001n })) === 400, { severity: 'HIGH' });
check('missing fee row → 502', status(() => q({ fees: [{ finalityThreshold: 2000, minimumFee: 0 }] })) === 502);
check('maxFee ≥ amount → 400', status(() => q({ amount: 1_000_000n, onchainMinFee: 1_000_000n })) === 400, { severity: 'HIGH' });

check('chooseSpeed: unknown allowance still allows auto Fast', chooseSpeed(base, 'auto', 1_000_000n, null, 60).speed === 'fast');

process.exit(finish());
