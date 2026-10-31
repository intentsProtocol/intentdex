/**
 * WDK Wallet Provider — Extension version
 *
 * The same logic as frontend/src/context/WDKProvider.tsx with these differences:
 *   1. Uses extLocal / extSession (chrome.storage) instead of localStorage / sessionStorage
 *   2. hasStoredWallet is async → stored as state on mount
 *   3. Accounts: account N is address index N on EVM, BCH and BTC (MetaMask's scheme; BCH on mainnet-js's default
 *      branch m/44'/0'/0'/0) and account N on Solana
 *      (Phantom's scheme), so each account matches the reference wallet of its chain
 *   4. Bitcoin is derived for both networks, through an Esplora (HTTPS) client
 *   5. Onboarding helpers (generatePhrase, setupWallet) and password management for the settings screen
 *
 * Derives EVM, Solana, BTC, BCH Chipnet, BCH Mainnet from one BIP-39 seed phrase.
 * Managers are cached in refs — call manager.getAccount(index) to switch accounts.
 */

import {
  createContext, useContext, useState, useCallback,
  useEffect, useMemo, useRef, type ReactNode,
} from 'react';
import { extLocal, extSession } from '@/lib/ext-storage';
import { encryptAndStore, decryptFromStorage, clearStoredWallet, hasStoredWallet } from '@/lib/crypto';
import {
  AccountStore, DEFAULT_STORE, GRAD_PALETTE,
  readAccountStore, writeAccountStore, clearAccountStore,
} from '@/lib/account-store';
import { EsploraClient } from '@/lib/btc-esplora';
import { networkOf, type NetworkMode } from '@/lib/chains';
import { getAutoLockMs } from '@/lib/settings';
import WalletManagerSolana from '@tetherto/wdk-wallet-solana';
import WalletManagerBtc from '@tetherto/wdk-wallet-btc';
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/signers';

export type BchNetwork = 'chipnet' | 'mainnet';

interface WDKWalletState {
  isInitialized: boolean;
  isLoading: boolean;
  /** False until the stored wallet and session have been checked on open. */
  isReady: boolean;
  seedPhrase: string | null;
  evmAddress: string | null;
  solanaAddress: string | null;
  btcAddress: string | null;
  btcMainnetAddress: string | null;
  bchChipnetAddress: string | null;
  bchMainnetAddress: string | null;
  bchNetwork: BchNetwork;
  evmSigner: any | null;
  solanaSigner: any | null;
  solanaAccount: any | null;
  solanaManager: any | null;
  btcAccount: any | null;
  btcManager: any | null;
  btcMainnetAccount: any | null;
  btcMainnetManager: any | null;
  bchChipnetWallet: any | null;
  bchMainnetWallet: any | null;
  evmBalance: string | null;
  solanaBalance: string | null;
  error: string | null;
}

interface WDKContextType extends WDKWalletState {
  bchAddress: string | null;
  bchWallet: any | null;
  setBchNetwork: (net: BchNetwork) => void;
  /** The wallet's one network switch; every chain family follows it. */
  networkMode: NetworkMode;
  isMainnet: boolean;
  setNetworkMode: (mode: NetworkMode) => void;
  /** The Bitcoin address and account on the active network. */
  activeBtcAddress: string | null;
  activeBtcAccount: any | null;
  createWallet: () => Promise<string>;
  importWallet: (seedPhrase: string) => Promise<void>;
  unlockWallet: (password: string) => Promise<boolean>;
  saveWallet: (password: string) => Promise<void>;
  generatePhrase: () => Promise<string>;
  /** Onboarding in one step: derive, encrypt with the password, start the session. */
  setupWallet: (seedPhrase: string, password: string) => Promise<void>;
  verifyPassword: (password: string) => Promise<boolean>;
  changePassword: (current: string, next: string) => Promise<boolean>;
  /** Remove the wallet from this browser. The recovery phrase is the only way back. */
  resetWallet: () => Promise<void>;
  disconnect: () => void;
  lock: () => void;
  refreshBalances: () => Promise<void>;
  hasStoredWallet: boolean;
  accountStore: AccountStore;
  switchAccount: (index: number) => Promise<void>;
  addAccount: () => Promise<void>;
  renameAccount: (index: number, label: string) => Promise<void>;
}

const WDKContext = createContext<WDKContextType | null>(null);

