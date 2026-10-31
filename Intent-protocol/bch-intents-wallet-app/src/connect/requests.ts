/**
 * WalletConnect, as far as it can be decided without a network or a key: which chains and methods the wallet
 * offers, which accounts a session gets, and what a request asks for, in a form a screen can show.
 *
 * Three namespaces:
 *   eip155   EVM networks of the current mode       personal_sign, eth_signTypedData_v4, eth_sendTransaction
 *   solana   Solana mainnet or devnet               solana_signMessage, solana_signTransaction
 *   bch      Bitcoin Cash mainnet or chipnet        bch_getAddresses, bch_signMessage, bch_signTransaction
 *            (the wc2-bch-bcr convention that Cashonize, Paytaca and BCH dapps use)
 *
 * Everything here is pure, and tested in tests/connect.test.ts.
 */
import { networkOf, networksOf, type NetworkDef, type NetworkMode } from '@bch-intents/wallet-core/chains';
import type { Addresses } from '@bch-intents/wallet-core/assets';
import { base58, bytesToHex, fromBase64, hexToBytes } from '@bch-intents/wallet-core/swap/encoding';
import { base58Decode } from '@bch-intents/wallet-core/validation';
import { decodeTransaction, encodeTransaction } from '../../vendor/wdk-wallet-bch/src/transaction.js';
import { decodeCashAddress } from '../../vendor/wdk-wallet-bch/src/cashaddr.js';

export const SOLANA_CHAIN: Record<NetworkMode, string> = {
  mainnet: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  testnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
};
export const BCH_CHAIN: Record<NetworkMode, string> = { mainnet: 'bch:bitcoincash', testnet: 'bch:bchtest' };

export const METHODS = {
  eip155: ['personal_sign', 'eth_signTypedData_v4', 'eth_signTypedData', 'eth_sendTransaction', 'wallet_switchEthereumChain'],
  solana: ['solana_signMessage', 'solana_signTransaction'],
  bch: ['bch_getAddresses', 'bch_signMessage', 'bch_signTransaction'],
} as const;

export const EVENTS = {
  eip155: ['chainChanged', 'accountsChanged'],
  solana: [] as string[],
  bch: ['addressesChanged'],
};

export type Namespace = keyof typeof METHODS;

/** The network a CAIP-2 chain id means, in this mode; undefined when the wallet does not have it. */
export function networkForChain(chain: string, mode: NetworkMode): NetworkDef | undefined {
  const [ns, ref] = chain.split(':');
  if (ns === 'eip155') return networksOf(mode, 'evm').find(n => String(n.chainId) === ref);
  if (chain === SOLANA_CHAIN[mode]) return networkOf(mode, 'solana');
  if (chain === BCH_CHAIN[mode]) return networkOf(mode, 'bch');
  return undefined;
}

export function chainsOf(mode: NetworkMode): Record<Namespace, string[]> {
  return {
    eip155: networksOf(mode, 'evm').map(n => `eip155:${n.chainId}`),
    solana: [SOLANA_CHAIN[mode]],
    bch: [BCH_CHAIN[mode]],
  };
}

/** The account's address in the form a namespace uses. A cashaddr keeps its prefix, which contains a colon. */
function addressIn(ns: Namespace, addresses: Addresses): string | null {
  return ns === 'eip155' ? addresses.evm : ns === 'solana' ? addresses.solana : addresses.bch;
}

interface Requirement { chains?: string[]; methods?: string[]; events?: string[] }
export type Requirements = Record<string, Requirement>;
export interface SessionNamespace { chains: string[]; accounts: string[]; methods: string[]; events: string[] }

export type NamespaceResult =
  | { ok: true; namespaces: Record<string, SessionNamespace>; networks: NetworkDef[] }
  | { ok: false; unsupported: string[] };

/**
 * What a session is given: every chain of this mode the app asked for or allows, with the active account on
 * each. A chain or method the app *requires* that the wallet does not have refuses the session.
 */
