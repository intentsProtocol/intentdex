/**
 * bch_signTransaction — sign a Bitcoin Cash transaction a site built, in the format of the WalletConnect BCH
 * specification (https://github.com/mainnet-pat/wc2-bch-bcr), which Cashonize and Paytaca also accept:
 *
 *   { transaction, sourceOutputs, broadcast?, userPrompt? }
 *
 * `transaction` is the unsigned transaction, as hex or as a libauth transaction object. `sourceOutputs` has one
 * entry per input: the output that input spends. Byte arrays and big integers travel as libauth's "extended
 * JSON" strings (`<Uint8Array: 0x…>`, `<bigint: 123n>`).
 *
 * The wallet fills in two kinds of gaps and leaves every other input as the site sent it:
 *   - an input with an empty unlocking script that spends an output of this account (P2PKH)
 *   - a contract input (`sourceOutput.contract`) whose unlocking script holds a placeholder signature
 *     (65 zero bytes) or a placeholder public key (33 zero bytes)
 *
 * Every signature covers all outputs, and the value and token of the output it spends, so what the summary says
 * this account pays is what the signature commits to, whatever the site claimed about the other inputs.
 *
 * Loaded on demand by the approval screen (it pulls in libauth). No chrome APIs, no storage.
 */

import {
  SigningSerializationFlag, binToHex, cashAddressToLockingBytecode, decodeTransaction, encodeLockingBytecodeP2pkh,
  encodeTransaction, generateSigningSerializationBch, hash160, hash256, hashTransaction, hexToBin,
  lockingBytecodeToCashAddress, secp256k1,
  type Output, type Transaction,
} from '@bitauth/libauth';

export interface SignTxSourceOutput extends Output {
  /** Set by the site for a contract input; `redeemScript` is what a placeholder signature has to cover. */
  contract?: { name: string; redeemScript: Uint8Array };
}

export interface SignTxRequest {
  transaction: Transaction;
  sourceOutputs: SignTxSourceOutput[];
  broadcast: boolean;
  /** The site's own description of the transaction. Shown as the site's words, never as a fact. */
  userPrompt: string;
}

export interface SignTxOutput {
  /** Cashaddr of the output, or '' for a script that has none (OP_RETURN data, a bare script). */
  address: string;
  data: boolean;
  own: boolean;
  satoshis: bigint;
  token?: { category: string; amount: bigint; nft: boolean };
}

export interface SignTxSummary {
  /** Inputs of this account the wallet will sign. */
  ownInputs: number;
  /** Contract inputs in which the wallet will fill a signature or a public key. */
  contractInputs: number;
  /** Satoshis that leave this account: its inputs minus the outputs that return to it. Negative when it gains. */
  netSatoshis: bigint;
  /** All inputs minus all outputs, by the values the site gave. */
  fee: bigint;
  /** Fungible tokens leaving this account, by category. Negative when it gains. */
  tokens: { category: string; amount: bigint }[];
  outputs: SignTxOutput[];
}

const SIG_PLACEHOLDER = Uint8Array.from([0x41, ...new Uint8Array(65)]);
const KEY_PLACEHOLDER = Uint8Array.from([0x21, ...new Uint8Array(33)]);

// ── libauth extended JSON ──

function revive(value: unknown): unknown {
  if (typeof value === 'string') {
    const bytes = /^<Uint8Array: 0x((?:[0-9a-f]{2})*)>$/i.exec(value);
    if (bytes) return hexToBin(bytes[1]);
    const int = /^<bigint: (-?\d+)n>$/.exec(value);
    if (int) return BigInt(int[1]);
    return value;
  }
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]));
  }
  return value;
}

const isBytes = (v: unknown): v is Uint8Array => v instanceof Uint8Array;
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Replaces every `needle` in `source` with `replacement` (same length). Returns how many it replaced. */
function replaceBytes(source: Uint8Array, needle: Uint8Array, replacement: Uint8Array): number {
  let count = 0;
  for (let at = indexOfBytes(source, needle); at !== -1; at = indexOfBytes(source, needle)) {
    source.set(replacement, at);
    count++;
  }
  return count;
}

// ── parsing: everything the site sent is checked here ──

