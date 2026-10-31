/**
 * Does an address belong to the chain it is about to be used on?
 *
 * Pure checks with no chain library behind them, so they run the same in the extension, the app and the wallet
 * worklet. They catch the wrong-chain paste and the mistyped character before anything is signed; they do not
 * prove an address is in use.
 */

import { keccak_256 } from '@noble/hashes/sha3';
import type { Asset } from './assets';
import type { MessageKey, MessageVars } from './i18n';

/** A problem with an address, as a translatable message. */
export interface AddressProblem { key: MessageKey; vars?: MessageVars }

const HEX = '0123456789abcdef';
const toHex = (bytes: Uint8Array) => Array.from(bytes, b => HEX[b >> 4] + HEX[b & 15]).join('');

/** An EVM address: 20 bytes of hex. Mixed case must carry a valid EIP-55 checksum; all-lower or all-upper passes. */
export function isEvmAddress(a: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return false;
  const body = a.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  const hash = toHex(keccak_256(new TextEncoder().encode(body.toLowerCase())));
  for (let i = 0; i < 40; i++) {
    const c = body[i];
    if (/[a-fA-F]/.test(c) && (parseInt(hash[i], 16) >= 8) !== (c === c.toUpperCase())) return false;
  }
  return true;
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58 → bytes, or null when a character is not in the alphabet. */
export function base58Decode(s: string): Uint8Array | null {
  const bytes: number[] = [];
  for (const ch of s) {
    let carry = B58.indexOf(ch);
    if (carry < 0) return null;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of s) { if (ch === '1') bytes.push(0); else break; }
  return Uint8Array.from(bytes.reverse());
}

const CASHADDR_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CASHADDR_GENERATORS = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];

/**
 * True when `body` is a CashAddr payload whose checksum is right for `prefix`. The checksum covers the prefix,
 * so an address copied from the other network, or with one character wrong, fails here.
 */
export function cashAddressChecksumOk(prefix: string, body: string): boolean {
  let c = 1n;
  const feed = (d: number) => {
    const c0 = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    for (let i = 0; i < 5; i++) if ((c0 >> BigInt(i)) & 1n) c ^= CASHADDR_GENERATORS[i];
  };
  for (const ch of prefix) feed(ch.charCodeAt(0) & 31);
  feed(0);
  for (const ch of body) {
    const v = CASHADDR_CHARSET.indexOf(ch);
    if (v < 0) return false;
    feed(v);
  }
  return (c ^ 1n) === 0n;
}

/**
 * The locking bytecode (hex) a CashAddr pays to, or null for anything malformed. Accepts the token-aware forms
 * (z…, r…), which pay the same script. Used to check that a plan someone else made pays this wallet.
 */
export function cashAddressToLockingBytecode(address: string): string | null {
  const a = address.trim().toLowerCase();
  const colon = a.indexOf(':');
  if (colon < 1) return null;
  const prefix = a.slice(0, colon);
  const body = a.slice(colon + 1);
  if (!cashAddressChecksumOk(prefix, body) || body.length < 9) return null;
  // 5-bit groups → bytes, without the 8 checksum characters.
  const bytes: number[] = [];
  let acc = 0, bits = 0;
  for (const ch of body.slice(0, -8)) {
    acc = (acc << 5) | CASHADDR_CHARSET.indexOf(ch);
    bits += 5;
    while (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
  }
  const [version, ...hash] = bytes;
  if (version === undefined) return null;
  const type = (version >> 3) & 0x0f;          // 0 P2PKH, 1 P2SH, 2 P2PKH with tokens, 3 P2SH with tokens
  const size = [20, 24, 28, 32, 40, 48, 56, 64][version & 0x07];
  if (hash.length !== size) return null;
  const hex = hash.map(b => b.toString(16).padStart(2, '0')).join('');
  if ((type === 0 || type === 2) && size === 20) return `76a914${hex}88ac`;
  if ((type === 1 || type === 3) && size === 20) return `a914${hex}87`;
  if ((type === 1 || type === 3) && size === 32) return `aa20${hex}87`;
  return null;
}

/** A Solana address: base58 of exactly 32 bytes. */
export function isSolAddress(a: string): boolean {
  if (a.length < 32 || a.length > 44) return false;
  return base58Decode(a)?.length === 32;
}

export function validateAddress(asset: Pick<Asset, 'network' | 'kind'>, address: string): AddressProblem | null {
  const a = address.trim();
  if (!a) return { key: 'address.empty' };
  switch (asset.network.family) {
    case 'evm':
      return isEvmAddress(a) ? null : { key: 'address.evm' };
    case 'solana':
      return isSolAddress(a) ? null : { key: 'address.solana' };
    case 'btc': {
      const ok = asset.network.mode === 'mainnet' ? /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a) : /^(tb1|[mn2])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a);
      return ok ? null : { key: 'address.btc', vars: { network: asset.network.name } };
    }
    case 'bch': {
      const expected = asset.network.mode === 'mainnet' ? 'bitcoincash' : 'bchtest';
      const body = a.includes(':') ? a.slice(a.indexOf(':') + 1) : a;
      const prefix = a.includes(':') ? a.slice(0, a.indexOf(':')) : '';
      if (prefix && prefix !== expected) return { key: 'address.bchNetwork', vars: { prefix: `${expected}:` } };
      if (!/^[qpzr][a-z0-9]{41,}$/.test(body) || !cashAddressChecksumOk(expected, body)) return { key: 'address.bch' };
      if (asset.kind === 'cashtoken' && !/^[zr]/.test(body)) return { key: 'address.token' };
      return null;
    }
  }
}

/** Add the network prefix a bare cashaddr is missing. */
export function normalizeRecipient(asset: Pick<Asset, 'network'>, address: string): string {
  const a = address.trim();
  if (asset.network.family === 'bch' && !a.includes(':')) return `${asset.network.mode === 'mainnet' ? 'bitcoincash' : 'bchtest'}:${a}`;
  return a;
}