export function buildNamespaces(required: Requirements, optional: Requirements, mode: NetworkMode, addresses: Addresses): NamespaceResult {
  const mine = chainsOf(mode);
  const unsupported: string[] = [];
  const namespaces: Record<string, SessionNamespace> = {};
  const networks: NetworkDef[] = [];

  // A key is a namespace ("eip155") or a single chain ("eip155:1").
  const chainsIn = (key: string, r: Requirement) => (key.includes(':') ? [key] : r.chains ?? []);
  const wanted = new Map<Namespace, { chains: Set<string>; requiredMethods: Set<string> }>();
  const slot = (ns: Namespace) => wanted.get(ns) ?? wanted.set(ns, { chains: new Set(), requiredMethods: new Set() }).get(ns)!;

  for (const [key, r] of Object.entries(required ?? {})) {
    const ns = key.split(':')[0] as Namespace;
    if (!(ns in METHODS)) { unsupported.push(key); continue; }
    for (const chain of chainsIn(key, r)) (mine[ns].includes(chain) ? slot(ns).chains.add(chain) : unsupported.push(chain));
    for (const method of r.methods ?? []) ((METHODS[ns] as readonly string[]).includes(method) ? slot(ns).requiredMethods.add(method) : unsupported.push(method));
  }
  for (const [key, r] of Object.entries(optional ?? {})) {
    const ns = key.split(':')[0] as Namespace;
    if (!(ns in METHODS)) continue;
    for (const chain of chainsIn(key, r)) if (mine[ns].includes(chain)) slot(ns).chains.add(chain);
  }
  if (unsupported.length) return { ok: false, unsupported: [...new Set(unsupported)] };

  for (const [ns, want] of wanted) {
    const address = addressIn(ns, addresses);
    if (!address || !want.chains.size) continue;
    const chains = mine[ns].filter(c => want.chains.has(c));
    namespaces[ns] = {
      chains,
      accounts: chains.map(c => `${c}:${address}`),
      methods: [...METHODS[ns]],
      events: [...EVENTS[ns]],
    };
    for (const chain of chains) { const net = networkForChain(chain, mode); if (net) networks.push(net); }
  }
  if (!Object.keys(namespaces).length) return { ok: false, unsupported: Object.keys({ ...required, ...optional }) };
  return { ok: true, namespaces, networks };
}

// ── requests ─────────────────────────────────────────────────────────────────

/**
 * Bytes as text, or null when they are not well-formed UTF-8. Written out because the engine's TextDecoder
 * does not implement strict decoding everywhere React Native runs, and a message must never be shown to the
 * user in a form that differs from what is signed.
 */
export function utf8(bytes: Uint8Array): string | null {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let code: number, extra: number, min: number;
    if (b < 0x80) { code = b; extra = 0; min = 0; }
    else if (b >= 0xc2 && b < 0xe0) { code = b & 0x1f; extra = 1; min = 0x80; }
    else if (b >= 0xe0 && b < 0xf0) { code = b & 0x0f; extra = 2; min = 0x800; }
    else if (b >= 0xf0 && b < 0xf5) { code = b & 0x07; extra = 3; min = 0x10000; }
    else return null;
    for (let k = 1; k <= extra; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      code = (code << 6) | (c & 0x3f);
    }
    // Overlong forms, surrogates and values past the last code point are not text.
    if (code < min || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return null;
    out += String.fromCodePoint(code);
    i += extra + 1;
  }
  return out;
}

