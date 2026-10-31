/**
 * Typed message constants shared across the extension layers:
 * popup ↔ background ↔ content ↔ inpage
 *
 * The content and inpage scripts must stay self-contained (a content script cannot import a chunk), so they
 * repeat the few string constants they need. Keep them equal to the values here.
 */

export const MSG = {
  // inpage → content → background: dapp is requesting something
  DAPP_REQUEST: 'DAPP_REQUEST',
  // popup → background: user approved or rejected
  APPROVAL_RESULT: 'APPROVAL_RESULT',
  // background → content → inpage: result back to dapp
  DAPP_RESPONSE: 'DAPP_RESPONSE',
  // background → popup: session expired, lock the wallet
  WALLET_LOCKED: 'WALLET_LOCKED',
  // background → content → inpage: active account switched
  ACCOUNTS_CHANGED: 'ACCOUNTS_CHANGED',
  // background → content → inpage: chipnet/mainnet toggled
  NETWORK_CHANGED: 'NETWORK_CHANGED',
} as const;

export type MsgType = (typeof MSG)[keyof typeof MSG];

/** What a page sends. `origin` is filled in by the background from the sender, never trusted from the page. */
export interface DappRequest {
  requestId: string;
  origin: string;
  method: string;
  params?: unknown[];
}

/** A request waiting for the user, as the background stores it. */
export interface PendingRequest extends DappRequest {
  tabId: number;
  createdAt: number;
  /** The page's title and icon, for the approval screen. Display only. */
  title?: string;
  icon?: string;
}

export interface ApprovalResult {
  requestId: string;
  approved: boolean;
  result?: unknown;
  error?: string;
}

/** What goes back to the page. */
export interface DappResponse {
  requestId: string;
  approved: boolean;
  result?: unknown;
  error?: string;
  /** EIP-1193 style: 4001 rejected by the user, 4100 not connected, 4200 unsupported method, 4900 locked. */
  code?: number;
}

export const RPC_ERROR = {
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED: 4200,
  DISCONNECTED: 4900,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const;

/** Methods that need the user to approve each time. */
export const APPROVAL_METHODS = ['bch_requestAccounts', 'bch_sendTransaction', 'bch_signTransaction', 'personal_sign', 'bch_signMessage', 'wallet_signMessage', 'wallet_sendTransaction'] as const;
/** Methods answered by the background without asking. */
export const READ_METHODS = ['bch_accounts', 'bch_getNetwork', 'bch_getBalance', 'wallet_getAddresses', 'wallet_disconnect', 'bch_disconnect'] as const;

// ── storage keys the layers share ──
/** chrome.storage.session: PendingRequest[] */
export const QUEUE_KEY = 'dapp_queue';
/** chrome.storage.session: id of the window opened for approvals, if one is open */
export const APPROVAL_WINDOW_KEY = 'approval_window_id';
/** chrome.storage.local: Record<origin, ConnectedSite> */
export const SITES_KEY = 'connected_sites';
export const ACTIVE_ADDRESS_KEY = 'bch_active_address';
/** chrome.storage.local: { bch, evm, solana, btc } of the active account on the active network mode */
export const ADDRESSES_KEY = 'wallet_active_addresses';

/** The chain families a site can ask the wallet to sign for. */
export type SignChain = 'bch' | 'evm' | 'solana' | 'btc';
export const SIGN_CHAINS: SignChain[] = ['bch', 'evm', 'solana', 'btc'];
export const ACTIVE_BALANCE_KEY = 'bch_active_balance';
export const NETWORK_KEY = 'wdk_bch_network';

export interface ConnectedSite {
  origin: string;
  title?: string;
  icon?: string;
  connectedAt: number;
  lastUsedAt: number;
}

/** A request older than this was abandoned by its page. */
export const REQUEST_TTL_MS = 10 * 60_000;
