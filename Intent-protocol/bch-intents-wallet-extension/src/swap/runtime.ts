/**
 * Glue between the wallet's keys and the swap flows: builds the `deps` the flow modules take, and holds the
 * few things that are shared across screens (the server config, the signing journal).
 */

import type { ethers } from 'ethers';
import { swapServerApiFor, type SwapServerApi } from './api';
import { loadJournal, type Journal } from './journal';
import { evmSignerFor, sendEvmTx, signSolanaTx, toBase64 } from './signers';
import type { BridgeDeps, BridgeProgress } from './flows';
import { flushJournal } from './flows';
import type { CctpChain, SwapServerConfig } from './types';
import { keypairFrom } from '@/lib/solana';
import type { Signers } from '@/lib/send';

// ── config, cached briefly per server ──
const configCache = new Map<string, { at: number; config: SwapServerConfig }>();

export async function getSwapConfig(api: SwapServerApi, force = false): Promise<SwapServerConfig> {
  const hit = configCache.get(api.baseUrl);
  if (!force && hit && Date.now() - hit.at < 60_000) return hit.config;
  const config = await api.getConfig({ timeoutMs: 8000 });
  configCache.set(api.baseUrl, { at: Date.now(), config });
  return config;
}

// ── journal: one instance per wallet view ──
let journalPromise: Promise<Journal> | null = null;
export const getJournal = () => (journalPromise ??= loadJournal());

/** Everything the bridge flow needs from the wallet. */
export async function bridgeDeps(isMainnet: boolean, signers: Signers, onProgress?: (p: BridgeProgress) => void): Promise<BridgeDeps> {
  const api = swapServerApiFor(isMainnet);
  if (!api) throw new Error('The bridge is not available on this network.');
  const journal = await getJournal();
  return {
    api,
    journal,
    onProgress,
    evm: signers.evmSigner ? (chain: CctpChain) => {
      const signer = evmSignerFor(chain, signers.evmSigner as ethers.Signer);
      return { send: (tx, opts) => sendEvmTx(signer, tx, opts) };
    } : undefined,
    // Solana burns go out through the server: it forwards only the burn it built for this transfer.
    solana: signers.solanaSecretKey ? {
      sign: (base64Tx: string) => signSolanaTx(base64Tx, keypairFrom(signers.solanaSecretKey!)),
      send: async (raw: Uint8Array, transferId: string) => {
        const t = await api.broadcastBurn(transferId, toBase64(raw));
        if (!t.burnTxHash) throw new Error('The bridge did not confirm the transaction was sent.');
        return t.burnTxHash;
      },
    } : undefined,
    chainKnows: (src: CctpChain, hash: string) => api.chainKnowsTx(src.key, hash),
  };
}

/**
 * Report any transaction hash a previous session signed but could not report (the view was closed between
 * broadcasting and telling the server). Safe to call on every open; does nothing when the journal is empty.
 */
export async function recoverUnreported(isMainnet: boolean): Promise<number> {
  const api = swapServerApiFor(isMainnet);
  if (!api) return 0;
  const journal = await getJournal();
  if (!Object.keys(journal.all()).length) return 0;
  const config = await getSwapConfig(api).catch(() => undefined);
  return flushJournal(
    { api, journal, chainKnows: (src, hash) => api.chainKnowsTx(src.key, hash) },
    key => config?.cctp.chains.find(c => c.key === key),
  );
}

export const TRANSFER_DONE = ['COMPLETED', 'COMPLETED_EXTERNAL', 'FAILED', 'EXPIRED'];
