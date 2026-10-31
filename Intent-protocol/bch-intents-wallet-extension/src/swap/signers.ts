/**
 * Ported from frontend/src/swap-server/signers.ts; RPCs come from lib/chains.ts. The flows that use these
 * live in the shared package and reach them through its EvmSender and SolanaSender interfaces (see runtime.ts).
 *
 * Signing for the swap server's unsigned transactions with the in-app wallet.
 *
 * EVM: the transaction is signed first and its hash handed to the caller before anything is broadcast, so the
 * hash can be written down (see journal.ts). Fees follow the server's own sender: EIP-1559 with the chain's floor,
 * because Arc silently drops a transaction priced under 20 gwei.
 *
 * Solana: one path for both formats. The CCTP burn is a legacy transaction already signed by a second key; a
 * Jupiter swap is a v0 transaction. `VersionedTransaction` reads both and adds our signature in its slot.
 */
import { ethers } from 'ethers';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { getNetwork } from '@/lib/chains';
import { base58, fromBase64, toBase64 } from '@bch-intents/wallet-core/swap/encoding';
import type { SentEvmTx, SignedSolanaTx } from '@bch-intents/wallet-core/swap/flows';
import type { CctpChain, EvmBuiltTx } from './types';

export { base58, fromBase64, toBase64 };
export type { SentEvmTx, SignedSolanaTx };

const GWEI = 1_000_000_000n;

// ── EVM ──────────────────────────────────────────────────────────────────────

const providers = new Map<string, ethers.JsonRpcProvider>();

/** A provider for this CCTP chain. The network is fixed, so ethers does not probe it before every call. */
export function evmProvider(chain: CctpChain): ethers.JsonRpcProvider {
    const local = getNetwork(chain.key);
    if (!local || chain.kind !== 'evm' || !chain.chainId) throw new Error(`${chain.name} is not an EVM chain this app can sign for`);
    let p = providers.get(chain.key);
    if (!p) {
        p = new ethers.JsonRpcProvider(local.rpc, chain.chainId, { staticNetwork: true });
        providers.set(chain.key, p);
    }
    return p;
}

/** The in-app EVM wallet, connected to this chain. */
export function evmSignerFor(chain: CctpChain, wallet: ethers.Signer): ethers.Signer {
    return wallet.connect(evmProvider(chain));
}

export async function evmFees(provider: ethers.Provider, floorGwei?: number): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    const fd = await provider.getFeeData();
    const prio = fd.maxPriorityFeePerGas ?? GWEI;
    let max = fd.maxFeePerGas ?? (fd.gasPrice ? fd.gasPrice * 2n : 30n * GWEI);
    const floor = floorGwei ? BigInt(floorGwei) * GWEI : 0n;
    if (max < floor) max = floor;
    if (max < prio) max = prio;
    return { maxFeePerGas: max, maxPriorityFeePerGas: prio > max ? max : prio };
}

/**
 * Sign, hand the hash to `onHash`, then broadcast. `onHash` runs before the broadcast and is awaited.
 * estimateGas runs first, so a transaction that would revert is refused before it costs anything.
 */
export async function sendEvmTx(
    signer: ethers.Signer, tx: Pick<EvmBuiltTx, 'to' | 'data' | 'chainId' | 'minMaxFeePerGasGwei'>,
    opts: { onHash?: (hash: string) => void | Promise<void>; waitTimeoutMs?: number } = {},
): Promise<SentEvmTx> {
    const provider = signer.provider;
    if (!provider) throw new Error('the wallet is not connected to a network');
    const from = await signer.getAddress();
    const [gas, nonce, fees] = await Promise.all([
        provider.estimateGas({ to: tx.to, data: tx.data, from }),
        provider.getTransactionCount(from, 'pending'),
        evmFees(provider, tx.minMaxFeePerGasGwei),
    ]);
    const signed = await signer.signTransaction({
        to: tx.to, data: tx.data, value: 0n, chainId: tx.chainId, type: 2, nonce, gasLimit: (gas * 13n) / 10n, ...fees,
    });
    const hash = ethers.keccak256(signed);
    await opts.onHash?.(hash);
    await provider.broadcastTransaction(signed);
    return {
        hash,
        wait: async () => {
            const receipt = await provider.waitForTransaction(hash, 1, opts.waitTimeoutMs ?? 180_000);
            if (!receipt) throw new Error('the transaction was not confirmed in time');
            if (receipt.status !== 1) throw new Error('the transaction was reverted by the network');
        },
    };
}

const erc20 = new ethers.Interface(['function balanceOf(address owner) view returns (uint256)']);

/** USDC balance of an EVM address on a CCTP chain, in base units. */
export async function evmUsdcBalance(chain: CctpChain, owner: string): Promise<bigint> {
    const raw = await evmProvider(chain).call({ to: chain.usdc, data: erc20.encodeFunctionData('balanceOf', [owner]) });
    return BigInt(raw);
}

// ── Solana ───────────────────────────────────────────────────────────────────

/** Add the wallet's signature to a transaction the server built. Signatures already on it are kept. */
export function signSolanaTx(base64Tx: string, keypair: Keypair): SignedSolanaTx {
    const tx = VersionedTransaction.deserialize(fromBase64(base64Tx));
    const required = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
    if (!required.some(k => k.equals(keypair.publicKey))) throw new Error('this transaction is not for the connected Solana wallet');
    tx.sign([keypair]);
    return { raw: tx.serialize(), signature: base58(tx.signatures[0]), blockhash: tx.message.recentBlockhash };
}