export function useWDK() {
  const ctx = useContext(WDKContext);
  if (!ctx) throw new Error('useWDK must be used within WDKProvider');
  return ctx;
}

async function generateSeedPhrase(): Promise<string> {
  const { default: WDK } = await import('@tetherto/wdk');
  const phrase = WDK.getRandomSeedPhrase();
  if (phrase && typeof phrase === 'string' && phrase.split(' ').length >= 12) return phrase;
  throw new Error('Failed to generate seed phrase');
}

/** Lower-cased, single-spaced, and checked for length. Throws a sentence the import screen can show. */
export function normalizePhrase(seedPhrase: string): string {
  const words = seedPhrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length !== 12 && words.length !== 24) throw new Error('Seed phrase must be 12 or 24 words');
  return words.join(' ');
}

async function deriveEvmWallet(seedPhrase: string, accountIndex = 0): Promise<any | null> {
  try {
    const { HDNodeWallet } = await import('ethers');
    // MetaMask's scheme: the account is the last number of the path, so account N here is account N there.
    return HDNodeWallet.fromPhrase(seedPhrase, undefined, `m/44'/60'/0'/0/${accountIndex}`);
  } catch (e: any) {
    console.warn('[WDK] EVM derivation failed:', e.message);
    return null;
  }
}

async function deriveSolanaSigner(
  seedPhrase: string,
  manager?: any,
  accountIndex = 0,
): Promise<{ signer: any; account: any; manager: any } | null> {
  try {
    const mgr = manager ?? new WalletManagerSolana(seedPhrase, {
      rpcUrl: 'https://api.devnet.solana.com',
      commitment: 'confirmed',
    });
    const account = await mgr.getAccount(accountIndex);
    const address = await account.getAddress();
    const privateKey = account.keyPair.privateKey;
    if (!privateKey) throw new Error('No private key derived');
    const baseSigner = await createKeyPairSignerFromPrivateKeyBytes(privateKey);
    const secretKey64 = new Uint8Array(64);
    secretKey64.set(privateKey, 0);
    secretKey64.set(account.keyPair.publicKey, 32);
    const signer = { ...baseSigner, address, secretKey: secretKey64 };
    return { signer, account, manager: mgr };
  } catch (e: any) {
    console.warn('[WDK] Solana derivation failed:', e.message);
    return null;
  }
}

/**
 * Bitcoin, through WDK with an Esplora (HTTPS) client: an extension page cannot open the raw sockets WDK's own
 * Electrum transports need. One manager per network, because the address format differs (tb1… / bc1…).
 */
async function deriveBtcSigner(
  seedPhrase: string,
  manager?: any,
  accountIndex = 0,
  mode: NetworkMode = 'testnet',
): Promise<{ account: any; manager: any; address: string } | null> {
  try {
    const client = new EsploraClient(networkOf(mode, 'btc').rpc);
    const mgr = manager ?? new WalletManagerBtc(seedPhrase, {
      client: client as any, network: mode === 'mainnet' ? 'bitcoin' : 'testnet', bip: 84,
    });
    const account = await mgr.getAccount(accountIndex);
    const address = await account.getAddress();
    return { account, manager: mgr, address };
  } catch (e: any) {
    console.warn(`[WDK] BTC ${mode} derivation failed:`, e.message);
    return null;
  }
}

async function deriveBchWallets(seedPhrase: string, accountIndex = 0) {
  let chipnetWallet: any = null;
  let mainnetWallet: any = null;
  let chipnetAddress: string | null = null;
  let mainnetAddress: string | null = null;

  // mainnet-js derives its default wallet at m/44'/0'/0'/0/0 (Bitcoin's coin type, not Bitcoin Cash's 145). That
  // is the address the frontend has always shown, so account 0 keeps it and account N is address N of the same
  // branch. wdk-wallet-bch reproduces this with `coinType: 0`.
  const path = accountIndex === 0 ? undefined : `m/44'/0'/0'/0/${accountIndex}`;

  try {
    const { TestNetWallet } = await import('mainnet-js');
    chipnetWallet = path
      ? await TestNetWallet.fromSeed(seedPhrase, path)
      : await TestNetWallet.fromSeed(seedPhrase);
    chipnetAddress = (chipnetWallet as any).cashaddr
      ?? await (chipnetWallet as any).getDepositAddress?.();
  } catch (e: any) {
    console.warn('[WDK] BCH Chipnet derivation failed:', e.message);
  }

  try {
    const { Wallet } = await import('mainnet-js');
    mainnetWallet = path
      ? await (Wallet as any).fromSeed(seedPhrase, path)
      : await (Wallet as any).fromSeed(seedPhrase);
    mainnetAddress = (mainnetWallet as any).cashaddr
      ?? await (mainnetWallet as any).getDepositAddress?.();
  } catch (e: any) {
    console.warn('[WDK] BCH Mainnet derivation failed:', e.message);
  }

  return { chipnetWallet, mainnetWallet, chipnetAddress, mainnetAddress };
}

