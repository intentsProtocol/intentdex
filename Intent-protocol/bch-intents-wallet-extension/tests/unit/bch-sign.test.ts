import { describe, expect, it } from 'vitest';
import {
  binToHex, createVirtualMachineBch, decodeTransaction, encodeCashAddress, encodeLockingBytecodeP2pkh, encodeTransaction,
  hash160, hash256, hexToBin, secp256k1, stringify,
  type Output, type Transaction,
} from '@bitauth/libauth';
import { parseSignRequest, signTransaction, summarizeSignRequest, type SignTxRequest } from '@/lib/bch-sign';

const privateKey = hexToBin('11'.repeat(32));
const publicKey = secp256k1.derivePublicKeyCompressed(privateKey) as Uint8Array;
const pkh = hash160(publicKey);
const ownLocking = encodeLockingBytecodeP2pkh(pkh);
const address = encodeCashAddress({ prefix: 'bchtest', type: 'p2pkh', payload: pkh }).address;
const otherLocking = encodeLockingBytecodeP2pkh(hash160(secp256k1.derivePublicKeyCompressed(hexToBin('22'.repeat(32))) as Uint8Array));
const otherAddress = encodeCashAddress({ prefix: 'bchtest', type: 'p2pkh', payload: otherLocking.slice(3, 23) }).address;
const category = hexToBin('ab'.repeat(31) + 'cd');

const input = (n: number, unlockingBytecode = new Uint8Array(0)) => ({
  outpointIndex: n, outpointTransactionHash: hexToBin(`${n}${n}`.repeat(32)), sequenceNumber: 0xfffffffe, unlockingBytecode,
});

/** What a site sends: libauth's extended JSON, through JSON as it travels to the wallet. */
function wire(transaction: Transaction | string, sourceOutputs: (Output & Record<string, unknown>)[], extra: Record<string, unknown> = {}) {
  const withOutpoints = sourceOutputs.map((o, i) => ({ ...(typeof transaction === 'string' ? {} : transaction.inputs[i]), ...o }));
  return [JSON.parse(stringify({ transaction, sourceOutputs: withOutpoints, ...extra }))];
}

function parsed(params: unknown[]): SignTxRequest {
  const request = parseSignRequest(params);
  if (typeof request === 'string') throw new Error(request);
  return request;
}

/** Runs the signed transaction through the Bitcoin Cash virtual machine. */
function verify(request: SignTxRequest, bytes: Uint8Array): true | string {
  const transaction = decodeTransaction(bytes);
  if (typeof transaction === 'string') return transaction;
  return createVirtualMachineBch(false).verify({ sourceOutputs: request.sourceOutputs, transaction });
}

