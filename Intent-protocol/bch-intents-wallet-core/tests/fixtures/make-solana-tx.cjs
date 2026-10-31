// Builds reference Solana transactions with @solana/web3.js (from the extension's install) for the shared
// package's wire-format test: a legacy transaction with two signers and a v0 transaction with one.
const path = require('path');
const ext = 'C:/Users/Antony Dev/Desktop/Movement/movedapp/ubuntu/Intent-protocol/bch-intents-wallet-extension/node_modules';
const web3 = require(path.join(ext, '@solana/web3.js'));
const { Keypair, SystemProgram, Transaction, TransactionMessage, VersionedTransaction, PublicKey } = web3;

const payer = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
const second = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => 200 - i));
const blockhash = new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 255)).toBase58();
const to = new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) & 255));

// legacy, two signers; `second` has signed already, as the bridge's burn transaction has
const legacy = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash });
legacy.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports: 1234 }));
legacy.add(SystemProgram.transfer({ fromPubkey: second.publicKey, toPubkey: to, lamports: 1 }));
legacy.partialSign(second);
const legacyUnsigned = legacy.serialize({ requireAllSignatures: false }).toString('base64');
const legacyV = VersionedTransaction.deserialize(Buffer.from(legacyUnsigned, 'base64'));
legacyV.sign([payer]);
const legacySigned = Buffer.from(legacyV.serialize()).toString('base64');

// v0, one signer
const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports: 99 })] }).compileToV0Message();
const v0 = new VersionedTransaction(msg);
const v0Unsigned = Buffer.from(v0.serialize()).toString('base64');
v0.sign([payer]);
const v0Signed = Buffer.from(v0.serialize()).toString('base64');

console.log(JSON.stringify({
  payer: payer.publicKey.toBase58(), second: second.publicKey.toBase58(), blockhash,
  legacyUnsigned, legacySigned, legacySig: require(path.join(ext, 'bs58')).default ? require(path.join(ext, 'bs58')).default.encode(legacyV.signatures[0]) : require(path.join(ext, 'bs58')).encode(legacyV.signatures[0]),
  v0Unsigned, v0Signed,
  payerSigLegacy: Buffer.from(legacyV.signatures[0]).toString('base64'),
  secondSigLegacy: Buffer.from(legacyV.signatures[1]).toString('base64'),
  payerSigV0: Buffer.from(v0.signatures[0]).toString('base64'),
}, null, 1));
