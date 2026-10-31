// CashAddr: the address format of Bitcoin Cash.
// Spec: https://github.com/bitcoincashorg/bitcoincash.org/blob/master/spec/cashaddr.md
// Token-aware types (2 and 3): CHIP-2022-02-CashTokens.

'use strict'

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GENERATORS = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n]

/** Address types as they are stored in the version byte. */
export const AddressType = Object.freeze({
  P2PKH: 0,
  P2SH: 1,
  P2PKH_TOKENS: 2,
  P2SH_TOKENS: 3
})

const SIZE_BITS = { 20: 0, 24: 1, 28: 2, 32: 3, 40: 4, 48: 5, 56: 6, 64: 7 }
const SIZE_BYTES = [20, 24, 28, 32, 40, 48, 56, 64]

function polymod (values) {
  let c = 1n
  for (const d of values) {
    const c0 = c >> 35n
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d)
    for (let i = 0; i < 5; i++) {
      if ((c0 >> BigInt(i)) & 1n) c ^= GENERATORS[i]
    }
  }
  return c ^ 1n
}

const prefixValues = prefix => [...prefix].map(ch => ch.charCodeAt(0) & 31).concat(0)

/** Regroup bits, as in bech32. Strict mode refuses non-zero padding when decoding. */
function convertBits (data, from, to, pad) {
  let acc = 0
  let bits = 0
  const out = []
  const maxv = (1 << to) - 1
  for (const value of data) {
    acc = (acc << from) | value
    bits += from
    while (bits >= to) {
      bits -= to
      out.push((acc >> bits) & maxv)
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv)
  } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
    throw new Error('Invalid CashAddr padding.')
  }
  return out
}

/**
 * Encodes an address.
 *
 * @param {string} prefix - "bitcoincash", "bchtest" or "bchreg".
 * @param {number} type - One of {@link AddressType}.
 * @param {Uint8Array} hash - The 20-byte (or, for P2SH32, 32-byte) hash.
 * @returns {string} The address, with its prefix.
 */
export function encodeCashAddress (prefix, type, hash) {
  const sizeBits = SIZE_BITS[hash.length]
  if (sizeBits === undefined) throw new Error(`Unsupported hash length: ${hash.length}.`)
  if (!Number.isInteger(type) || type < 0 || type > 15) throw new Error(`Unsupported address type: ${type}.`)
  const payload = convertBits([(type << 3) | sizeBits, ...hash], 8, 5, true)
  const checksum = polymod([...prefixValues(prefix), ...payload, 0, 0, 0, 0, 0, 0, 0, 0])
  const checksumValues = []
  for (let i = 0; i < 8; i++) checksumValues.push(Number((checksum >> BigInt(5 * (7 - i))) & 31n))
  return `${prefix}:${[...payload, ...checksumValues].map(v => CHARSET[v]).join('')}`
}

/**
 * Decodes an address and verifies its checksum.
 *
 * @param {string} address - The address. The prefix may be omitted when `defaultPrefix` is given.
 * @param {string} [defaultPrefix] - The prefix to assume for a bare address.
 * @returns {{ prefix: string, type: number, hash: Uint8Array }} The decoded address.
 * @throws {Error} If the address is malformed or its checksum does not match.
 */
export function decodeCashAddress (address, defaultPrefix) {
  if (typeof address !== 'string') throw new Error('The address must be a string.')
  if (address !== address.toLowerCase() && address !== address.toUpperCase()) throw new Error('A CashAddr must not mix upper and lower case.')
  const lower = address.toLowerCase()
  const colon = lower.indexOf(':')
  const prefix = colon >= 0 ? lower.slice(0, colon) : defaultPrefix
  const body = colon >= 0 ? lower.slice(colon + 1) : lower
  if (!prefix) throw new Error('The address has no prefix.')

  const values = []
  for (const ch of body) {
    const v = CHARSET.indexOf(ch)
    if (v < 0) throw new Error(`Invalid CashAddr character: "${ch}".`)
    values.push(v)
  }
  if (values.length < 9) throw new Error('The address is too short.')
  if (polymod([...prefixValues(prefix), ...values]) !== 0n) throw new Error('The address checksum does not match. Check for a mistyped character or the wrong network.')

  const data = convertBits(values.slice(0, -8), 5, 8, false)
  const version = data[0]
  if (version & 0x80) throw new Error('Unsupported CashAddr version.')
  const hash = Uint8Array.from(data.slice(1))
  if (hash.length !== SIZE_BYTES[version & 7]) throw new Error('The address hash has the wrong length.')
  return { prefix, type: version >> 3, hash }
}

/** The address prefix of a network. */
export function prefixOf (network) {
  if (network === 'mainnet') return 'bitcoincash'
  if (network === 'chipnet' || network === 'testnet') return 'bchtest'
  if (network === 'regtest') return 'bchreg'
  throw new Error(`Unknown network: ${network}.`)
}

/** True when tokens may be sent to an address of this type. */
export const acceptsTokens = type => type === AddressType.P2PKH_TOKENS || type === AddressType.P2SH_TOKENS
