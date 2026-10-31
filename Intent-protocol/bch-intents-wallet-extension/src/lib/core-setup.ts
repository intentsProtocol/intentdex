/**
 * Tells the shared package where this host keeps things and which services it talks to.
 * Imported for its side effect, first, by every entry that uses the shared modules.
 */
import { configure } from '@bch-intents/wallet-core/platform';
import { extLocal } from '@/lib/ext-storage';
import {
  CASHTOKEN_RELAYER_MAINNET_URL, CASHTOKEN_RELAYER_URL, CCTP_SWAP_SERVER_MAINNET_URL, CCTP_SWAP_SERVER_URL, PRICE_FEED_URL,
} from '@/lib/config';

const env = import.meta.env as Record<string, string | undefined>;

configure({
  storage: extLocal,
  services: {
    swapServerTestnet: CCTP_SWAP_SERVER_URL,
    swapServerMainnet: CCTP_SWAP_SERVER_MAINNET_URL,
    cashtokenRelayer: CASHTOKEN_RELAYER_URL,
    cashtokenRelayerMainnet: CASHTOKEN_RELAYER_MAINNET_URL,
    priceFeed: PRICE_FEED_URL,
  },
  // Build-time RPC overrides, by network key. Unset ones keep the shared package's public defaults.
  rpc: {
    'eth-sepolia': env.VITE_ETH_SEPOLIA_RPC, 'base-sepolia': env.VITE_BASE_SEPOLIA_RPC, 'arb-sepolia': env.VITE_ARB_SEPOLIA_RPC,
    'op-sepolia': env.VITE_OP_SEPOLIA_RPC, 'arc-testnet': env.VITE_ARC_TESTNET_RPC,
    ethereum: env.VITE_ETH_MAINNET_RPC, base: env.VITE_BASE_MAINNET_RPC, arbitrum: env.VITE_ARB_MAINNET_RPC,
    optimism: env.VITE_OP_MAINNET_RPC, arc: env.VITE_ARC_MAINNET_RPC,
    'solana-devnet': env.VITE_SOLANA_DEVNET_RPC, solana: env.VITE_SOLANA_MAINNET_RPC,
    'btc-testnet': env.VITE_BTC_TESTNET_API, 'btc-mainnet': env.VITE_BTC_MAINNET_API,
  },
});