function parseToken(raw: any): Output['token'] | string {
  if (typeof raw.amount !== 'bigint' || raw.amount < 0n) return 'A token amount in the transaction is not valid.';
  if (!isBytes(raw.category) || raw.category.length !== 32) return 'A token category in the transaction is not valid.';
  if (raw.nft === undefined || raw.nft === null) return { amount: raw.amount, category: raw.category };
  if (!['none', 'mutable', 'minting'].includes(raw.nft.capability) || !isBytes(raw.nft.commitment)) return 'An NFT in the transaction is not valid.';
  return { amount: raw.amount, category: raw.category, nft: { capability: raw.nft.capability, commitment: raw.nft.commitment } };
}

/** The request, checked and decoded; or a sentence saying what is wrong with it. */
export function parseSignRequest(params: unknown[] | undefined): SignTxRequest | string {
  const p = revive(params?.[0]) as Record<string, any> | undefined;
  if (!p || typeof p !== 'object') return 'The request has no transaction.';

  let transaction: Transaction;
  try {
    // An object is re-encoded first, so a malformed one fails here and not while signing.
    const bytes = typeof p.transaction === 'string' ? hexToBin(p.transaction) : encodeTransaction(p.transaction);
    const decoded = decodeTransaction(bytes);
    if (typeof decoded === 'string') return 'The transaction cannot be read.';
    transaction = decoded;
  } catch {
    return 'The transaction cannot be read.';
  }
  if (!transaction.inputs.length || !transaction.outputs.length) return 'The transaction has no inputs or no outputs.';

  if (!Array.isArray(p.sourceOutputs) || p.sourceOutputs.length !== transaction.inputs.length) {
    return 'The request must describe the output each input spends (sourceOutputs).';
  }
  const sourceOutputs: SignTxSourceOutput[] = [];
  for (const [i, raw] of (p.sourceOutputs as any[]).entries()) {
    if (!raw || typeof raw !== 'object' || !isBytes(raw.lockingBytecode)) return `Source output ${i} has no locking script.`;
    if (typeof raw.valueSatoshis !== 'bigint' || raw.valueSatoshis < 0n) return `Source output ${i} has no valid amount.`;
    const input = transaction.inputs[i];
    if (isBytes(raw.outpointTransactionHash) && (!sameBytes(raw.outpointTransactionHash, input.outpointTransactionHash) || raw.outpointIndex !== input.outpointIndex)) {
      return `Source output ${i} does not belong to input ${i} of the transaction.`;
    }
    const source: SignTxSourceOutput = { lockingBytecode: raw.lockingBytecode, valueSatoshis: raw.valueSatoshis };
    if (raw.token) {
      const token = parseToken(raw.token);
      if (typeof token === 'string') return token;
      source.token = token;
    }
    if (raw.contract?.artifact?.contractName) {
      if (!isBytes(raw.contract.redeemScript)) return `Contract input ${i} does not include its redeem script.`;
      source.contract = { name: String(raw.contract.artifact.contractName), redeemScript: raw.contract.redeemScript };
    }
    sourceOutputs.push(source);
  }

  const paid = transaction.outputs.reduce((sum, o) => sum + o.valueSatoshis, 0n);
  const funded = sourceOutputs.reduce((sum, o) => sum + o.valueSatoshis, 0n);
  if (funded < paid) return 'The inputs of the transaction do not cover its outputs.';

  return {
    transaction, sourceOutputs,
    broadcast: p.broadcast === true,
    userPrompt: typeof p.userPrompt === 'string' ? p.userPrompt.slice(0, 200) : '',
  };
}

// ── what the transaction does to this account ──

function lockingOfAddress(address: string): Uint8Array {
  const result = cashAddressToLockingBytecode(address);
  if (typeof result === 'string') throw new Error(result);
  return result.bytecode;
}

const isOwnInput = (request: SignTxRequest, index: number, ownLocking: Uint8Array) =>
  !request.sourceOutputs[index].contract
  && request.transaction.inputs[index].unlockingBytecode.length === 0
  && sameBytes(request.sourceOutputs[index].lockingBytecode, ownLocking);

const hasPlaceholder = (request: SignTxRequest, index: number) =>
  !!request.sourceOutputs[index].contract
  && (indexOfBytes(request.transaction.inputs[index].unlockingBytecode, SIG_PLACEHOLDER) !== -1
    || indexOfBytes(request.transaction.inputs[index].unlockingBytecode, KEY_PLACEHOLDER) !== -1);

