// Bitcoin Cash transactions: encoding, the signing serialization, and signing P2PKH inputs.
//
// Signature hash: the BIP143-style algorithm with SIGHASH_FORKID that Bitcoin Cash has used since 2017, extended
// by CHIP-2022-02-CashTokens (the token prefix of the output being spent, and SIGHASH_UTXOS).
// Signatures are ECDSA (RFC 6979, low-S, DER), which every node accepts.

'use strict'

import { secp256k1 } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha2'
import { ripemd160 } from '@noble/hashes/legacy'
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils'

import { AddressType } from './cashaddr.js'

export const SIGHASH_ALL = 0x01
export const SIGHASH_UTXOS = 0x20
export const SIGHASH_FORKID = 0x40

/** The smallest output a node relays, in satoshis, for a P2PKH output. */
export const DUST_LIMIT = 546n
/** What a token output carries when the sender does not say otherwise. */
export const TOKEN_OUTPUT_VALUE = 1000n

const PREFIX_TOKEN = 0xef
const HAS_AMOUNT = 0x10
const HAS_NFT = 0x20
const HAS_COMMITMENT_LENGTH = 0x40
const NFT_CAPABILITIES = ['none', 'mutable', 'minting']

export const hash256 = bytes => sha256(sha256(bytes))
export const hash160 = bytes => ripemd160(sha256(bytes))

const reverse = bytes => Uint8Array.from(bytes).reverse()

function uintLE (value, size) {
  const out = new Uint8Array(size)
  let v = BigInt(value)
  if (v < 0n) throw new Error('Negative values cannot be encoded.')
  for (let i = 0; i < size; i++) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  if (v !== 0n) throw new Error(`The value does not fit in ${size} bytes.`)
  return out
}

/** Bitcoin's variable-length integer ("CompactSize"), minimally encoded. */
export function compactSize (value) {
  const v = BigInt(value)
  if (v < 0xfdn) return Uint8Array.of(Number(v))
  if (v <= 0xffffn) return concatBytes(Uint8Array.of(0xfd), uintLE(v, 2))
  if (v <= 0xffffffffn) return concatBytes(Uint8Array.of(0xfe), uintLE(v, 4))
  return concatBytes(Uint8Array.of(0xff), uintLE(v, 8))
}

function readCompactSize (bytes, offset) {
  const first = bytes[offset]
  if (first < 0xfd) return { value: BigInt(first), size: 1 }
  const size = first === 0xfd ? 2 : first === 0xfe ? 4 : 8
  let value = 0n
  for (let i = size; i >= 1; i--) value = (value << 8n) | BigInt(bytes[offset + i])
  return { value, size: size + 1 }
}

/** A data push, for an unlocking script. */
function push (data) {
  if (data.length < 0x4c) return concatBytes(Uint8Array.of(data.length), data)
  if (data.length <= 0xff) return concatBytes(Uint8Array.of(0x4c, data.length), data)
  throw new Error('The data is too long for a standard push.')
}

/**
 * The locking bytecode an address pays to.
 *
 * @param {{ type: number, hash: Uint8Array }} decoded - A decoded address.
 * @returns {Uint8Array}
 */
export function lockingBytecodeOf (decoded) {
  const { type, hash } = decoded
  const p2pkh = type === AddressType.P2PKH || type === AddressType.P2PKH_TOKENS
  const p2sh = type === AddressType.P2SH || type === AddressType.P2SH_TOKENS
  if (p2pkh && hash.length === 20) return concatBytes(Uint8Array.of(0x76, 0xa9, 0x14), hash, Uint8Array.of(0x88, 0xac))
  if (p2sh && hash.length === 20) return concatBytes(Uint8Array.of(0xa9, 0x14), hash, Uint8Array.of(0x87))
  if (p2sh && hash.length === 32) return concatBytes(Uint8Array.of(0xaa, 0x20), hash, Uint8Array.of(0x87))
  throw new Error('This kind of address cannot be paid.')
}

export const p2pkhLockingBytecode = publicKey => lockingBytecodeOf({ type: AddressType.P2PKH, hash: hash160(publicKey) })

/**
 * @typedef {Object} TokenData
 * @property {string} category - The token category, as 64 hex characters (the byte order transaction ids are shown in).
 * @property {bigint} amount - The fungible amount. Zero for a pure NFT.
 * @property {{ capability: 'none' | 'mutable' | 'minting', commitment: string }} [nft] - The NFT, if the output carries one.
 */

/**
 * Encodes the token prefix of an output.
 *
 * @param {TokenData} token
 * @returns {Uint8Array}
 */
