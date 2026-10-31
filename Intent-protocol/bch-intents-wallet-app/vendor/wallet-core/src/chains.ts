/**
 * The networks the wallet knows, in one table.
 *
 * A network's `key` is the swap server's chain key wherever the server has one ('base-sepolia', 'solana'), so a
 * row here and a chain in the server's /config are the same thing without a mapping. BCH and BTC, which the
 * server does not know, get keys of the same shape.
 *
 * The wallet has one switch, testnet or mainnet, and every family follows it.
 */

/** The chain palette a network is drawn with. Each host maps these names to its own colours. */
export type ChainKey = 'bch' | 'eth' | 'bnb' | 'sol' | 'btc';

export type Family = 'bch' | 'evm' | 'solana' | 'btc';
export type NetworkMode = 'testnet' | 'mainnet';

export interface NativeAsset {
  symbol: string;
  name: string;
  decimals: number;
  /** Symbol the price feed knows it by. */
  priceSymbol: string;
  logo: string;
}

export interface NetworkDef {
  key: string;
  family: Family;
  mode: NetworkMode;
  name: string;
  /** Short label for badges: 'Base', 'Sepolia'. */
  short: string;
  /** Palette entry in the design system. */
  palette: ChainKey;
  logo: string;
  native: NativeAsset;
  /** EVM only. */
  chainId?: number;
  /** Public default; a host replaces it through configure({ rpc }). */
  rpc: string;
  /** USDC contract (EVM) or mint (Solana). On Arc, USDC is the native asset and this is its ERC-20 view. */
  usdc?: string;
  /** True on Arc: gas is paid in USDC, so there is no separate gas token to show or to run out of. */
  nativeIsUsdc?: boolean;
  /** Arc drops a transaction priced under this. */
  minMaxFeePerGasGwei?: number;
  explorerTx: string;      // '{tx}' placeholder
  explorerAddress: string; // '{address}' placeholder
  /** Where to get test funds. Testnets only. */
  faucet?: string;
}

const LOGO = {
  bch: '/logos/bitcoin-cash-bch-logo.svg',
  eth: '/logos/ethereum-eth-logo.svg',
  base: '/logos/Base_square_blue.svg',
  arb: '/logos/arbitrum-arb-logo.svg',
  op: '/logos/optimism.svg',
  arc: '/logos/arc.svg',
  sol: '/logos/solana.svg',
  btc: '/logos/bitcoin.svg',
  usdc: '/logos/usd-coin-usdc-logo.svg',
};
export const USDC_LOGO = LOGO.usdc;

const ETH: NativeAsset = { symbol: 'ETH', name: 'Ether', decimals: 18, priceSymbol: 'ETH', logo: LOGO.eth };
const ARC_USDC: NativeAsset = { symbol: 'USDC', name: 'USD Coin', decimals: 18, priceSymbol: 'USDC', logo: LOGO.usdc };
const SOL: NativeAsset = { symbol: 'SOL', name: 'Solana', decimals: 9, priceSymbol: 'SOL', logo: LOGO.sol };
const BCH: NativeAsset = { symbol: 'BCH', name: 'Bitcoin Cash', decimals: 8, priceSymbol: 'BCH', logo: LOGO.bch };
const BTC: NativeAsset = { symbol: 'BTC', name: 'Bitcoin', decimals: 8, priceSymbol: 'BTC', logo: LOGO.btc };

const evm = (
  key: string, mode: NetworkMode, name: string, short: string, chainId: number, rpc: string, usdc: string,
  explorer: string, logo: string, extra: Partial<NetworkDef> = {},
): NetworkDef => ({
  key, family: 'evm', mode, name, short, palette: 'eth', logo, native: ETH, chainId, rpc, usdc,
  explorerTx: `${explorer}/tx/{tx}`, explorerAddress: `${explorer}/address/{address}`,
  ...(mode === 'testnet' ? { faucet: 'https://faucet.circle.com' } : {}),
  ...extra,
});

