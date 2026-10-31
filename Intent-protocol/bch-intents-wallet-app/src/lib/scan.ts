/**
 * What a scanned or pasted code is: an address to pay (with the amount a payment link asked for), a
 * WalletConnect link, or neither. Pure, so it is tested without a camera.
 *
 * An address says which family it belongs to, and for Bitcoin Cash and Bitcoin also whether it is a testnet or
 * a mainnet address. An EVM or Solana address is the same on both, so `mode` is left out for those.
 */
import type { Family, NetworkMode } from '@bch-intents/wallet-core/chains';
import { cashAddressChecksumOk, isEvmAddress, isSolAddress } from '@bch-intents/wallet-core/validation';

export type Scanned =
  | { kind: 'address'; family: Family; address: string; mode?: NetworkMode; amount?: string; chainId?: number }
  | { kind: 'walletconnect'; uri: string }
  | { kind: 'unknown' };

const decimal = (v: string | null | undefined) => (v && /^\d*\.?\d+$/.test(v) ? v : undefined);

function query(text: string): Record<string, string> {
  const i = text.indexOf('?');
  if (i < 0) return {};
  const out: Record<string, string> = {};
  for (const part of text.slice(i + 1).split('&')) {
    const [k, v = ''] = part.split('=');
    try { out[decodeURIComponent(k).toLowerCase()] = decodeURIComponent(v); } catch { /* a malformed parameter is ignored */ }
  }
  return out;
}

function cashAddress(text: string): Scanned | null {
  const lower = text.toLowerCase();
  const body = lower.split('?')[0];
  const [prefix, payload] = body.includes(':') ? body.split(':') : ['', body];
  if (!/^[qpzr][a-z0-9]{41,}$/.test(payload)) return null;
  const candidates: [string, NetworkMode][] = prefix === 'bitcoincash' ? [['bitcoincash', 'mainnet']] : prefix === 'bchtest' ? [['bchtest', 'testnet']] : prefix ? [] : [['bitcoincash', 'mainnet'], ['bchtest', 'testnet']];
  for (const [p, mode] of candidates) {
    if (cashAddressChecksumOk(p, payload)) return { kind: 'address', family: 'bch', address: `${p}:${payload}`, mode, amount: decimal(query(lower).amount) };
  }
  return null;
}

export function parseScanned(raw: string): Scanned {
  const text = raw.trim();
  if (!text) return { kind: 'unknown' };

  if (/^wc:[0-9a-f-]+@\d/i.test(text)) return { kind: 'walletconnect', uri: text };

  const bch = cashAddress(text);
  if (bch) return bch;

  // EIP-681: ethereum:0xabc…@8453?value=1e18 — only the plain form (pay an address) is taken.
  const evm = /^(?:ethereum:)?(0x[0-9a-fA-F]{40})(?:@(\d+))?(?:\?.*)?$/.exec(text);
  if (evm && isEvmAddress(evm[1])) {
    return { kind: 'address', family: 'evm', address: evm[1], chainId: evm[2] ? Number(evm[2]) : undefined };
  }

  const btc = /^(?:bitcoin:)?((?:bc1|tb1)[a-z0-9]{25,62}|[13mn2][a-km-zA-HJ-NP-Z1-9]{25,34})(?:\?.*)?$/i.exec(text);
  if (btc) {
    const address = /^(bc1|tb1)/i.test(btc[1]) ? btc[1].toLowerCase() : btc[1];
    const mode: NetworkMode = /^(bc1|[13])/.test(address) ? 'mainnet' : 'testnet';
    // A legacy address shares its alphabet with Solana's; one that came with the bitcoin: scheme, or is bech32, is certain.
    if (/^bitcoin:/i.test(text) || /^(bc1|tb1)/.test(address) || !isSolAddress(address)) {
      return { kind: 'address', family: 'btc', address, mode, amount: decimal(query(text).amount) };
    }
  }

  const sol = /^(?:solana:)?([1-9A-HJ-NP-Za-km-z]{32,44})(?:\?.*)?$/.exec(text);
  if (sol && isSolAddress(sol[1])) return { kind: 'address', family: 'solana', address: sol[1], amount: decimal(query(text).amount) };

  return { kind: 'unknown' };
}