interface Managers { sol?: any; btc?: any; btcMain?: any }

async function deriveForIndex(seedPhrase: string, accountIndex = 0, managers: Managers = {}) {
  const [evmSigner, solanaResult, btcResult, btcMainResult, bchResult] = await Promise.all([
    deriveEvmWallet(seedPhrase, accountIndex),
    deriveSolanaSigner(seedPhrase, managers.sol, accountIndex),
    deriveBtcSigner(seedPhrase, managers.btc, accountIndex, 'testnet'),
    deriveBtcSigner(seedPhrase, managers.btcMain, accountIndex, 'mainnet'),
    deriveBchWallets(seedPhrase, accountIndex),
  ]);
  return {
    evmSigner,
    solanaSigner: solanaResult?.signer ?? null,
    solanaAccount: solanaResult?.account ?? null,
    solanaManager: solanaResult?.manager ?? null,
    btcAccount: btcResult?.account ?? null,
    btcManager: btcResult?.manager ?? null,
    btcMainnetAccount: btcMainResult?.account ?? null,
    btcMainnetManager: btcMainResult?.manager ?? null,
    bchChipnetWallet: bchResult.chipnetWallet,
    bchMainnetWallet: bchResult.mainnetWallet,
    evmAddress: evmSigner?.address ?? null,
    solanaAddress: solanaResult?.signer?.address ?? null,
    btcAddress: btcResult?.address ?? null,
    btcMainnetAddress: btcMainResult?.address ?? null,
    bchChipnetAddress: bchResult.chipnetAddress,
    bchMainnetAddress: bchResult.mainnetAddress,
  };
}

type Derived = Awaited<ReturnType<typeof deriveForIndex>>;

const cacheEntry = (d: Derived) => ({
  eth: d.evmAddress ?? undefined,
  bch: d.bchChipnetAddress ?? d.bchMainnetAddress ?? undefined,
  sol: d.solanaAddress ?? undefined,
  btc: d.btcAddress ?? undefined,
});

const BCH_NETWORK_KEY = 'wdk_bch_network';
/** Used until the user's auto-lock setting has been read. */
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

const EMPTY_STATE: WDKWalletState = {
  isInitialized: false,
  isLoading: false,
  isReady: false,
  seedPhrase: null,
  evmAddress: null,
  solanaAddress: null,
  btcAddress: null,
  btcMainnetAddress: null,
  bchChipnetAddress: null,
  bchMainnetAddress: null,
  bchNetwork: 'chipnet',
  evmSigner: null,
  solanaSigner: null,
  solanaAccount: null,
  solanaManager: null,
  btcAccount: null,
  btcManager: null,
  btcMainnetAccount: null,
  btcMainnetManager: null,
  bchChipnetWallet: null,
  bchMainnetWallet: null,
  evmBalance: null,
  solanaBalance: null,
  error: null,
};

const readNetwork = async (): Promise<BchNetwork> =>
  ((await extLocal.getItem(BCH_NETWORK_KEY)) === 'mainnet' ? 'mainnet' : 'chipnet');

