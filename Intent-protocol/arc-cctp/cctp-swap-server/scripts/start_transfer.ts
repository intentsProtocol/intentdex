/**
 * start_transfer.ts — create one transfer, sign and send its burn, print {id, recipient, before} and exit without
 * waiting for delivery. Used by the restart test, which stops the server while the mint is in flight.
 *   SRC=solana-devnet DST=eth-sepolia AMOUNT=1 npx tsx scripts/start_transfer.ts
 */
import { startRoute } from './e2e_lib.js';

const s = await startRoute({ n: 0, src: process.env.SRC || 'solana-devnet', dst: process.env.DST || 'eth-sepolia', speed: 'auto', note: '' }, process.env.AMOUNT || '1');
console.log(JSON.stringify({ id: s.id, burnTx: s.burnTx, recipient: s.recipient, before: s.before.toString() }));
process.exit(0);