export type RequestView =
  | { kind: 'message'; network: NetworkDef; message: string; address: string }
  | { kind: 'typed'; network: NetworkDef; address: string; domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> }
  | { kind: 'evmTx'; network: NetworkDef; from: string; to: string; value: bigint; data: string }
  | { kind: 'solanaTx'; network: NetworkDef; transaction: string }
  | { kind: 'bchTx'; network: NetworkDef; bch: BchSignRequest }
  | { kind: 'addresses'; network: NetworkDef }
  | { kind: 'switch'; network: NetworkDef }
  | { kind: 'unsupported'; method: string; reason?: 'method' | 'chain' | 'account' | 'message' | 'contract' };

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Read a request into something the approval screen can show, or say why the wallet cannot serve it. */
export function readRequest(method: string, params: unknown, chain: string, mode: NetworkMode, addresses: Addresses): RequestView {
  const network = networkForChain(chain, mode);
  if (!network) return { kind: 'unsupported', method, reason: 'chain' };
  const list = Array.isArray(params) ? (params as unknown[]) : [];
  const obj = (params && typeof params === 'object' && !Array.isArray(params) ? params : {}) as Record<string, unknown>;

  try {
    switch (method) {
      case 'personal_sign': {
        // [message, address]; some apps send them the other way round.
        const [a, b] = list as string[];
        const [raw, address] = same(a, addresses.evm) ? [b, a] : [a, b];
        if (!same(address, addresses.evm)) return { kind: 'unsupported', method, reason: 'account' };
        const message = /^0x([0-9a-f]{2})*$/i.test(raw) ? utf8(hexToBytes(raw)) : raw;
        // The wallet module signs text. Bytes that are not text cannot be passed to it faithfully.
        if (message === null || typeof message !== 'string') return { kind: 'unsupported', method, reason: 'message' };
        return { kind: 'message', network, message, address: addresses.evm! };
      }
      case 'eth_signTypedData':
      case 'eth_signTypedData_v4': {
        const [address, json] = list as [string, unknown];
        if (!same(address, addresses.evm)) return { kind: 'unsupported', method, reason: 'account' };
        const data = (typeof json === 'string' ? JSON.parse(json) : json) as { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> };
        // ethers derives the domain type itself and refuses one that is passed in.
        const { EIP712Domain: _domain, ...types } = data.types;
        return { kind: 'typed', network, address: addresses.evm!, domain: data.domain, types, primaryType: data.primaryType, message: data.message };
      }
      case 'eth_sendTransaction': {
        const tx = (list[0] ?? {}) as { from?: string; to?: string; data?: string; input?: string; value?: string };
        if (!same(tx.from, addresses.evm)) return { kind: 'unsupported', method, reason: 'account' };
        // A transaction with no recipient deploys a contract, which this wallet does not do.
        if (!tx.to || !/^0x[0-9a-fA-F]{40}$/.test(tx.to)) return { kind: 'unsupported', method, reason: 'method' };
        return { kind: 'evmTx', network, from: addresses.evm!, to: tx.to, value: tx.value ? BigInt(tx.value) : 0n, data: tx.data ?? tx.input ?? '0x' };
      }
      case 'wallet_switchEthereumChain': {
        const target = networksOf(mode, 'evm').find(n => n.chainId === Number((list[0] as { chainId?: string })?.chainId));
        return target ? { kind: 'switch', network: target } : { kind: 'unsupported', method, reason: 'chain' };
      }
      case 'solana_signMessage': {
        if (obj.pubkey && obj.pubkey !== addresses.solana) return { kind: 'unsupported', method, reason: 'account' };
        const bytes = base58Decode(String(obj.message ?? ''));
        const message = bytes ? utf8(bytes) : null;
        if (message === null) return { kind: 'unsupported', method, reason: 'message' };
        return { kind: 'message', network, message, address: addresses.solana! };
      }
      case 'solana_signTransaction': {
        const transaction = String(obj.transaction ?? '');
        if (!transaction || !fromBase64(transaction).length) return { kind: 'unsupported', method, reason: 'method' };
        return { kind: 'solanaTx', network, transaction };
      }
      case 'bch_getAddresses':
        return { kind: 'addresses', network };
      case 'bch_signMessage': {
        const message = typeof obj.message === 'string' ? obj.message : typeof list[0] === 'string' ? (list[0] as string) : null;
        if (message === null) return { kind: 'unsupported', method, reason: 'message' };
        return { kind: 'message', network, message, address: addresses.bch! };
      }
      case 'bch_signTransaction': {
        const bch = readBchSignRequest(obj, addresses.bch!);
        if (bch.contractInputs) return { kind: 'unsupported', method, reason: 'contract' };
        if (!bch.mine.length) return { kind: 'unsupported', method, reason: 'account' };
        return { kind: 'bchTx', network, bch };
      }
      default:
        return { kind: 'unsupported', method, reason: 'method' };
    }
  } catch {
    return { kind: 'unsupported', method, reason: 'method' };
  }
}

// ── Bitcoin Cash transactions ────────────────────────────────────────────────

/**
 * libauth writes binary and big numbers into JSON as tagged strings: "<Uint8Array: 0x…>" and "<bigint: 12n>".
 * This puts them back, all the way down.
 */
export function reviveLibauth(value: unknown): unknown {
  if (typeof value === 'string') {
    const bytes = /^<Uint8Array: 0x((?:[0-9a-f]{2})*)>$/i.exec(value);
    if (bytes) return hexToBytes(bytes[1]);
    const big = /^<bigint: (-?\d+)n>$/.exec(value);
    if (big) return BigInt(big[1]);
    return value;
  }
  if (Array.isArray(value)) return value.map(reviveLibauth);
  if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, reviveLibauth(v)]));
  }
  return value;
}

export interface BchSourceOutput { lockingBytecode: string; valueSatoshis: string; token?: { category: string; amount: string; nft?: { capability: string; commitment: string } } }

export interface BchSignRequest {
  /** The unsigned transaction, as hex. */
  transaction: string;
  sourceOutputs: BchSourceOutput[];
  broadcast: boolean;
  userPrompt?: string;
  /** Indexes of the inputs this wallet's key can sign. */
  mine: number[];
  /** Inputs that expect the wallet's signature inside a contract's script, which the wallet does not produce. */
  contractInputs: number;
  /** What leaves this wallet and what comes back to it, in satoshis. */
  spent: bigint;
  returned: bigint;
  outputs: { lockingBytecode: string; valueSatoshis: bigint; mine: boolean; token?: boolean }[];
  inputCount: number;
}

