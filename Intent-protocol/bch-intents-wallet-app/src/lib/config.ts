/**
 * What the build was given: service URLs and RPC overrides. All are EXPO_PUBLIC_ values, so they are compiled
 * into the app and are public. Expo replaces `process.env.EXPO_PUBLIC_X` only when it is written out in full,
 * which is why every variable is named here and none is looked up by a computed key.
 */
const clean = (v: string | undefined) => (v ?? '').trim().replace(/\/+$/, '');

export const SERVICES = {
  swapServerTestnet: clean(process.env.EXPO_PUBLIC_SWAP_SERVER_TESTNET),
  swapServerMainnet: clean(process.env.EXPO_PUBLIC_SWAP_SERVER_MAINNET),
  cashtokenRelayer: clean(process.env.EXPO_PUBLIC_CASHTOKEN_RELAYER),
  cashtokenRelayerMainnet: clean(process.env.EXPO_PUBLIC_CASHTOKEN_RELAYER_MAINNET),
  priceFeed: clean(process.env.EXPO_PUBLIC_PRICE_FEED),
};

export const REOWN_PROJECT_ID = (process.env.EXPO_PUBLIC_REOWN_PROJECT_ID ?? '').trim();

/** RPC URL per network key, where the build replaces the public default. */
export const RPC_OVERRIDES: Record<string, string | undefined> = {
  'eth-sepolia': process.env.EXPO_PUBLIC_RPC_ETH_SEPOLIA,
  'base-sepolia': process.env.EXPO_PUBLIC_RPC_BASE_SEPOLIA,
  'arb-sepolia': process.env.EXPO_PUBLIC_RPC_ARB_SEPOLIA,
  'op-sepolia': process.env.EXPO_PUBLIC_RPC_OP_SEPOLIA,
  'arc-testnet': process.env.EXPO_PUBLIC_RPC_ARC_TESTNET,
  ethereum: process.env.EXPO_PUBLIC_RPC_ETHEREUM,
  base: process.env.EXPO_PUBLIC_RPC_BASE,
  arbitrum: process.env.EXPO_PUBLIC_RPC_ARBITRUM,
  optimism: process.env.EXPO_PUBLIC_RPC_OPTIMISM,
  arc: process.env.EXPO_PUBLIC_RPC_ARC,
  'solana-devnet': process.env.EXPO_PUBLIC_RPC_SOLANA_DEVNET,
  solana: process.env.EXPO_PUBLIC_RPC_SOLANA,
};

/**
 * Bitcoin is read through a Blockbook server inside the wallet worklet (the transport WDK's own app uses on a
 * phone). The URL must end in /api.
 */
export const BTC_BLOCKBOOK: Record<'btc-testnet' | 'btc-mainnet', string> = {
  'btc-testnet': clean(process.env.EXPO_PUBLIC_RPC_BTC_TESTNET) || 'https://tbtc1.trezor.io/api',
  'btc-mainnet': clean(process.env.EXPO_PUBLIC_RPC_BTC_MAINNET) || 'https://btc1.trezor.io/api',
};

const list = (v: string | undefined) => (v ?? '').split(',').map(s => s.trim()).filter(Boolean);

/** Fulcrum WebSocket servers for Bitcoin Cash. Empty: the module's own public list. */
export const BCH_SERVERS: Record<'bch-chipnet' | 'bch-mainnet', string[]> = {
  'bch-chipnet': list(process.env.EXPO_PUBLIC_RPC_BCH_CHIPNET),
  'bch-mainnet': list(process.env.EXPO_PUBLIC_RPC_BCH_MAINNET),
};

export const DOCS_URL = 'https://github.com/tonybanks90';