export const NETWORKS: NetworkDef[] = [
  // ── Bitcoin Cash ──
  {
    key: 'bch-chipnet', family: 'bch', mode: 'testnet', name: 'Bitcoin Cash Chipnet', short: 'Chipnet', palette: 'bch', logo: LOGO.bch, native: BCH,
    rpc: '', explorerTx: 'https://chipnet.imaginary.cash/tx/{tx}', explorerAddress: 'https://chipnet.imaginary.cash/address/{address}',
    faucet: 'https://tbch.googol.cash',
  },
  {
    key: 'bch-mainnet', family: 'bch', mode: 'mainnet', name: 'Bitcoin Cash', short: 'BCH', palette: 'bch', logo: LOGO.bch, native: BCH,
    rpc: '', explorerTx: 'https://blockchair.com/bitcoin-cash/transaction/{tx}', explorerAddress: 'https://blockchair.com/bitcoin-cash/address/{address}',
  },

  // ── EVM testnets (the swap server's CCTP set) ──
  evm('eth-sepolia', 'testnet', 'Ethereum Sepolia', 'Sepolia', 11155111, 'https://ethereum-sepolia-rpc.publicnode.com',
    '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', 'https://sepolia.etherscan.io', LOGO.eth),
  evm('base-sepolia', 'testnet', 'Base Sepolia', 'Base', 84532, 'https://base-sepolia-rpc.publicnode.com',
    '0x036CbD53842c5426634e7929541eC2318f3dCF7e', 'https://sepolia.basescan.org', LOGO.base),
  evm('arb-sepolia', 'testnet', 'Arbitrum Sepolia', 'Arbitrum', 421614, 'https://arbitrum-sepolia-rpc.publicnode.com',
    '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', 'https://sepolia.arbiscan.io', LOGO.arb),
  evm('op-sepolia', 'testnet', 'OP Sepolia', 'Optimism', 11155420, 'https://optimism-sepolia-rpc.publicnode.com',
    '0x5fd84259d66Cd46123540766Be93DFE6D43130D7', 'https://sepolia-optimism.etherscan.io', LOGO.op),
  evm('arc-testnet', 'testnet', 'Arc Testnet', 'Arc', 5042002, 'https://rpc.testnet.arc.io',
    '0x3600000000000000000000000000000000000000', 'https://explorer.testnet.arc.io', LOGO.arc,
    { native: ARC_USDC, nativeIsUsdc: true, minMaxFeePerGasGwei: 20 }),

  // ── EVM mainnets ──
  evm('ethereum', 'mainnet', 'Ethereum', 'Ethereum', 1, 'https://ethereum-rpc.publicnode.com',
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'https://etherscan.io', LOGO.eth),
  evm('base', 'mainnet', 'Base', 'Base', 8453, 'https://base-rpc.publicnode.com',
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'https://basescan.org', LOGO.base),
  evm('arbitrum', 'mainnet', 'Arbitrum', 'Arbitrum', 42161, 'https://arbitrum-one-rpc.publicnode.com',
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 'https://arbiscan.io', LOGO.arb),
  evm('optimism', 'mainnet', 'OP Mainnet', 'Optimism', 10, 'https://optimism-rpc.publicnode.com',
    '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 'https://optimistic.etherscan.io', LOGO.op),
  evm('arc', 'mainnet', 'Arc', 'Arc', 5042, 'https://rpc.mainnet.arc.io',
    '0x3600000000000000000000000000000000000000', 'https://explorer.arc.io', LOGO.arc,
    { native: ARC_USDC, nativeIsUsdc: true, minMaxFeePerGasGwei: 20 }),

  // ── Solana ──
  {
    key: 'solana-devnet', family: 'solana', mode: 'testnet', name: 'Solana Devnet', short: 'Devnet', palette: 'sol', logo: LOGO.sol, native: SOL,
    rpc: 'https://api.devnet.solana.com', usdc: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    explorerTx: 'https://explorer.solana.com/tx/{tx}?cluster=devnet', explorerAddress: 'https://explorer.solana.com/address/{address}?cluster=devnet',
    faucet: 'https://faucet.solana.com',
  },
  {
    key: 'solana', family: 'solana', mode: 'mainnet', name: 'Solana', short: 'Solana', palette: 'sol', logo: LOGO.sol, native: SOL,
    // The public mainnet-beta endpoint refuses browser origins; publicnode does not.
    rpc: 'https://solana-rpc.publicnode.com', usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    explorerTx: 'https://explorer.solana.com/tx/{tx}', explorerAddress: 'https://explorer.solana.com/address/{address}',
  },

  // ── Bitcoin ──
  {
    key: 'btc-testnet', family: 'btc', mode: 'testnet', name: 'Bitcoin Testnet', short: 'Testnet', palette: 'btc', logo: LOGO.btc, native: BTC,
    rpc: 'https://blockstream.info/testnet/api',
    explorerTx: 'https://blockstream.info/testnet/tx/{tx}', explorerAddress: 'https://blockstream.info/testnet/address/{address}',
    faucet: 'https://coinfaucet.eu/en/btc-testnet/',
  },
  {
    key: 'btc-mainnet', family: 'btc', mode: 'mainnet', name: 'Bitcoin', short: 'Bitcoin', palette: 'btc', logo: LOGO.btc, native: BTC,
    rpc: 'https://blockstream.info/api',
    explorerTx: 'https://blockstream.info/tx/{tx}', explorerAddress: 'https://blockstream.info/address/{address}',
  },
];

const BY_KEY = new Map(NETWORKS.map(n => [n.key, n]));

export const getNetwork = (key: string): NetworkDef | undefined => BY_KEY.get(key);

export function requireNetwork(key: string): NetworkDef {
  const n = BY_KEY.get(key);
  if (!n) throw new Error(`Unknown network: ${key}`);
  return n;
}

export const networksFor = (mode: NetworkMode): NetworkDef[] => NETWORKS.filter(n => n.mode === mode);
export const networksOf = (mode: NetworkMode, family: Family): NetworkDef[] => NETWORKS.filter(n => n.mode === mode && n.family === family);
/** The one network of a single-network family (BCH, Solana, BTC) in this mode. */
export const networkOf = (mode: NetworkMode, family: Exclude<Family, 'evm'>): NetworkDef => networksOf(mode, family)[0];

export const explorerTxUrl = (n: NetworkDef, tx: string) => n.explorerTx.replace('{tx}', tx);
export const explorerAddressUrl = (n: NetworkDef, address: string) => n.explorerAddress.replace('{address}', address);

export const FAMILY_LABEL: Record<Family, string> = { bch: 'Bitcoin Cash', evm: 'Ethereum & EVM', solana: 'Solana', btc: 'Bitcoin' };
export const FAMILY_PALETTE: Record<Family, ChainKey> = { bch: 'bch', evm: 'eth', solana: 'sol', btc: 'btc' };
export const FAMILIES: Family[] = ['bch', 'evm', 'solana', 'btc'];
