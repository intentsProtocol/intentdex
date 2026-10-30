import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TransferStore } from '../../src/store/TransferStore.js';
import { sampleTransfer } from '../lib/fixtures.js';
import { check, finish, suite } from '../lib/report.js';

suite('unit/store');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctp-store-'));
const s1 = new TransferStore(dir);
const a = s1.create(sampleTransfer({ status: 'BURN_SUBMITTED', burnTxHash: '0xABC' }));
const b = s1.create(sampleTransfer({ status: 'COMPLETED' }));
s1.update(a.id, { status: 'ATTESTED', nonce: '0x01' });

const s2 = new TransferStore(dir);
check('reload restores every transfer', s2.get(a.id)?.status === 'ATTESTED' && s2.get(b.id)?.status === 'COMPLETED', { severity: 'CRITICAL' });
check('update saved immediately (not only on create)', s2.get(a.id)?.nonce === '0x01', { severity: 'CRITICAL' });
check('no temp file left behind', !fs.existsSync(path.join(dir, 'transfers.json.tmp')), { severity: 'HIGH' });
check('active() excludes terminal transfers', s2.active().map(t => t.id).join() === a.id, { severity: 'HIGH' });
check('findByBurn is case-insensitive', s2.findByBurn('base-sepolia', '0xabc')?.id === a.id);
let dup = false; try { s2.create({ ...s2.get(a.id)! }); } catch { dup = true; }
check('duplicate id rejected', dup);
const copy = s2.get(a.id)!; copy.status = 'FAILED';
check('get() returns a copy (no accidental mutation)', s2.get(a.id)?.status === 'ATTESTED', { severity: 'HIGH' });
check('countByStatus', s2.countByStatus().ATTESTED === 1 && s2.countByStatus().COMPLETED === 1);

fs.rmSync(dir, { recursive: true, force: true });
process.exit(finish());