/** `address` is the account's cashaddr; its prefix is the one the output addresses are shown with. */
export function summarizeSignRequest(request: SignTxRequest, address: string): SignTxSummary {
  const ownLocking = lockingOfAddress(address);
  const prefix = address.slice(0, address.indexOf(':')) as 'bitcoincash' | 'bchtest';
  const { transaction, sourceOutputs } = request;

  let ownInputs = 0, contractInputs = 0, netSatoshis = 0n;
  const tokens = new Map<string, bigint>();
  const moveToken = (token: Output['token'], sign: 1n | -1n) => {
    if (!token || token.amount === 0n) return;
    const category = binToHex(token.category);
    tokens.set(category, (tokens.get(category) ?? 0n) + sign * token.amount);
  };

  for (const [i, source] of sourceOutputs.entries()) {
    if (isOwnInput(request, i, ownLocking)) {
      ownInputs++;
      netSatoshis += source.valueSatoshis;
      moveToken(source.token, 1n);
    } else if (hasPlaceholder(request, i)) {
      contractInputs++;
    }
  }

  const outputs: SignTxOutput[] = transaction.outputs.map(output => {
    const own = sameBytes(output.lockingBytecode, ownLocking);
    if (own) {
      netSatoshis -= output.valueSatoshis;
      moveToken(output.token, -1n);
    }
    const encoded = lockingBytecodeToCashAddress({ bytecode: output.lockingBytecode, prefix, tokenSupport: !!output.token });
    return {
      address: typeof encoded === 'string' ? '' : encoded.address,
      data: output.lockingBytecode[0] === 0x6a,
      own,
      satoshis: output.valueSatoshis,
      token: output.token && { category: binToHex(output.token.category), amount: output.token.amount, nft: !!output.token.nft },
    };
  });

  const fee = sourceOutputs.reduce((sum, o) => sum + o.valueSatoshis, 0n) - transaction.outputs.reduce((sum, o) => sum + o.valueSatoshis, 0n);
  return {
    ownInputs, contractInputs, netSatoshis, fee, outputs,
    tokens: [...tokens].filter(([, amount]) => amount !== 0n).map(([category, amount]) => ({ category, amount })),
  };
}

// ── signing ──

/** Signs what is this account's to sign. Throws when there is nothing. */
export function signTransaction(request: SignTxRequest, privateKey: Uint8Array): { bytes: Uint8Array; hex: string; txid: string } {
  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof publicKey === 'string') throw new Error(publicKey);
  const ownLocking = encodeLockingBytecodeP2pkh(hash160(publicKey));

  // The signatures are made over the transaction as the site sent it, then written into a copy.
  const { sourceOutputs } = request;
  const unsigned = request.transaction;
  const transaction: Transaction = { ...unsigned, inputs: unsigned.inputs.map(input => ({ ...input, unlockingBytecode: input.unlockingBytecode.slice() })) };

  const signature = (inputIndex: number, coveredBytecode: Uint8Array, flags: number): Uint8Array => {
    const preimage = generateSigningSerializationBch(
      { inputIndex, sourceOutputs, transaction: unsigned },
      { coveredBytecode, signingSerializationType: Uint8Array.of(flags) },
    );
    const schnorr = secp256k1.signMessageHashSchnorr(privateKey, hash256(preimage));
    if (typeof schnorr === 'string') throw new Error(schnorr);
    return Uint8Array.from([...schnorr, flags]);
  };

  let signed = 0;
  for (const [i, input] of transaction.inputs.entries()) {
    const source = sourceOutputs[i];
    if (isOwnInput(request, i, ownLocking)) {
      const flags = SigningSerializationFlag.allOutputs | SigningSerializationFlag.forkId;
      input.unlockingBytecode = Uint8Array.from([0x41, ...signature(i, source.lockingBytecode, flags), 0x21, ...publicKey]);
      signed++;
    } else if (source.contract) {
      if (indexOfBytes(input.unlockingBytecode, SIG_PLACEHOLDER) !== -1) {
        // As CashScript's SignatureTemplate does: all outputs, and every input's source output.
        const flags = SigningSerializationFlag.allOutputs | SigningSerializationFlag.utxos | SigningSerializationFlag.forkId;
        signed += replaceBytes(input.unlockingBytecode, SIG_PLACEHOLDER, Uint8Array.from([0x41, ...signature(i, source.contract.redeemScript, flags)]));
      }
      signed += replaceBytes(input.unlockingBytecode, KEY_PLACEHOLDER, Uint8Array.from([0x21, ...publicKey]));
    }
  }
  if (!signed) throw new Error('Nothing in this transaction is for this account to sign.');

  const bytes = encodeTransaction(transaction);
  return { bytes, hex: binToHex(bytes), txid: hashTransaction(bytes) };
}
