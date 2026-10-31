/**
 * Build-time configuration: the two swap servers and the price feed.
 *
 * Every value is a VITE_ variable with a localhost default, the same names the frontend uses, so one .env works
 * for both. Set them when building a release (see docs/developers/configuration.md).
 */

const env = import.meta.env as Record<string, string | undefined>;

/** cctp-swap-server: cross-chain USDC (Circle CCTP) and Solana swaps (Jupiter). One instance per network. */
export const CCTP_SWAP_SERVER_URL: string = env.VITE_CCTP_SWAP_SERVER_URL || 'https://cctp-swap-server-production.up.railway.app';
/** The instance running with CCTP_NETWORK=mainnet. Empty: mainnet mode has no swap server. */
export const CCTP_SWAP_SERVER_MAINNET_URL: string = env.VITE_CCTP_SWAP_SERVER_MAINNET_URL || 'https://cctp-swap-server-production.up.railway.app';

/** cashtoken-relayer (deployed as "mesh server" on Railway): BCH ↔ CashToken intents. One instance serves both networks through a `network` field. */
export const CASHTOKEN_RELAYER_URL: string = env.VITE_CASHTOKEN_RELAYER_URL || 'https://meshserver-production.up.railway.app';
export const CASHTOKEN_RELAYER_MAINNET_URL: string = env.VITE_CASHTOKEN_RELAYER_MAINNET_URL || CASHTOKEN_RELAYER_URL;

/** Optional price feed (mesh server, GET /api/v1/prices). Without it prices come from CoinGecko's public API. */
export const PRICE_FEED_URL: string = env.VITE_MESH_SERVER_URL || 'https://meshserver-production.up.railway.app';

export const DOCS_URL = 'https://docs.intentsprotocol.xyz/';
export const SUPPORT_URL = 'https://docs.intentsprotocol.xyz/';

export const APP_VERSION: string = typeof chrome !== 'undefined' && chrome.runtime?.getManifest
  ? chrome.runtime.getManifest().version
  : '0.0.0';

export const swapServerUrl = (isMainnet: boolean) => (isMainnet ? CCTP_SWAP_SERVER_MAINNET_URL : CCTP_SWAP_SERVER_URL);
export const cashtokenRelayerUrl = (isMainnet: boolean) => (isMainnet ? CASHTOKEN_RELAYER_MAINNET_URL : CASHTOKEN_RELAYER_URL);
