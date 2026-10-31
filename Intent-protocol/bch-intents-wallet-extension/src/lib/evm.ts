/**
 * EVM reads and sends for the in-wallet key, on any network in lib/chains.ts.
 *
 * One provider per network, created on first use with a fixed chain id so ethers does not probe the RPC before
 * every call. Fees are EIP-1559 with the network's floor where it has one (Arc drops anything cheaper).
 */

import { ethers } from 'ethers';
import type { NetworkDef } from '@/lib/chains';

const GWEI = 1_000_000_000n;

const providers = new Map<string, ethers.JsonRpcProvider>();

export function evmProvider(net: NetworkDef): ethers.JsonRpcProvider {
  if (net.family !== 'evm' || !net.chainId) throw new Error(`${net.name} is not an EVM network`);
  let p = providers.get(net.key);
  if (!p) {
    p = new ethers.JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: true, batchMaxCount: 1 });
    providers.set(net.key, p);
  }
  return p;
}

export const erc20 = new ethers.Interface([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
]);

export async function evmNativeBalance(net: NetworkDef, owner: string): Promise<bigint> {
  return evmProvider(net).getBalance(owner);
}

export async function erc20Balance(net: NetworkDef, token: string, owner: string): Promise<bigint> {
  const raw = await evmProvider(net).call({ to: token, data: erc20.encodeFunctionData('balanceOf', [owner]) });
  return raw === '0x' ? 0n : BigInt(raw);
}

export async function evmFees(net: NetworkDef): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const fd = await evmProvider(net).getFeeData();
  const prio = fd.maxPriorityFeePerGas ?? GWEI;
  let max = fd.maxFeePerGas ?? (fd.gasPrice ? fd.gasPrice * 2n : 30n * GWEI);
  const floor = net.minMaxFeePerGasGwei ? BigInt(net.minMaxFeePerGasGwei) * GWEI : 0n;
  if (max < floor) max = floor;
  if (max < prio) max = prio;
  return { maxFeePerGas: max, maxPriorityFeePerGas: prio > max ? max : prio };
}

export interface EvmSend {
  net: NetworkDef;
  from: string;
  to: string;
  /** Base units of the asset being sent. */
  amount: bigint;
  /** ERC-20 contract; omit to send the native asset. */
  token?: string;
}

const txRequest = (s: EvmSend) => (s.token
  ? { from: s.from, to: s.token, data: erc20.encodeFunctionData('transfer', [s.to, s.amount]), value: 0n }
  : { from: s.from, to: s.to, value: s.amount });

export interface EvmQuote { gasLimit: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; feeWei: bigint }

/** The worst-case network fee of a send, in wei of the native asset. */
export async function quoteEvmSend(s: EvmSend): Promise<EvmQuote> {
  const provider = evmProvider(s.net);
  const fees = await evmFees(s.net);
  let gas: bigint;
  try {
    gas = await provider.estimateGas(txRequest(s));
  } catch (e) {
    // Estimating a native send of the whole balance fails for lack of gas money; a plain transfer is 21000.
    if (s.token) throw e;
    gas = 21_000n;
  }
  const gasLimit = s.token ? (gas * 13n) / 10n : gas;
  return { gasLimit, ...fees, feeWei: gasLimit * fees.maxFeePerGas };
}

/** Sign and broadcast. Resolves with the hash as soon as the network has accepted it. */
export async function sendEvm(wallet: ethers.Signer, s: EvmSend, quote?: EvmQuote): Promise<string> {
  const provider = evmProvider(s.net);
  const signer = wallet.connect(provider);
  const q = quote ?? (await quoteEvmSend(s));
  const nonce = await provider.getTransactionCount(s.from, 'pending');
  const req = txRequest(s);
  const signed = await signer.signTransaction({
    to: req.to, data: 'data' in req ? req.data : undefined, value: req.value,
    chainId: s.net.chainId, type: 2, nonce,
    gasLimit: q.gasLimit, maxFeePerGas: q.maxFeePerGas, maxPriorityFeePerGas: q.maxPriorityFeePerGas,
  });
  const sent = await provider.broadcastTransaction(signed);
  return sent.hash;
}

export async function waitEvm(net: NetworkDef, hash: string, timeoutMs = 180_000): Promise<'confirmed' | 'failed' | 'pending'> {
  try {
    const receipt = await evmProvider(net).waitForTransaction(hash, 1, timeoutMs);
    if (!receipt) return 'pending';
    return receipt.status === 1 ? 'confirmed' : 'failed';
  } catch {
    return 'pending';
  }
}

export const isEvmAddress = (a: string) => ethers.isAddress(a);
