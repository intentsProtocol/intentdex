/**
 * EVM transactions: the app fills in a transaction, the wallet worklet signs it, the app broadcasts it.
 *
 * The split is deliberate. The key stays in the worklet. Everything else happens here so that the hash of a
 * signed transaction is known, and can be written down, before the transaction is broadcast: the swap flows
 * rely on that to never sign a second burn (see the shared package's swap/flows.ts).
 *
 * Fees are EIP-1559 with the chain's floor, because Arc silently drops a transaction priced under 20 gwei.
 */
import type { NetworkDef } from '@bch-intents/wallet-core/chains';
import { encodeErc20BalanceOf, encodeErc20Transfer, evmTxHash } from '@bch-intents/wallet-core/swap/evm-calls';
import type { EvmSender, EvmTxRequest, SentEvmTx } from '@bch-intents/wallet-core/swap/flows';
import { addressOf, call } from '@/wdk/bridge';
import { feesFrom, type EvmFees } from './fees';
import { evmRpc, hex } from './rpc';

export { feesFrom, type EvmFees };


export async function evmFees(net: NetworkDef): Promise<EvmFees> {
  const node = evmRpc(net);
  const [baseFee, priority, gasPrice] = await Promise.all([
    node.baseFee().catch(() => null),
    node.priorityFee().catch(() => null),
    node.gasPrice().catch(() => null),
  ]);
  return feesFrom({ baseFee, priority, gasPrice }, net.minMaxFeePerGasGwei);
}

export const evmNativeBalance = (net: NetworkDef, owner: string) => evmRpc(net).balance(owner);

export async function erc20Balance(net: NetworkDef, token: string, owner: string): Promise<bigint> {
  const raw = await evmRpc(net).call({ to: token, data: encodeErc20BalanceOf(owner) });
  return raw && raw !== '0x' ? BigInt(raw) : 0n;
}

export async function waitEvm(net: NetworkDef, hash: string, timeoutMs = 180_000): Promise<'confirmed' | 'failed' | 'pending'> {
  const node = evmRpc(net);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await node.receipt(hash).catch(() => null);
    if (receipt) return receipt.status;
    await new Promise(r => setTimeout(r, 2500));
  }
  return 'pending';
}

interface Prepared { to: string; data: string; value: bigint; gasLimit: bigint; nonce: number; fees: EvmFees }

async function prepare(net: NetworkDef, from: string, tx: { to: string; data?: string; value?: bigint }): Promise<Prepared> {
  const node = evmRpc(net);
  const data = tx.data ?? '0x';
  const value = tx.value ?? 0n;
  // estimateGas runs the transaction against the chain's state: one that would revert is refused here, for free.
  const [gas, nonce, fees] = await Promise.all([
    node.estimateGas({ from, to: tx.to, data, value: hex(value) }),
    node.nonce(from),
    evmFees(net),
  ]);
  return { to: tx.to, data, value, gasLimit: data === '0x' ? gas : (gas * 13n) / 10n, nonce, fees };
}

/** Sign in the worklet. What crosses is JSON, so every number goes as a string. */
async function sign(net: NetworkDef, accountIndex: number, p: Prepared): Promise<string> {
  const signed = await call<string>(net.key, accountIndex, 'signTransaction', {
    to: p.to, data: p.data, value: p.value.toString(), chainId: net.chainId, type: 2, nonce: p.nonce,
    gasLimit: p.gasLimit.toString(), maxFeePerGas: p.fees.maxFeePerGas.toString(), maxPriorityFeePerGas: p.fees.maxPriorityFeePerGas.toString(),
  });
  if (typeof signed !== 'string' || !signed.startsWith('0x')) throw new Error('The wallet did not return a signed transaction.');
  return signed;
}

/** The wallet's account on one EVM network, in the shape the swap flows sign through. */
export function evmSender(net: NetworkDef, accountIndex: number): EvmSender {
  return {
    send: async (tx: EvmTxRequest & { value?: bigint }, opts = {}): Promise<SentEvmTx> => {
      if (tx.chainId !== net.chainId) throw new Error(`This transaction is for another network (chain ${tx.chainId}).`);
      const from = await addressOf(net.key, accountIndex);
      const signed = await sign(net, accountIndex, await prepare(net, from, { to: tx.to, data: tx.data, value: tx.value }));
      const hash = evmTxHash(signed);
      await opts.onHash?.(hash);
      await evmRpc(net).sendRaw(signed);
      return {
        hash,
        wait: async () => {
          const status = await waitEvm(net, hash, opts.waitTimeoutMs ?? 180_000);
          if (status === 'pending') throw new Error('the transaction was not confirmed in time');
          if (status === 'failed') throw new Error('the transaction was reverted by the network');
        },
      };
    },
  };
}

// ── plain sends ──────────────────────────────────────────────────────────────

export interface EvmSend { net: NetworkDef; from: string; to: string; amount: bigint; token?: string }

const callOf = (s: EvmSend) => (s.token
  ? { to: s.token, data: encodeErc20Transfer(s.to, s.amount), value: 0n }
  : { to: s.to, data: '0x', value: s.amount });

export interface EvmQuote { gasLimit: bigint; feeWei: bigint }

/** The network fee of a send, at the price the wallet would offer now. */
export async function quoteEvmSend(s: EvmSend): Promise<EvmQuote> {
  const node = evmRpc(s.net);
  const tx = callOf(s);
  const [gas, fees] = await Promise.all([
    // A plain transfer always costs 21,000; asking would fail for an amount the account cannot cover yet.
    s.token ? node.estimateGas({ from: s.from, to: tx.to, data: tx.data }).then(g => (g * 13n) / 10n).catch(() => 90_000n) : Promise.resolve(21_000n),
    evmFees(s.net),
  ]);
  return { gasLimit: gas, feeWei: gas * fees.maxFeePerGas };
}

export async function sendEvm(accountIndex: number, s: EvmSend): Promise<string> {
  const tx = callOf(s);
  const sent = await evmSender(s.net, accountIndex).send({ to: tx.to, data: tx.data, value: tx.value, chainId: s.net.chainId!, minMaxFeePerGasGwei: s.net.minMaxFeePerGasGwei } as EvmTxRequest & { value: bigint });
  return sent.hash;
}