describe('bch_signTransaction', () => {
  const payment: Transaction = {
    version: 2, locktime: 0,
    inputs: [input(1), input(2)],
    outputs: [
      { lockingBytecode: otherLocking, valueSatoshis: 60_000n },
      { lockingBytecode: ownLocking, valueSatoshis: 39_000n },
    ],
  };
  const paymentSources: Output[] = [
    { lockingBytecode: ownLocking, valueSatoshis: 50_000n },
    { lockingBytecode: ownLocking, valueSatoshis: 50_000n },
  ];

  it('signs the inputs of this account, and the network would accept the result', () => {
    const request = parsed(wire(payment, paymentSources, { broadcast: true, userPrompt: 'Pay the merchant' }));
    expect(request.broadcast).toBe(true);
    expect(request.userPrompt).toBe('Pay the merchant');

    const signed = signTransaction(request, privateKey);
    expect(verify(request, signed.bytes)).toBe(true);
    expect(signed.hex).toBe(binToHex(signed.bytes));
    expect(signed.txid).toBe(binToHex(hash256(signed.bytes).reverse()));
  });

  it('reads the transaction as hex too', () => {
    const request = parsed(wire(binToHex(encodeTransaction(payment)), paymentSources));
    expect(request.broadcast).toBe(false);
    expect(verify(request, signTransaction(request, privateKey).bytes)).toBe(true);
  });

  it('says what leaves the account: its inputs, less what comes back', () => {
    const summary = summarizeSignRequest(parsed(wire(payment, paymentSources)), address);
    expect(summary.ownInputs).toBe(2);
    expect(summary.contractInputs).toBe(0);
    expect(summary.netSatoshis).toBe(61_000n);
    expect(summary.fee).toBe(1_000n);
    expect(summary.outputs.map(o => [o.address, o.own, o.satoshis])).toEqual([[otherAddress, false, 60_000n], [address, true, 39_000n]]);
  });

  it('signs a CashToken input and counts the tokens that leave', () => {
    const tx: Transaction = {
      version: 2, locktime: 0,
      inputs: [input(1), input(2)],
      outputs: [
        { lockingBytecode: otherLocking, valueSatoshis: 1_000n, token: { category, amount: 25n } },
        { lockingBytecode: ownLocking, valueSatoshis: 1_000n, token: { category, amount: 75n } },
        { lockingBytecode: ownLocking, valueSatoshis: 8_000n },
      ],
    };
    const sources: Output[] = [
      { lockingBytecode: ownLocking, valueSatoshis: 1_000n, token: { category, amount: 100n } },
      { lockingBytecode: ownLocking, valueSatoshis: 10_000n },
    ];
    const request = parsed(wire(tx, sources));
    const summary = summarizeSignRequest(request, address);
    expect(summary.tokens).toEqual([{ category: binToHex(category), amount: 25n }]);
    expect(summary.netSatoshis).toBe(2_000n);
    expect(summary.outputs[0].token).toEqual({ category: binToHex(category), amount: 25n, nft: false });
    expect(summary.outputs[0].address.startsWith('bchtest:z')).toBe(true);
    expect(verify(request, signTransaction(request, privateKey).bytes)).toBe(true);
  });

  it('fills the placeholder signature and public key of a contract input, and leaves other inputs alone', () => {
    // A contract that pays out to whoever holds the key: P2PKH wrapped in P2SH32.
    const redeemScript = ownLocking;
    const contractLocking = Uint8Array.from([0xaa, 0x20, ...hash256(redeemScript), 0x87]);
    const placeholders = Uint8Array.from([0x41, ...new Uint8Array(65), 0x21, ...new Uint8Array(33), redeemScript.length, ...redeemScript]);
    const tx: Transaction = {
      version: 2, locktime: 0,
      inputs: [input(1, placeholders), input(2)],
      outputs: [{ lockingBytecode: otherLocking, valueSatoshis: 108_000n }],
    };
    const sources = [
      { lockingBytecode: contractLocking, valueSatoshis: 100_000n, contract: { abiFunction: { name: 'spend', inputs: [] }, redeemScript, artifact: { contractName: 'Vault' } } },
      { lockingBytecode: ownLocking, valueSatoshis: 10_000n },
    ];
    const request = parsed(wire(tx, sources));
    const summary = summarizeSignRequest(request, address);
    expect(summary.contractInputs).toBe(1);
    expect(summary.ownInputs).toBe(1);
    // The contract's coins are not this account's: only its own input counts as leaving it.
    expect(summary.netSatoshis).toBe(10_000n);
    expect(summary.fee).toBe(2_000n);

    const signed = signTransaction(request, privateKey);
    expect(verify(request, signed.bytes)).toBe(true);
    // The request is not changed by signing it.
    expect(request.transaction.inputs[1].unlockingBytecode.length).toBe(0);
  });

  it('does not sign for another account', () => {
    const request = parsed(wire(payment, paymentSources.map(o => ({ ...o, lockingBytecode: otherLocking }))));
    expect(summarizeSignRequest(request, address).ownInputs).toBe(0);
    expect(() => signTransaction(request, privateKey)).toThrow(/Nothing in this transaction/);
  });

  it('does not touch an input the site already unlocked', () => {
    const unlocked = Uint8Array.from([0x51]);
    const tx: Transaction = { ...payment, inputs: [input(1, unlocked), input(2)] };
    const request = parsed(wire(tx, paymentSources));
    expect(summarizeSignRequest(request, address).ownInputs).toBe(1);
    const signed = decodeTransaction(signTransaction(request, privateKey).bytes) as Transaction;
    expect(signed.inputs[0].unlockingBytecode).toEqual(unlocked);
    expect(signed.inputs[1].unlockingBytecode.length).toBe(100);
  });

  it('refuses a request that does not hold together', () => {
    expect(parseSignRequest(undefined)).toMatch(/no transaction/);
    expect(parseSignRequest([{ transaction: 'zz', sourceOutputs: [] }])).toMatch(/cannot be read/);
    expect(parseSignRequest(wire(payment, paymentSources.slice(0, 1)))).toMatch(/sourceOutputs/);
    // The amounts as plain numbers, not as extended JSON.
    expect(parseSignRequest([{ transaction: binToHex(encodeTransaction(payment)), sourceOutputs: [{ lockingBytecode: `<Uint8Array: 0x${binToHex(ownLocking)}>`, valueSatoshis: 50000 }, {}] }])).toMatch(/Source output 0 has no valid amount/);
    // Source outputs in the wrong order.
    const swapped = wire(payment, paymentSources) as any[];
    swapped[0].sourceOutputs.reverse();
    expect(parseSignRequest(swapped)).toMatch(/does not belong to input 0/);
    // Outputs worth more than the inputs.
    expect(parseSignRequest(wire(payment, paymentSources.map(o => ({ ...o, valueSatoshis: 1_000n }))))).toMatch(/do not cover/);
  });
});
