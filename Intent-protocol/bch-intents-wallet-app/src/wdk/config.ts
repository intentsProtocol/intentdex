/**
 * The configuration the WDK worklet is started with: one entry per network of the shared chain table.
 *
 * A network's key is its key in that table, in wdk.config.js (which module signs for it) and in every call the
 * app makes to the worklet. Both modes are registered at once, so switching between testnet and mainnet never
 * restarts the worklet.
 *
 * Accounts follow the wallets people already use, so one phrase gives the same addresses here, in the browser
 * extension and elsewhere:
 *   EVM      m/44'/60'/0'/0/N      MetaMask
 *   Solana   m/44'/501'/N'/0'      Phantom
 *   Bitcoin  m/84'/coin'/0'/0/N    native SegWit
 *   BCH      m/44'/0'/0'/0/N       the BCH Intents web app and extension (mainnet-js's default branch)
 */
import type { WdkConfigs } from '@tetherto/wdk-react-native-core';
import { NETWORKS, type NetworkDef } from '@bch-intents/wallet-core/chains';
import '@/lib/core-setup';
import { BCH_SERVERS, BTC_BLOCKBOOK } from '@/lib/config';

/** Coin type of the BCH branch. 0, not 145: see the note above and docs/internal/architecture.md. */
export const BCH_COIN_TYPE = 0;

function configFor(net: NetworkDef): Record<string, unknown> {
  switch (net.family) {
    case 'evm':
      // A fixed chain id keeps ethers from probing the network before every call.
      return { provider: net.rpc, chainId: net.chainId };
    case 'solana':
      return { provider: net.rpc, commitment: 'confirmed' };
    case 'btc':
      return {
        network: net.mode === 'mainnet' ? 'bitcoin' : 'testnet',
        client: { type: 'blockbook-http', clientConfig: { url: BTC_BLOCKBOOK[net.key as keyof typeof BTC_BLOCKBOOK] } },
      };
    case 'bch': {
      const servers = BCH_SERVERS[net.key as keyof typeof BCH_SERVERS];
      return {
        network: net.mode === 'mainnet' ? 'mainnet' : 'chipnet',
        coinType: BCH_COIN_TYPE,
        ...(servers?.length ? { servers } : {}),
      };
    }
  }
}

export const wdkConfigs: WdkConfigs = {
  networks: Object.fromEntries(NETWORKS.map(net => [net.key, { blockchain: net.key, config: configFor(net) }])),
};

export const DEFAULT_WALLET_ID = 'primary';

/** The derivation path of an account, for the Addresses screen. */
export function derivationPath(net: NetworkDef, index: number): string {
  switch (net.family) {
    case 'evm': return `m/44'/60'/0'/0/${index}`;
    case 'solana': return `m/44'/501'/${index}'/0'`;
    case 'btc': return `m/84'/${net.mode === 'mainnet' ? 0 : 1}'/0'/0/${index}`;
    case 'bch': return `m/44'/${BCH_COIN_TYPE}'/0'/0/${index}`;
  }
}