interface LibauthToken { category: Uint8Array; amount: bigint; nft?: { capability: string; commitment: Uint8Array } }
interface LibauthOutput { lockingBytecode: Uint8Array; valueSatoshis: bigint; token?: LibauthToken }
interface LibauthInput { outpointIndex: number; outpointTransactionHash: Uint8Array; sequenceNumber: number; unlockingBytecode: Uint8Array }

const tokenOf = (t?: LibauthToken) => (t ? {
  category: bytesToHex(t.category), amount: (t.amount ?? 0n).toString(),
  ...(t.nft ? { nft: { capability: t.nft.capability as 'none' | 'mutable' | 'minting', commitment: bytesToHex(t.nft.commitment ?? new Uint8Array(0)) } } : {}),
} : undefined);

/** A run of zero bytes as long as a public key or a signature slot: the marker dapps leave for the wallet to fill. */
const hasPlaceholder = (script: Uint8Array) => /(?:00){33}/.test(bytesToHex(script));

/** The P2PKH locking script of a cashaddr, as hex. */
export function lockingBytecodeOfAddress(address: string): string {
  const decoded = decodeCashAddress(address) as { hash: Uint8Array };
  return `76a914${bytesToHex(decoded.hash)}88ac`;
}

export function readBchSignRequest(params: Record<string, unknown>, address: string): BchSignRequest {
  const revived = reviveLibauth(params) as { transaction: unknown; sourceOutputs: (LibauthInput & LibauthOutput)[]; broadcast?: boolean; userPrompt?: string };
  const sources = revived.sourceOutputs ?? [];
  if (!Array.isArray(sources) || !sources.length) throw new Error('no source outputs');

  let transaction: string;
  if (typeof revived.transaction === 'string') {
    transaction = revived.transaction.replace(/^0x/i, '').toLowerCase();
  } else {
    const tx = revived.transaction as { version: number; locktime: number; inputs: LibauthInput[]; outputs: LibauthOutput[] };
    transaction = bytesToHex(encodeTransaction({
      version: tx.version, locktime: tx.locktime,
      inputs: tx.inputs.map(i => ({ txid: bytesToHex(i.outpointTransactionHash), vout: i.outpointIndex, sequenceNumber: i.sequenceNumber, unlockingBytecode: i.unlockingBytecode })),
      outputs: tx.outputs.map(o => ({
        lockingBytecode: o.lockingBytecode, valueSatoshis: o.valueSatoshis,
        ...(o.token ? { token: { ...tokenOf(o.token)!, amount: o.token.amount ?? 0n } } : {}),
      })),
    }));
  }
  const decoded = decodeTransaction(hexToBytes(transaction));
  if (decoded.inputs.length !== sources.length) throw new Error('one source output is needed per input');

  const own = lockingBytecodeOfAddress(address);
  const sourceOutputs: BchSourceOutput[] = sources.map(s => ({ lockingBytecode: bytesToHex(s.lockingBytecode), valueSatoshis: s.valueSatoshis.toString(), ...(s.token ? { token: tokenOf(s.token) } : {}) }));
  const mine = sourceOutputs.flatMap((s, i) => (s.lockingBytecode === own ? [i] : []));
  const contractInputs = decoded.inputs.filter((input: { unlockingBytecode?: Uint8Array }, i: number) => !mine.includes(i) && input.unlockingBytecode && hasPlaceholder(input.unlockingBytecode)).length;
  const outputs = decoded.outputs.map((o: { lockingBytecode: Uint8Array; valueSatoshis: bigint; token?: unknown }) => ({
    lockingBytecode: bytesToHex(o.lockingBytecode), valueSatoshis: o.valueSatoshis, mine: bytesToHex(o.lockingBytecode) === own, token: !!o.token,
  }));

  return {
    transaction, sourceOutputs, broadcast: revived.broadcast === true, userPrompt: typeof revived.userPrompt === 'string' ? revived.userPrompt.slice(0, 200) : undefined,
    mine, contractInputs,
    spent: mine.reduce((sum, i) => sum + BigInt(sourceOutputs[i].valueSatoshis), 0n),
    returned: outputs.filter((o: { mine: boolean }) => o.mine).reduce((sum: bigint, o: { valueSatoshis: bigint }) => sum + o.valueSatoshis, 0n),
    outputs, inputCount: decoded.inputs.length,
  };
}

/** A Solana signature arrives from the wallet module as hex; WalletConnect wants base58. */
export const solanaSignatureBase58 = (hexSignature: string) => base58(hexToBytes(hexSignature));