export function encodeTokenPrefix (token) {
  if (!/^[0-9a-f]{64}$/.test(token.category)) throw new Error('A token category is 64 hex characters.')
  const amount = BigInt(token.amount ?? 0)
  if (amount < 0n || amount > 9223372036854775807n) throw new Error('The token amount is out of range.')
  if (amount === 0n && !token.nft) throw new Error('A token output must carry an amount or an NFT.')

  let bitfield = 0
  const parts = []
  if (token.nft) {
    const capability = NFT_CAPABILITIES.indexOf(token.nft.capability)
    if (capability < 0) throw new Error(`Unknown NFT capability: ${token.nft.capability}.`)
    bitfield |= HAS_NFT | capability
    const commitment = hexToBytes(token.nft.commitment ?? '')
    if (commitment.length > 40) throw new Error('An NFT commitment is at most 40 bytes.')
    if (commitment.length > 0) {
      bitfield |= HAS_COMMITMENT_LENGTH
      parts.push(compactSize(commitment.length), commitment)
    }
  }
  if (amount > 0n) {
    bitfield |= HAS_AMOUNT
    parts.push(compactSize(amount))
  }
  return concatBytes(Uint8Array.of(PREFIX_TOKEN), reverse(hexToBytes(token.category)), Uint8Array.of(bitfield), ...parts)
}

/**
 * Splits the bytes between an output's length and its end into the token prefix (if any) and the locking bytecode.
 *
 * @param {Uint8Array} bytes
 * @returns {{ token?: TokenData, lockingBytecode: Uint8Array }}
 */
export function decodeTokenPrefix (bytes) {
  if (bytes[0] !== PREFIX_TOKEN) return { lockingBytecode: bytes }
  let offset = 1
  const category = bytesToHex(reverse(bytes.slice(offset, offset + 32)))
  offset += 32
  const bitfield = bytes[offset++]
  const token = { category, amount: 0n }
  if (bitfield & HAS_NFT) {
    let commitment = new Uint8Array(0)
    if (bitfield & HAS_COMMITMENT_LENGTH) {
      const length = readCompactSize(bytes, offset)
      offset += length.size
      commitment = bytes.slice(offset, offset + Number(length.value))
      offset += Number(length.value)
    }
    token.nft = { capability: NFT_CAPABILITIES[bitfield & 0x0f] ?? 'none', commitment: bytesToHex(commitment) }
  }
  if (bitfield & HAS_AMOUNT) {
    const amount = readCompactSize(bytes, offset)
    offset += amount.size
    token.amount = amount.value
  }
  return { token, lockingBytecode: bytes.slice(offset) }
}

/**
 * @typedef {Object} Output
 * @property {Uint8Array} lockingBytecode
 * @property {bigint} valueSatoshis
 * @property {TokenData} [token]
 */

/** @param {Output} output */
export function encodeOutput (output) {
  const script = output.token ? concatBytes(encodeTokenPrefix(output.token), output.lockingBytecode) : output.lockingBytecode
  return concatBytes(uintLE(output.valueSatoshis, 8), compactSize(script.length), script)
}

/**
 * @typedef {Object} Input
 * @property {string} txid - The transaction id of the output being spent, as shown (big-endian hex).
 * @property {number} vout
 * @property {Uint8Array} [unlockingBytecode]
 * @property {number} [sequenceNumber]
 */

const encodeOutpoint = input => concatBytes(reverse(hexToBytes(input.txid)), uintLE(input.vout, 4))

/**
 * Encodes a transaction.
 *
 * @param {{ version?: number, inputs: Input[], outputs: Output[], locktime?: number }} tx
 * @returns {Uint8Array}
 */
export function encodeTransaction (tx) {
  return concatBytes(
    uintLE(tx.version ?? 2, 4),
    compactSize(tx.inputs.length),
    ...tx.inputs.map(input => {
      const script = input.unlockingBytecode ?? new Uint8Array(0)
      return concatBytes(encodeOutpoint(input), compactSize(script.length), script, uintLE(input.sequenceNumber ?? 0, 4))
    }),
    compactSize(tx.outputs.length),
    ...tx.outputs.map(encodeOutput),
    uintLE(tx.locktime ?? 0, 4)
  )
}

/**
 * Decodes a transaction.
 *
 * @param {Uint8Array} bytes
 * @returns {{ version: number, inputs: Required<Input>[], outputs: Output[], locktime: number }}
 */
