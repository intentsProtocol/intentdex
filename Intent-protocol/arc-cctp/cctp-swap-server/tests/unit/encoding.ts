import { Keypair } from '@solana/web3.js';
import {
    bytes32ToEvm, bytes32ToSolana, evmToBytes32, formatUsdc, parseBurnBody, parseMessage, parseUsdc, solanaToBytes32,
} from '../../src/cctp/encoding.js';
import { buildMessage } from '../lib/fixtures.js';
import { check, finish, suite } from '../lib/report.js';

suite('unit/encoding');

const addr = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const b = evmToBytes32(addr);
check('evmToBytes32 left-pads 12 zero bytes', b === '0x000000000000000000000000036cbd53842c5426634e7929541ec2318f3dcf7e', { severity: 'HIGH', detail: b });
check('bytes32ToEvm round-trips', bytes32ToEvm(b) === addr.toLowerCase(), { severity: 'HIGH' });

const pk = Keypair.generate().publicKey.toBase58();
check('solana bytes32 round-trips', bytes32ToSolana(solanaToBytes32(pk)) === pk, { severity: 'HIGH' });

const msg = buildMessage({
    sourceDomain: 6, destinationDomain: 26, nonce: '0x' + 'ab'.repeat(32),
    burnToken: evmToBytes32(addr), mintRecipient: evmToBytes32('0x000000000000000000000000000000000000dEaD'),
    amount: 1_234_567n, messageSender: evmToBytes32('0x1111111111111111111111111111111111111111'),
    maxFee: 150n, feeExecuted: 124n, minFinalityThreshold: 1000, finalityThresholdExecuted: 1000,
});
const m = parseMessage(msg);
check('message header: domains', m.sourceDomain === 6 && m.destinationDomain === 26, { severity: 'HIGH' });
check('message header: nonce at byte 12', m.nonce === '0x' + 'ab'.repeat(32), { severity: 'HIGH' });
check('message header: finality fields', m.minFinalityThreshold === 1000 && m.finalityThresholdExecuted === 1000);
check('message header: destinationCaller zero', /^0x0{64}$/.test(m.destinationCaller), { severity: 'HIGH' });
const body = parseBurnBody(m.body);
check('burn body: amount', body.amount === 1_234_567n, { severity: 'HIGH' });
check('burn body: mintRecipient', bytes32ToEvm(body.mintRecipient) === '0x000000000000000000000000000000000000dead', { severity: 'HIGH' });
check('burn body: maxFee / feeExecuted', body.maxFee === 150n && body.feeExecuted === 124n);
check('burn body: burnToken', bytes32ToEvm(body.burnToken) === addr.toLowerCase());

check('parseUsdc("1.5") = 1500000', parseUsdc('1.5') === 1_500_000n, { severity: 'HIGH' });
check('parseUsdc("0.000001") = 1', parseUsdc('0.000001') === 1n);
check('parseUsdc(12) = 12000000', parseUsdc(12) === 12_000_000n);
let threw = false; try { parseUsdc('1.0000001'); } catch { threw = true; }
check('parseUsdc rejects 7 decimals', threw, { severity: 'HIGH' });
threw = false; try { parseUsdc('-1'); } catch { threw = true; }
check('parseUsdc rejects negatives', threw, { severity: 'HIGH' });
check('formatUsdc(1500000) = "1.5"', formatUsdc(1_500_000n) === '1.5');
check('formatUsdc(1000000) = "1"', formatUsdc('1000000') === '1');

process.exit(finish());
