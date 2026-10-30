/** POST /transfers/:id/broadcast forwards a user's signed Solana burn. What it will and will not forward. */
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { SOLANA_PROGRAMS } from '../../src/config.js';
import { checkSignedBurn } from '../../src/chainRoutes.js';
import { HttpError } from '../../src/types.js';
import { check, finish, suite } from '../lib/report.js';

suite('unit/chain_routes');

const codeOf = (fn: () => unknown): string => { try { fn(); return 'no error'; } catch (e) { return e instanceof HttpError ? `${e.statusCode} ${e.code}` : `not an HttpError: ${e}`; } };
const CCTP = new PublicKey(SOLANA_PROGRAMS.tokenMessengerMinter);

/** A transaction shaped like the server's burn: paid by the owner, co-signed by the event account, calling CCTP. */
function burnTx(owner: Keypair, event: Keypair, opts: { program?: PublicKey; sign?: Keypair[] } = {}): string {
    const ix = new TransactionInstruction({
        programId: opts.program ?? CCTP, data: Buffer.from([1]),
        keys: [{ pubkey: owner.publicKey, isSigner: true, isWritable: true }, { pubkey: event.publicKey, isSigner: true, isWritable: true }],
    });
    const msg = new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: '11111111111111111111111111111111', instructions: [ix] }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign(opts.sign ?? [owner, event]);
    return Buffer.from(tx.serialize()).toString('base64');
}

const owner = Keypair.generate(), event = Keypair.generate();
const t = { sender: owner.publicKey.toBase58(), eventAccount: event.publicKey.toBase58() };

const ok = checkSignedBurn(t, burnTx(owner, event));
const decoded = VersionedTransaction.deserialize(ok.raw);
check('a signed burn of this transfer is accepted and its signature is the first one', ok.signature.length > 80 && decoded.signatures.length === 2, { severity: 'HIGH' });

check('no transaction → 400 INVALID_SIGNED_TX', codeOf(() => checkSignedBurn(t, undefined)) === '400 INVALID_SIGNED_TX', { severity: 'HIGH' });
check('not a transaction → 400 INVALID_SIGNED_TX', codeOf(() => checkSignedBurn(t, 'aGVsbG8=')) === '400 INVALID_SIGNED_TX', { severity: 'HIGH' });
check('the owner has not signed → 400 INVALID_SIGNED_TX', codeOf(() => checkSignedBurn(t, burnTx(owner, event, { sign: [event] }))) === '400 INVALID_SIGNED_TX', { severity: 'HIGH' });

const other = Keypair.generate();
check('signed by another wallet → 400 TX_MISMATCH', codeOf(() => checkSignedBurn(t, burnTx(other, event))) === '400 TX_MISMATCH', { severity: 'CRITICAL' });
check('not a call to the CCTP program → 400 TX_MISMATCH: the route is not an open relay',
    codeOf(() => checkSignedBurn(t, burnTx(owner, event, { program: SystemProgram.programId }))) === '400 TX_MISMATCH', { severity: 'CRITICAL' });
check('a burn built for another transfer → 400 TX_MISMATCH', codeOf(() => checkSignedBurn(t, burnTx(owner, Keypair.generate()))) === '400 TX_MISMATCH', { severity: 'CRITICAL' });
check('a transfer without an event account (EVM source) → 400 TX_MISMATCH', codeOf(() => checkSignedBurn({ sender: t.sender }, burnTx(owner, event))) === '400 TX_MISMATCH', { severity: 'HIGH' });

process.exit(finish());
