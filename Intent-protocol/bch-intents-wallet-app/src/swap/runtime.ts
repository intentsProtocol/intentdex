/**
 * Glue between the wallet worklet and the shared swap flows: builds the `deps` the flows take, and holds the
 * few things shared across screens (the server config, the signing journal).
 *
 * The flows are the same code the browser extension runs. What this module supplies is the signing: an EVM
 * transaction is filled in here and signed in the worklet (lib/evm.ts); a Solana transaction the server built
 * is signed in the worklet by its WDK account and put back into wire form here.
 */
import { getNetwork, networkOf, type NetworkMode } from '@bch-intents/wallet-core/chains';
import { swapServerApiFor, type SwapServerApi } from '@bch-intents/wallet-core/swap/api';
import { loadJournal, type Journal } from '@bch-intents/wallet-core/swap/journal';
import { flushJournal, type BridgeDeps, type BridgeProgress, type SignedSolanaTx } from '@bch-intents/wallet-core/swap/flows';
import { solanaTxFromWdk } from '@bch-intents/wallet-core/swap/solana-wire';
import { toBase64 } from '@bch-intents/wallet-core/swap/encoding';
import type { CctpChain, SwapServerConfig } from '@bch-intents/wallet-core/swap/types';
import { call } from '@/wdk/bridge';
import { evmSender } from '@/lib/evm';

// ── config, cached briefly per server ──
const configCache = new Map<string, { at: number; config: SwapServerConfig }>();

export async function getSwapConfig(api: SwapServerApi, force = false): Promise<SwapServerConfig> {
  const hit = configCache.get(api.baseUrl);
  if (!force && hit && Date.now() - hit.at < 60_000) return hit.config;
  const config = await api.getConfig({ timeoutMs: 8000 });
  configCache.set(api.baseUrl, { at: Date.now(), config });
  return config;
}

// ── journal: one instance for the app ──
let journalPromise: Promise<Journal> | null = null;
export const getJournal = () => (journalPromise ??= loadJournal());
export const forgetJournal = () => { journalPromise = null; };

/** Have the active account's Solana key sign a transaction the server built. */
export async function signSolana(mode: NetworkMode, accountIndex: number, base64Tx: string): Promise<SignedSolanaTx> {
  const net = networkOf(mode, 'solana');
  return solanaTxFromWdk(await call(net.key, accountIndex, 'signTransaction', base64Tx));
}

/** Everything the bridge flow needs from the wallet. */
export async function bridgeDeps(mode: NetworkMode, accountIndex: number, onProgress?: (p: BridgeProgress) => void): Promise<BridgeDeps> {
  const api = swapServerApiFor(mode === 'mainnet');
  if (!api) throw new Error('The bridge is not available on this network.');
  const journal = await getJournal();
  return {
    api,
    journal,
    onProgress,
    evm: (chain: CctpChain) => {
      const net = getNetwork(chain.key);
      if (!net || net.family !== 'evm' || net.mode !== mode) throw new Error(`${chain.name} is not an EVM chain this wallet can sign for`);
      return evmSender(net, accountIndex);
    },
    // Solana burns go out through the server: it forwards only the burn it built for this transfer.
    solana: {
      sign: (base64Tx: string) => signSolana(mode, accountIndex, base64Tx),
      send: async (raw: Uint8Array, transferId: string) => {
        const t = await api.broadcastBurn(transferId, toBase64(raw));
        if (!t.burnTxHash) throw new Error('The bridge did not confirm the transaction was sent.');
        return t.burnTxHash;
      },
    },
    chainKnows: (src: CctpChain, hash: string) => api.chainKnowsTx(src.key, hash),
  };
}

/**
 * Report any transaction hash a previous session signed but could not report (the app was closed between
 * broadcasting and telling the server). Safe to call on every open; does nothing when the journal is empty.
 */
export async function recoverUnreported(mode: NetworkMode): Promise<number> {
  const api = swapServerApiFor(mode === 'mainnet');
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
