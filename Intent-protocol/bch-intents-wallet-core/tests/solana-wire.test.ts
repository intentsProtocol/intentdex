import { describe, expect, it } from 'vitest';
import { bytesFromJson, fromBase64, joinSolanaTx, readSolanaMessage, solanaTxFromWdk, splitSolanaTx, toBase64 } from '../src';
// Built with @solana/web3.js: a legacy transaction with two signers (the second signed first, as the bridge's
// burn does) and a v0 transaction with one. See the generator note in tests/fixtures/README.md.
import fx from './fixtures/solana-tx.json';

/** What a Uint8Array looks like after JSON.stringify and JSON.parse. */
const indexed = (bytes: Uint8Array) => JSON.parse(JSON.stringify(bytes)) as unknown;
/** What a Node or Bare Buffer looks like after the same trip. */
const buffered = (bytes: Uint8Array) => ({ type: 'Buffer', data: [...bytes] });

describe('Solana wire format', () => {
  it('reads the signers and the blockhash of a legacy message', () => {
    const { signatures, message } = splitSolanaTx(fromBase64(fx.legacyUnsigned));
    expect(signatures).toHaveLength(2);
    expect(readSolanaMessage(message)).toEqual({ signers: [fx.payer, fx.second], blockhash: fx.blockhash, version: 'legacy' });
  });

  it('reads a v0 message', () => {
    const { signatures, message } = splitSolanaTx(fromBase64(fx.v0Unsigned));
    expect(signatures).toHaveLength(1);
    expect(readSolanaMessage(message)).toEqual({ signers: [fx.payer], blockhash: fx.blockhash, version: 0 });
  });

  it('splitting and joining gives the same bytes back', () => {
    for (const tx of [fx.legacySigned, fx.v0Signed]) {
      const { signatures, message } = splitSolanaTx(fromBase64(tx));
      expect(toBase64(joinSolanaTx(signatures, message))).toBe(tx);
    }
  });

  it('rebuilds what web3.js serializes from a WDK result, whatever order the signatures come in', () => {
    const { message } = splitSolanaTx(fromBase64(fx.legacyUnsigned));
    const signed = solanaTxFromWdk({
      messageBytes: indexed(message),
      // The second signer listed first: slots are filled by address, not by position in the map.
      signatures: { [fx.second]: buffered(fromBase64(fx.secondSigLegacy)), [fx.payer]: [...fromBase64(fx.payerSigLegacy)] },
    });
    expect(toBase64(signed.raw)).toBe(fx.legacySigned);
    expect(signed.signature).toBe(fx.legacySig);
    expect(signed.blockhash).toBe(fx.blockhash);
  });

  it('rebuilds a v0 transaction', () => {
    const { message } = splitSolanaTx(fromBase64(fx.v0Unsigned));
    const signed = solanaTxFromWdk({ messageBytes: buffered(message), signatures: { [fx.payer]: indexed(fromBase64(fx.payerSigV0)) } });
    expect(toBase64(signed.raw)).toBe(fx.v0Signed);
  });

  it('refuses a transaction that is still missing a signature', () => {
    const { message } = splitSolanaTx(fromBase64(fx.legacyUnsigned));
    expect(() => solanaTxFromWdk({ messageBytes: indexed(message), signatures: { [fx.payer]: indexed(fromBase64(fx.payerSigLegacy)), [fx.second]: null } })).toThrow(/missing a signature/);
    expect(() => solanaTxFromWdk({ messageBytes: indexed(message), signatures: { [fx.payer]: indexed(new Uint8Array(64)), [fx.second]: indexed(fromBase64(fx.secondSigLegacy)) } })).toThrow(/missing a signature/);
    expect(() => solanaTxFromWdk(null)).toThrow(/did not return/);
  });

  it('takes bytes in every shape JSON gives them', () => {
    const bytes = Uint8Array.of(0, 1, 254, 255);
    for (const shape of [indexed(bytes), buffered(bytes), [...bytes], toBase64(bytes), bytes]) expect([...bytesFromJson(shape)]).toEqual([0, 1, 254, 255]);
    expect(() => bytesFromJson({ a: 1 })).toThrow();
    expect(() => bytesFromJson(7)).toThrow();
  });
});
