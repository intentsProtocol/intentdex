// Bitcoin signed messages, as Bitcoin Cash wallets produce and verify them (Electron Cash, mainnet-js).
//
// The signature is 65 bytes, base64: a header byte (27 + recovery id, + 4 for a compressed key), then r and s.
// The digest is the double SHA-256 of a length-prefixed magic string followed by the length-prefixed message.

'use strict'

import { secp256k1 } from '@noble/curves/secp256k1'
import { concatBytes } from '@noble/hashes/utils'

import { compactSize, hash160, hash256 } from './transaction.js'

const MAGIC = new TextEncoder().encode('\x18Bitcoin Signed Message:\n')

const toBase64 = bytes => {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

const fromBase64 = text => Uint8Array.from(atob(text), ch => ch.charCodeAt(0))

/** The digest a message signature commits to. */
export function messageDigest (message) {
  const body = new TextEncoder().encode(message)
  return hash256(concatBytes(MAGIC, compactSize(body.length), body))
}

/**
 * Signs a message.
 *
 * @param {string} message
 * @param {Uint8Array} privateKey
 * @returns {string} The signature, base64.
 */
export function signMessage (message, privateKey) {
  const signature = secp256k1.sign(messageDigest(message), privateKey, { lowS: true })
  return toBase64(concatBytes(Uint8Array.of(27 + signature.recovery + 4), signature.toCompactRawBytes()))
}

/**
 * Recovers the public key hash that signed a message.
 *
 * @param {string} message
 * @param {string} signature - Base64.
 * @returns {Uint8Array | null} The 20-byte hash of the signing key, or null when the signature is malformed.
 */
export function recoverMessageSigner (message, signature) {
  try {
    const bytes = fromBase64(signature)
    if (bytes.length !== 65) return null
    const header = bytes[0]
    if (header < 27 || header > 34) return null
    const compressed = header >= 31
    const recovery = (header - 27) & 3
    const point = secp256k1.Signature.fromCompact(bytes.slice(1)).addRecoveryBit(recovery).recoverPublicKey(messageDigest(message))
    return hash160(point.toRawBytes(compressed))
  } catch {
    return null
  }
}

/**
 * Verifies a message signature against a public key hash.
 *
 * @param {string} message
 * @param {string} signature - Base64.
 * @param {Uint8Array} publicKeyHash - The 20-byte hash an address encodes.
 * @returns {boolean}
 */
export function verifyMessage (message, signature, publicKeyHash) {
  const signer = recoverMessageSigner(message, signature)
  return !!signer && signer.length === publicKeyHash.length && signer.every((b, i) => b === publicKeyHash[i])
}