export function decodeTransaction (bytes) {
  let offset = 0
  const u32 = () => {
    const v = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)
    offset += 4
    return v >>> 0
  }
  const varint = () => {
    const { value, size } = readCompactSize(bytes, offset)
    offset += size
    return Number(value)
  }
  const take = n => {
    if (offset + n > bytes.length) throw new Error('The transaction is truncated.')
    const out = bytes.slice(offset, offset + n)
    offset += n
    return out
  }

  const version = u32()
  const inputs = []
  for (let n = varint(); n > 0; n--) {
    const txid = bytesToHex(reverse(take(32)))
    const vout = u32()
    const unlockingBytecode = take(varint())
    inputs.push({ txid, vout, unlockingBytecode, sequenceNumber: u32() })
  }
  const outputs = []
  for (let n = varint(); n > 0; n--) {
    let valueSatoshis = 0n
    const value = take(8)
    for (let i = 7; i >= 0; i--) valueSatoshis = (valueSatoshis << 8n) | BigInt(value[i])
    outputs.push({ valueSatoshis, ...decodeTokenPrefix(take(varint())) })
  }
  const locktime = u32()
  if (offset !== bytes.length) throw new Error('The transaction has trailing bytes.')
  return { version, inputs, outputs, locktime }
}

/** A transaction's id: the double SHA-256 of its encoding, shown reversed. */
export const transactionId = encoded => bytesToHex(reverse(hash256(encoded)))

/**
 * The bytes a signature commits to, for SIGHASH_ALL | SIGHASH_FORKID, with or without SIGHASH_UTXOS.
 *
 * @param {{ version?: number, inputs: Input[], outputs: Output[], locktime?: number }} tx
 * @param {number} index - The input being signed.
 * @param {Output[]} sourceOutputs - The output each input spends, in input order.
 * @param {number} sighashType
 * @returns {Uint8Array}
 */
export function signingSerialization (tx, index, sourceOutputs, sighashType) {
  if ((sighashType & 0x1f) !== SIGHASH_ALL || !(sighashType & SIGHASH_FORKID)) {
    throw new Error('Only SIGHASH_ALL | SIGHASH_FORKID signatures (optionally with SIGHASH_UTXOS) are supported.')
  }
  if (sourceOutputs.length !== tx.inputs.length) throw new Error('One source output is needed for every input.')
  const input = tx.inputs[index]
  const source = sourceOutputs[index]
  return concatBytes(
    uintLE(tx.version ?? 2, 4),
    hash256(concatBytes(...tx.inputs.map(encodeOutpoint))),
    ...(sighashType & SIGHASH_UTXOS ? [hash256(concatBytes(...sourceOutputs.map(encodeOutput)))] : []),
    hash256(concatBytes(...tx.inputs.map(i => uintLE(i.sequenceNumber ?? 0, 4)))),
    encodeOutpoint(input),
    source.token ? encodeTokenPrefix(source.token) : new Uint8Array(0),
    compactSize(source.lockingBytecode.length),
    source.lockingBytecode,
    uintLE(source.valueSatoshis, 8),
    uintLE(input.sequenceNumber ?? 0, 4),
    hash256(concatBytes(...tx.outputs.map(encodeOutput))),
    uintLE(tx.locktime ?? 0, 4),
    uintLE(sighashType | 0, 4)
  )
}

/**
 * Signs every input that spends a P2PKH output of this key, and leaves the others untouched.
 *
 * @param {{ version?: number, inputs: Input[], outputs: Output[], locktime?: number }} tx
 * @param {Output[]} sourceOutputs
 * @param {Uint8Array} privateKey
 * @param {Uint8Array} publicKey - The compressed public key.
 * @param {number} [sighashType]
 * @returns {{ transaction: object, signed: number[] }} The transaction with unlocking scripts filled in, and the indexes signed.
 */
export function signP2pkhInputs (tx, sourceOutputs, privateKey, publicKey, sighashType = SIGHASH_ALL | SIGHASH_FORKID) {
  const mine = bytesToHex(p2pkhLockingBytecode(publicKey))
  const signed = []
  const inputs = tx.inputs.map((input, index) => {
    if (bytesToHex(sourceOutputs[index].lockingBytecode) !== mine) return input
    const digest = hash256(signingSerialization(tx, index, sourceOutputs, sighashType))
    const der = secp256k1.sign(digest, privateKey, { lowS: true }).toDERRawBytes()
    signed.push(index)
    return { ...input, unlockingBytecode: concatBytes(push(concatBytes(der, Uint8Array.of(sighashType))), push(publicKey)) }
  })
  return { transaction: { ...tx, inputs }, signed }
}

/** The most a signed P2PKH input can take: outpoint, script length, a 72-byte signature with its type byte, the key, the sequence. */
export const P2PKH_INPUT_SIZE = 32 + 4 + 1 + (1 + 73) + (1 + 33) + 4

/**
 * The size, in bytes, a transaction will have once its P2PKH inputs are signed.
 *
 * @param {number} inputCount
 * @param {Output[]} outputs
 */
export function estimateSize (inputCount, outputs) {
  const outputsSize = outputs.reduce((sum, o) => sum + encodeOutput(o).length, 0)
  return 4 + compactSize(inputCount).length + inputCount * P2PKH_INPUT_SIZE + compactSize(outputs.length).length + outputsSize + 4
}