export function WDKProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WDKWalletState>(EMPTY_STATE);
  const [storedWalletExists, setStoredWalletExists] = useState(false);
  const [accountStore, setAccountStore] = useState<AccountStore>(DEFAULT_STORE);
  const solanaManagerRef = useRef<any>(null);
  const btcManagerRef = useRef<any>(null);
  const btcMainManagerRef = useRef<any>(null);

  const managers = (): Managers => ({ sol: solanaManagerRef.current, btc: btcManagerRef.current, btcMain: btcMainManagerRef.current });
  const keepManagers = (d: Derived) => {
    solanaManagerRef.current = d.solanaManager;
    btcManagerRef.current = d.btcManager;
    btcMainManagerRef.current = d.btcMainnetManager;
  };

  const startSession = async (phrase: string) => {
    await extSession.setItem('wdk_session_seed', phrase);
    await extSession.setItem('wdk_session_last_active', Date.now().toString());
  };

  // Check for stored wallet + restore session on mount
  useEffect(() => {
    const init = async () => {
      const store = await readAccountStore();
      setAccountStore(store);
      setStoredWalletExists(await hasStoredWallet());
      const net = await readNetwork();

      const storedSeed = await extSession.getItem('wdk_session_seed');
      const lastActive = await extSession.getItem('wdk_session_last_active');
      if (!storedSeed || !lastActive) { setState(s => ({ ...s, bchNetwork: net, isReady: true })); return; }

      const timeout = await getAutoLockMs().catch(() => SESSION_TIMEOUT_MS);
      if (Date.now() - parseInt(lastActive, 10) >= timeout) {
        await extSession.removeItem('wdk_session_seed');
        setState(s => ({ ...s, bchNetwork: net, isReady: true }));
        return;
      }

      setState(s => ({ ...s, isLoading: true, bchNetwork: net }));
      try {
        const derived = await deriveForIndex(storedSeed, store.active);
        keepManagers(derived);
        await extSession.setItem('wdk_session_last_active', Date.now().toString());
        setState(s => ({ ...s, isInitialized: true, isLoading: false, isReady: true, seedPhrase: storedSeed, bchNetwork: net, ...derived }));
      } catch {
        await extSession.removeItem('wdk_session_seed');
        setState(s => ({ ...s, isLoading: false, isReady: true }));
      }
    };
    init();
  }, []);

  // Auto-lock on inactivity (checked every 30s). The background worker runs the same check for when no view is open.
  useEffect(() => {
    if (!state.isInitialized) return;
    const interval = setInterval(async () => {
      const last = await extSession.getItem('wdk_session_last_active');
      const timeout = await getAutoLockMs().catch(() => SESSION_TIMEOUT_MS);
      if (!last || Date.now() - parseInt(last, 10) > timeout) {
        await extSession.removeItem('wdk_session_seed');
        await extSession.removeItem('wdk_session_last_active');
        setState(s => ({ ...EMPTY_STATE, isReady: true, bchNetwork: s.bchNetwork }));
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [state.isInitialized]);

  // Update last-active on user interaction (at most once every few seconds: storage writes are not free)
  useEffect(() => {
    if (!state.isInitialized) return;
    let lastWrite = 0;
    const update = () => {
      const now = Date.now();
      if (now - lastWrite < 5000) return;
      lastWrite = now;
      extSession.setItem('wdk_session_last_active', now.toString());
    };
    window.addEventListener('mousemove', update);
    window.addEventListener('keydown', update);
    window.addEventListener('click', update);
    return () => {
      window.removeEventListener('mousemove', update);
      window.removeEventListener('keydown', update);
      window.removeEventListener('click', update);
    };
  }, [state.isInitialized]);

  const freshStoreFor = (derived: Derived): AccountStore => ({
    indices: [0], active: 0,
    labels: { '0': 'Main' },
    grads: { '0': GRAD_PALETTE[0] },
    addressCache: { '0': cacheEntry(derived) },
  });

  const createWallet = useCallback(async (): Promise<string> => {
    setState(s => ({ ...s, isLoading: true, error: null }));
    try {
      const phrase = await generateSeedPhrase();
      const derived = await deriveForIndex(phrase, 0);
      keepManagers(derived);
      const freshStore = freshStoreFor(derived);
      await writeAccountStore(freshStore);
      setAccountStore(freshStore);
      await startSession(phrase);
      setState(s => ({ ...s, isInitialized: true, isLoading: false, seedPhrase: phrase, ...derived }));
      return phrase;
    } catch (e: any) {
      setState(s => ({ ...s, isLoading: false, error: e.message }));
      throw e;
    }
  }, []);

  const importWallet = useCallback(async (seedPhrase: string): Promise<void> => {
    setState(s => ({ ...s, isLoading: true, error: null }));
    try {
      const trimmed = normalizePhrase(seedPhrase);
      const derived = await deriveForIndex(trimmed, 0);
      keepManagers(derived);
      const freshStore = freshStoreFor(derived);
      await writeAccountStore(freshStore);
      setAccountStore(freshStore);
      await startSession(trimmed);
      setState(s => ({ ...s, isInitialized: true, isLoading: false, seedPhrase: trimmed, ...derived }));
    } catch (e: any) {
      setState(s => ({ ...s, isLoading: false, error: e.message }));
      throw e;
    }
  }, []);

  const generatePhrase = useCallback(() => generateSeedPhrase(), []);

  const setupWallet = useCallback(async (seedPhrase: string, password: string): Promise<void> => {
    if (password.length < 8) throw new Error('Password must be at least 8 characters');
    const phrase = normalizePhrase(seedPhrase);
    const derived = await deriveForIndex(phrase, 0);
    if (!derived.evmAddress && !derived.bchChipnetAddress && !derived.bchMainnetAddress) {
      throw new Error('This recovery phrase is not valid. Check each word and try again.');
    }
    keepManagers(derived);
    const freshStore = freshStoreFor(derived);
    await writeAccountStore(freshStore);
    setAccountStore(freshStore);
    await encryptAndStore(phrase, password);
    setStoredWalletExists(true);
    await startSession(phrase);
    setState(s => ({ ...s, isInitialized: true, isLoading: false, seedPhrase: phrase, error: null, ...derived }));
  }, []);

  const unlockWallet = useCallback(async (password: string): Promise<boolean> => {
    setState(s => ({ ...s, isLoading: true, error: null }));
    try {
      const phrase = await decryptFromStorage(password);
      if (!phrase) {
        setState(s => ({ ...s, isLoading: false, error: 'Wrong password' }));
        return false;
      }
      const store = await readAccountStore();
      const derived = await deriveForIndex(phrase, store.active);
      keepManagers(derived);
      const nextStore = { ...store, addressCache: { ...store.addressCache, [String(store.active)]: cacheEntry(derived) } };
      await writeAccountStore(nextStore);
      setAccountStore(nextStore);
      await startSession(phrase);
      setState(s => ({ ...s, isInitialized: true, isLoading: false, seedPhrase: phrase, ...derived }));
      return true;
    } catch (e: any) {
      setState(s => ({ ...s, isLoading: false, error: e.message }));
      return false;
    }
  }, []);

  const saveWallet = useCallback(async (password: string): Promise<void> => {
    if (!state.seedPhrase) throw new Error('No wallet to save');
    await encryptAndStore(state.seedPhrase, password);
    setStoredWalletExists(true);
  }, [state.seedPhrase]);

  const verifyPassword = useCallback(async (password: string): Promise<boolean> => {
    const phrase = await decryptFromStorage(password);
    return !!phrase;
  }, []);

  const changePassword = useCallback(async (current: string, next: string): Promise<boolean> => {
    if (next.length < 8) throw new Error('Password must be at least 8 characters');
    const phrase = await decryptFromStorage(current);
    if (!phrase) return false;
    await encryptAndStore(phrase, next);
    return true;
  }, []);

  const switchAccount = useCallback(async (index: number) => {
    if (!state.seedPhrase) return;
    setState(s => ({ ...s, isLoading: true }));
    try {
      const derived = await deriveForIndex(state.seedPhrase, index, managers());
      keepManagers(derived);
      const store = await readAccountStore();
      const nextStore = { ...store, active: index, addressCache: { ...store.addressCache, [String(index)]: cacheEntry(derived) } };
      await writeAccountStore(nextStore);
      setAccountStore(nextStore);
      setState(s => ({ ...s, isLoading: false, ...derived }));
    } catch (e: any) {
      setState(s => ({ ...s, isLoading: false, error: e.message }));
    }
  }, [state.seedPhrase]);

  const addAccount = useCallback(async () => {
    if (!state.seedPhrase) return;
    setState(s => ({ ...s, isLoading: true }));
    try {
      const store = await readAccountStore();
      const newIndex = store.indices.length;
      const derived = await deriveForIndex(state.seedPhrase, newIndex, managers());
      keepManagers(derived);
      const nextStore: AccountStore = {
        ...store,
        indices: [...store.indices, newIndex],
        active: newIndex,
        labels: { ...store.labels, [String(newIndex)]: `Account ${newIndex + 1}` },
        grads: { ...store.grads, [String(newIndex)]: GRAD_PALETTE[newIndex % GRAD_PALETTE.length] },
        addressCache: { ...store.addressCache, [String(newIndex)]: cacheEntry(derived) },
      };
      await writeAccountStore(nextStore);
      setAccountStore(nextStore);
      setState(s => ({ ...s, isLoading: false, ...derived }));
    } catch (e: any) {
      setState(s => ({ ...s, isLoading: false, error: e.message }));
    }
  }, [state.seedPhrase]);

  const renameAccount = useCallback(async (index: number, label: string) => {
    const store = await readAccountStore();
    const nextStore = { ...store, labels: { ...store.labels, [String(index)]: label } };
    await writeAccountStore(nextStore);
    setAccountStore(nextStore);
  }, []);

  const setBchNetwork = useCallback((net: BchNetwork) => {
    extLocal.setItem(BCH_NETWORK_KEY, net);
    setState(s => ({ ...s, bchNetwork: net }));
  }, []);

  const setNetworkMode = useCallback((mode: NetworkMode) => {
    setBchNetwork(mode === 'mainnet' ? 'mainnet' : 'chipnet');
  }, [setBchNetwork]);

  const disconnect = useCallback(async () => {
    try { state.solanaAccount?.dispose?.(); } catch {}
    try { solanaManagerRef.current?.dispose?.(); } catch {}
    solanaManagerRef.current = null;
    btcManagerRef.current = null;
    btcMainManagerRef.current = null;
    await extSession.removeItem('wdk_session_seed');
    await extSession.removeItem('wdk_session_last_active');
    setState(s => ({ ...EMPTY_STATE, isReady: true, bchNetwork: s.bchNetwork }));
  }, [state.solanaAccount]);

  const resetWallet = useCallback(async () => {
    await disconnect();
    await clearStoredWallet();
    await clearAccountStore();
    await chrome.storage.local.remove(['bch_active_address', 'wallet_active_addresses', 'bch_active_balance', 'connected_sites', 'wallet_activity_v1']);
    setAccountStore(DEFAULT_STORE);
    setStoredWalletExists(false);
  }, [disconnect]);

  const refreshBalances = useCallback(async () => {}, []);

  const { bchAddress, bchWallet } = useMemo(() => ({
    bchAddress: state.bchNetwork === 'chipnet' ? state.bchChipnetAddress : state.bchMainnetAddress,
    bchWallet:  state.bchNetwork === 'chipnet' ? state.bchChipnetWallet  : state.bchMainnetWallet,
  }), [state.bchNetwork, state.bchChipnetAddress, state.bchMainnetAddress, state.bchChipnetWallet, state.bchMainnetWallet]);

  const isMainnet = state.bchNetwork === 'mainnet';

  // Sync the active address to chrome.storage.local: the background worker answers read-only dapp requests from
  // there and tells connected sites when it changes. It stays there while the wallet is locked (an address is
  // public, and a connected site keeps seeing its account), and goes when the wallet is removed.
  useEffect(() => {
    if (bchAddress) chrome.storage.local.set({ bch_active_address: bchAddress });
  }, [bchAddress]);

  // Every chain's address of the active account, for wallet_getAddresses.
  const activeBtc = isMainnet ? state.btcMainnetAddress : state.btcAddress;
  useEffect(() => {
    if (!bchAddress && !state.evmAddress) return;
    chrome.storage.local.set({ wallet_active_addresses: { bch: bchAddress, evm: state.evmAddress, solana: state.solanaAddress, btc: activeBtc } });
  }, [bchAddress, state.evmAddress, state.solanaAddress, activeBtc]);

  // Follow a network change made in another open view (side panel and an approval window, say).
  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes[BCH_NETWORK_KEY]) return;
      const net: BchNetwork = changes[BCH_NETWORK_KEY].newValue === 'mainnet' ? 'mainnet' : 'chipnet';
      setState(s => (s.bchNetwork === net ? s : { ...s, bchNetwork: net }));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  return (
    <WDKContext.Provider value={{
      ...state,
      bchAddress,
      bchWallet,
      setBchNetwork,
      networkMode: isMainnet ? 'mainnet' : 'testnet',
      isMainnet,
      setNetworkMode,
      activeBtcAddress: isMainnet ? state.btcMainnetAddress : state.btcAddress,
      activeBtcAccount: isMainnet ? state.btcMainnetAccount : state.btcAccount,
      createWallet,
      importWallet,
      unlockWallet,
      saveWallet,
      generatePhrase,
      setupWallet,
      verifyPassword,
      changePassword,
      resetWallet,
      disconnect,
      lock: disconnect,
      refreshBalances,
      hasStoredWallet: storedWalletExists,
      accountStore,
      switchAccount,
      addAccount,
      renameAccount,
    }}>
      {children}
    </WDKContext.Provider>
  );
}
