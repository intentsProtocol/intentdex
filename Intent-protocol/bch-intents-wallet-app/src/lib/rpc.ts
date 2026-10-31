/**
 * JSON-RPC over fetch, for what the app reads itself: EVM and Solana balances, and the fields of an EVM
 * transaction it then asks the wallet worklet to sign.
 *
 * Reading needs no key, so it does not go through the worklet: the calls run in parallel here and a slow RPC
 * never holds up a signature. Bitcoin and Bitcoin Cash are read inside the worklet, where their wallet modules
 * keep the server connection.
 */
import type { NetworkDef } from '@bch-intents/wallet-core/chains';

export class RpcError extends Error {
  constructor(message: string, public code?: number, public data?: unknown) {
    super(message);
    this.name = 'RpcError';
  }
}

let nextId = 1;

export async function rpc<T>(url: string, method: string, params: unknown[] = [], timeoutMs = 15_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
      signal: ctrl.signal,
    });
  } catch {
    throw new RpcError('Network request failed');
  } finally {
    clearTimeout(timer);
  }
  const json = await res.json().catch(() => null);
  if (json?.error) throw new RpcError(String(json.error.message ?? 'The network refused the request'), json.error.code, json.error.data);
  if (!res.ok || !json || !('result' in json)) throw new RpcError(`The network answered ${res.status}`);
  return json.result as T;
}

export const hex = (value: bigint | number) => `0x${BigInt(value).toString(16)}`;
const big = (value: string | null | undefined) => (value ? BigInt(value) : 0n);

// ── EVM ──────────────────────────────────────────────────────────────────────

export interface EvmCall { from?: string; to: string; data?: string; value?: string }

export interface EvmReceipt { status: 'confirmed' | 'failed'; blockNumber: bigint }

export const evmRpc = (net: NetworkDef) => ({
  balance: async (owner: string) => big(await rpc<string>(net.rpc, 'eth_getBalance', [owner, 'latest'])),
  call: (tx: EvmCall) => rpc<string>(net.rpc, 'eth_call', [tx, 'latest']),
  nonce: async (owner: string) => Number(big(await rpc<string>(net.rpc, 'eth_getTransactionCount', [owner, 'pending']))),
  estimateGas: async (tx: EvmCall) => big(await rpc<string>(net.rpc, 'eth_estimateGas', [tx])),
  gasPrice: async () => big(await rpc<string>(net.rpc, 'eth_gasPrice')),
  /** The tip nodes suggest; not every chain implements the method. */
  priorityFee: async () => big(await rpc<string>(net.rpc, 'eth_maxPriorityFeePerGas')),
  baseFee: async () => {
    const block = await rpc<{ baseFeePerGas?: string } | null>(net.rpc, 'eth_getBlockByNumber', ['latest', false]);
    return block?.baseFeePerGas ? BigInt(block.baseFeePerGas) : null;
  },
  sendRaw: (signedTx: string) => rpc<string>(net.rpc, 'eth_sendRawTransaction', [signedTx], 30_000),
  receipt: async (hash: string): Promise<EvmReceipt | null> => {
    const r = await rpc<{ status?: string; blockNumber?: string } | null>(net.rpc, 'eth_getTransactionReceipt', [hash]);
    if (!r || !r.blockNumber) return null;
    return { status: big(r.status) === 1n ? 'confirmed' : 'failed', blockNumber: big(r.blockNumber) };
  },
});

// ── Solana ───────────────────────────────────────────────────────────────────

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export interface SplHolding { mint: string; amount: bigint; decimals: number }

export const solRpc = (net: NetworkDef) => ({
  balance: async (owner: string) => BigInt((await rpc<{ value: number }>(net.rpc, 'getBalance', [owner, { commitment: 'confirmed' }])).value),

  /** Every fungible token the owner holds, summed per mint, across both token programs. */
  holdings: async (owner: string): Promise<SplHolding[]> => {
    const byMint = new Map<string, SplHolding>();
    for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
      const res = await rpc<{ value: { account: { data: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string; decimals?: number } } } } } }[] }>(
        net.rpc, 'getTokenAccountsByOwner', [owner, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
      ).catch(() => null);
      for (const { account } of res?.value ?? []) {
        const info = account.data?.parsed?.info;
        const amount = BigInt(info?.tokenAmount?.amount ?? '0');
        const decimals = Number(info?.tokenAmount?.decimals ?? 0);
        if (!info?.mint || amount === 0n || (decimals === 0 && amount === 1n)) continue;   // empty, or an NFT
        const prev = byMint.get(info.mint);
        byMint.set(info.mint, { mint: info.mint, decimals, amount: (prev?.amount ?? 0n) + amount });
      }
    }
    return [...byMint.values()];
  },

  status: async (signature: string): Promise<'confirmed' | 'failed' | 'pending'> => {
    const res = await rpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>(net.rpc, 'getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
    const s = res.value?.[0];
    if (!s) return 'pending';
    if (s.err) return 'failed';
    return s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized' ? 'confirmed' : 'pending';
  },
});
