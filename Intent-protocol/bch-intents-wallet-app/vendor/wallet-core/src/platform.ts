/**
 * What a host (the browser extension, the mobile app, a test) gives this package: where to keep small records,
 * and which services to talk to. Call `configure()` once at start-up, before using anything else.
 *
 * Nothing here reads build variables or touches a platform API: that is the host's job.
 */

import { NETWORKS } from './chains';

/** A string key-value store. chrome.storage.local, MMKV and a Map all fit. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface ServiceUrls {
  /** cctp-swap-server instance running with CCTP_NETWORK=testnet. */
  swapServerTestnet: string;
  /** The mainnet instance. Empty: mainnet mode has no swap server. */
  swapServerMainnet: string;
  /** cashtoken-relayer; one instance serves both networks. */
  cashtokenRelayer: string;
  cashtokenRelayerMainnet: string;
  /** Optional mesh price feed (GET /api/v1/prices). Empty: CoinGecko's public API. */
  priceFeed: string;
  /** Mesh server (chipnet) for V4 position NFTs (GET /api/v1/v4/*). Empty: positions render from the NFT alone. */
  meshServer: string;
  /** The mainnet Mesh server. Empty: no live position data on mainnet. */
  meshServerMainnet: string;
}

export interface HostConfig {
  storage: KeyValueStore;
  services?: Partial<ServiceUrls>;
  /** RPC (or, for Bitcoin, Esplora) URL per network key, replacing the public default. */
  rpc?: Record<string, string | undefined>;
}

const DEFAULT_SERVICES: ServiceUrls = {
  swapServerTestnet: 'http://localhost:3012',
  swapServerMainnet: 'http://localhost:3013',
  cashtokenRelayer: 'http://localhost:3001',
  cashtokenRelayerMainnet: '',
  priceFeed: '',
  meshServer: 'http://localhost:3001',
  meshServerMainnet: '',
};

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: async k => map.get(k) ?? null,
    setItem: async (k, v) => { map.set(k, v); },
    removeItem: async k => { map.delete(k); },
  };
}

let current: { storage: KeyValueStore; services: ServiceUrls } = { storage: memoryStore(), services: { ...DEFAULT_SERVICES } };

export function configure(config: HostConfig): void {
  const given = Object.fromEntries(Object.entries(config.services ?? {}).filter(([, v]) => typeof v === 'string')) as Partial<ServiceUrls>;
  const services = { ...DEFAULT_SERVICES, ...given };
  if (!services.cashtokenRelayerMainnet) services.cashtokenRelayerMainnet = services.cashtokenRelayer;
  current = { storage: config.storage, services };
  for (const net of NETWORKS) {
    const url = config.rpc?.[net.key];
    if (url) net.rpc = url;
  }
}

/** The host's store. An in-memory one until `configure()` is called, so tests need no setup. */
export const storage = (): KeyValueStore => current.storage;
export const services = (): ServiceUrls => current.services;

export const swapServerUrl = (isMainnet: boolean) => (isMainnet ? current.services.swapServerMainnet : current.services.swapServerTestnet);
export const cashtokenRelayerUrl = (isMainnet: boolean) => (isMainnet ? current.services.cashtokenRelayerMainnet : current.services.cashtokenRelayer);
export const meshServerUrl = (isMainnet: boolean) => (isMainnet ? current.services.meshServerMainnet : current.services.meshServer);
