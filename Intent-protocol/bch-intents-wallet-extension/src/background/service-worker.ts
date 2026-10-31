/**
 * Background service worker (MV3)
 *
 * Responsibilities:
 *   - Decide where the toolbar icon opens the wallet: the docked side panel (default) or the popup
 *   - Open onboarding in a tab on first install
 *   - Route dapp requests: answer read-only ones from storage, queue the rest for the user's approval
 *   - Send approval results back to the tab that asked
 *   - Tell connected sites when the account or network changes
 *   - Lock the wallet after inactivity, also when no wallet view is open
 *
 * The worker can be stopped at any moment, so nothing lives in a variable: the request queue is in
 * chrome.storage.session and every listener is registered at the top level.
 *
 * Never import mainnet-js, WDK or React here.
 */

import {
  MSG, RPC_ERROR, APPROVAL_WINDOW_KEY, SITES_KEY, ACTIVE_ADDRESS_KEY, ADDRESSES_KEY, ACTIVE_BALANCE_KEY, NETWORK_KEY,
  type ApprovalResult, type ConnectedSite, type DappRequest, type DappResponse, type PendingRequest,
} from '../shared/messages';
import { connectSite, disconnectSite, isConnected, readQueue, readSites, touchSite, writeQueue } from '../lib/dapp';

const SETTINGS_KEY = 'wallet_settings_v1';
const UI_PATH = 'src/popup/index.html';
const AUTOLOCK_ALARM = 'autolock';

// ── where the icon opens the wallet ──────────────────────────────────────────

async function readSurface(): Promise<'panel' | 'popup'> {
  try {
    const raw = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
    const surface = raw ? JSON.parse(raw).surface : undefined;
    return surface === 'popup' ? 'popup' : 'panel';
  } catch {
    return 'panel';
  }
}

/**
 * Side panel: the action has no popup, and Chrome opens the panel on click.
 * Popup: the action gets its popup back. A browser without the sidePanel API (Firefox) always uses the popup.
 */
async function applySurface(): Promise<void> {
  const surface = chrome.sidePanel ? await readSurface() : 'popup';
  if (surface === 'panel') {
    await chrome.action.setPopup({ popup: '' });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  } else {
    await chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
    await chrome.action.setPopup({ popup: `${UI_PATH}?surface=popup` });
  }
}

chrome.runtime.onInstalled.addListener(async details => {
  await applySurface();
  chrome.alarms.create(AUTOLOCK_ALARM, { periodInMinutes: 1 });
  if (details.reason === 'install') {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`${UI_PATH}?surface=tab`) });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await applySurface();
  chrome.alarms.create(AUTOLOCK_ALARM, { periodInMinutes: 1 });
});

// ── auto-lock ────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== AUTOLOCK_ALARM) return;
  const session = await chrome.storage.session.get(['wdk_session_seed', 'wdk_session_last_active']);
  if (!session.wdk_session_seed) return;
  let minutes = 15;
  try {
    const raw = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
    const m = raw ? Number(JSON.parse(raw).autoLockMinutes) : NaN;
    if ([5, 15, 30, 60].includes(m)) minutes = m;
  } catch { /* default */ }
  const last = parseInt(session.wdk_session_last_active ?? '0', 10);
  if (Date.now() - last > minutes * 60_000) {
    await chrome.storage.session.remove(['wdk_session_seed', 'wdk_session_last_active']);
    chrome.runtime.sendMessage({ type: MSG.WALLET_LOCKED }).catch(() => { /* no view open */ });
  }
});

// ── replies to pages ─────────────────────────────────────────────────────────

function reply(tabId: number, response: DappResponse): void {
  if (tabId < 0) return;
  chrome.tabs.sendMessage(tabId, { type: MSG.DAPP_RESPONSE, payload: response }).catch(() => { /* the tab is gone */ });
}

const ok = (requestId: string, result: unknown): DappResponse => ({ requestId, approved: true, result });
const fail = (requestId: string, code: number, error: string): DappResponse => ({ requestId, approved: false, code, error });

async function broadcastToSites(message: object, onlyOrigin?: string): Promise<void> {
  const sites = await readSites();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    let origin: string;
    try { origin = new URL(tab.url).origin; } catch { continue; }
    if (onlyOrigin ? origin !== onlyOrigin : !(origin in sites)) continue;
    chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}

// ── request routing ──────────────────────────────────────────────────────────

async function activeAddress(): Promise<string | null> {
  return (await chrome.storage.local.get(ACTIVE_ADDRESS_KEY))[ACTIVE_ADDRESS_KEY] ?? null;
}

async function activeNetwork(): Promise<'chipnet' | 'mainnet'> {
  return (await chrome.storage.local.get(NETWORK_KEY))[NETWORK_KEY] === 'mainnet' ? 'mainnet' : 'chipnet';
}

async function openApprovalUi(): Promise<void> {
  // A wallet view that is already open (the side panel, usually) shows the request by itself.
  const views = await chrome.runtime.getContexts?.({ contextTypes: ['SIDE_PANEL', 'POPUP', 'TAB'] as chrome.runtime.ContextType[] }).catch(() => []) ?? [];
  const stored = (await chrome.storage.session.get(APPROVAL_WINDOW_KEY))[APPROVAL_WINDOW_KEY] as number | undefined;
  if (stored !== undefined) {
    const existing = await chrome.windows.get(stored).catch(() => null);
    if (existing) { await chrome.windows.update(stored, { focused: true }).catch(() => {}); return; }
  }
  if (views.some(v => v.contextType === 'SIDE_PANEL' || v.contextType === 'POPUP')) return;

  const current = await chrome.windows.getLastFocused().catch(() => null);
  const width = 380, height = 640;
  const url = chrome.runtime.getURL(`${UI_PATH}?surface=popup&approval=1`);
  // Placed at the top right of the browser window. Chrome refuses a position that is mostly off the visible
  // screen (a window dragged half off it, some multi-monitor layouts) and throws: then it picks the place itself.
  // Without this the request would wait, unseen, until it timed out.
  const win = await chrome.windows.create({
    url, type: 'popup', width, height,
    left: current?.left !== undefined && current.width ? Math.max(0, current.left + current.width - width - 24) : undefined,
    top: current?.top !== undefined ? current.top + 72 : undefined,
  }).catch(() => chrome.windows.create({ url, type: 'popup', width, height }));
  if (win?.id !== undefined) await chrome.storage.session.set({ [APPROVAL_WINDOW_KEY]: win.id });
}

/**
 * Every change to the queue goes through this chain. Reading and writing storage are separate awaits, so two
 * requests arriving together would otherwise both read the same queue and the second write would drop the first.
 */
let queueLock: Promise<unknown> = Promise.resolve();
function withQueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueLock.then(fn, fn);
  queueLock = run.catch(() => {});
  return run;
}

async function enqueue(request: PendingRequest): Promise<void> {
  const queue = await withQueue(async () => {
    const next = [...(await readQueue()), request];
    await writeQueue(next);
    return next.slice(0, -1);
  });
  await chrome.action.setBadgeBackgroundColor({ color: '#00d26a' }).catch(() => {});
  await chrome.action.setBadgeText({ text: String(queue.length + 1) }).catch(() => {});
  // Serialised too: two requests arriving together must open one approval window, not two.
  await withQueue(openApprovalUi);
}

async function handleDappRequest(raw: DappRequest, sender: chrome.runtime.MessageSender): Promise<void> {
  const tabId = sender.tab?.id ?? -1;
  const requestId = String(raw?.requestId ?? '');
  // The origin comes from the browser, never from the page.
  let origin = sender.origin ?? '';
  if (!origin && sender.tab?.url) { try { origin = new URL(sender.tab.url).origin; } catch { /* leave empty */ } }
  if (!requestId || !origin || tabId < 0) return;

  const method = String(raw.method ?? '');
  const params = Array.isArray(raw.params) ? raw.params : [];
  const connected = await isConnected(origin);

  switch (method) {
    case 'bch_getNetwork':
      return reply(tabId, ok(requestId, await activeNetwork()));

    case 'bch_accounts': {
      const address = connected ? await activeAddress() : null;
      return reply(tabId, ok(requestId, address ? [address] : []));
    }

    case 'bch_getBalance': {
      if (!connected) return reply(tabId, fail(requestId, RPC_ERROR.UNAUTHORIZED, 'This site is not connected. Call bch_requestAccounts first.'));
      const satoshis = Number((await chrome.storage.local.get(ACTIVE_BALANCE_KEY))[ACTIVE_BALANCE_KEY] ?? 0);
      return reply(tabId, ok(requestId, { satoshis }));
    }

    case 'wallet_getAddresses': {
      if (!connected) return reply(tabId, fail(requestId, RPC_ERROR.UNAUTHORIZED, 'This site is not connected. Call bch_requestAccounts first.'));
      const addresses = (await chrome.storage.local.get(ADDRESSES_KEY))[ADDRESSES_KEY] ?? {};
      return reply(tabId, ok(requestId, { bch: addresses.bch ?? null, evm: addresses.evm ?? null, solana: addresses.solana ?? null, btc: addresses.btc ?? null, network: await activeNetwork() === 'mainnet' ? 'mainnet' : 'testnet' }));
    }

    case 'wallet_disconnect':
    case 'bch_disconnect':
      await disconnectSite(origin);
      return reply(tabId, ok(requestId, true));

    case 'bch_requestAccounts': {
      const address = await activeAddress();
      if (connected && address) {
        await touchSite(origin);
        return reply(tabId, ok(requestId, [address]));
      }
      break;
    }

    case 'bch_sendTransaction':
    case 'bch_signTransaction':
    case 'personal_sign':
    case 'bch_signMessage':
    case 'wallet_signMessage':
    case 'wallet_sendTransaction':
      if (!connected) return reply(tabId, fail(requestId, RPC_ERROR.UNAUTHORIZED, 'This site is not connected. Call bch_requestAccounts first.'));
      if (!params.length) return reply(tabId, fail(requestId, RPC_ERROR.INVALID_PARAMS, `${method} needs parameters.`));
      break;

    default:
      return reply(tabId, fail(requestId, RPC_ERROR.UNSUPPORTED, `Unsupported method: ${method}`));
  }

  await enqueue({
    requestId, origin, method, params, tabId, createdAt: Date.now(),
    title: sender.tab?.title, icon: sender.tab?.favIconUrl,
  });
}

async function handleApprovalResult(result: ApprovalResult): Promise<void> {
  const { request, rest } = await withQueue(async () => {
    const queue = await readQueue();
    const found = queue.find(r => r.requestId === result.requestId);
    const remaining = queue.filter(r => r.requestId !== result.requestId);
    if (found) await writeQueue(remaining);
    return { request: found, rest: remaining };
  });
  if (!request) return;
  await chrome.action.setBadgeText({ text: rest.length ? String(rest.length) : '' }).catch(() => {});

  if (result.approved) {
    if (request.method === 'bch_requestAccounts') {
      const site: Pick<ConnectedSite, 'origin' | 'title' | 'icon'> = { origin: request.origin, title: request.title, icon: request.icon };
      await connectSite(site);
    } else {
      await touchSite(request.origin);
    }
    reply(request.tabId, ok(request.requestId, result.result));
  } else {
    reply(request.tabId, fail(request.requestId, RPC_ERROR.USER_REJECTED, result.error ?? 'User rejected the request'));
  }

  // Nothing left to decide: close the window this worker opened for it.
  if (!rest.length) {
    const id = (await chrome.storage.session.get(APPROVAL_WINDOW_KEY))[APPROVAL_WINDOW_KEY] as number | undefined;
    if (id !== undefined) {
      await chrome.storage.session.remove(APPROVAL_WINDOW_KEY);
      await chrome.windows.remove(id).catch(() => {});
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === MSG.DAPP_REQUEST) {
    handleDappRequest(message.request as DappRequest, sender).catch(e => console.error('[bg] request failed', e));
    sendResponse({ received: true });
    return false;
  }
  // Only the wallet's own pages may answer a request.
  if (sender.id !== chrome.runtime.id || sender.tab?.url?.startsWith('http')) return false;

  if (message?.type === MSG.APPROVAL_RESULT) {
    handleApprovalResult(message.result as ApprovalResult).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

// The user closed the approval window without deciding: that is a rejection of everything in it.
chrome.windows.onRemoved.addListener(async windowId => {
  const id = (await chrome.storage.session.get(APPROVAL_WINDOW_KEY))[APPROVAL_WINDOW_KEY];
  if (id !== windowId) return;
  await chrome.storage.session.remove(APPROVAL_WINDOW_KEY);
  const queue = await withQueue(async () => { const all = await readQueue(); await writeQueue([]); return all; });
  await chrome.action.setBadgeText({ text: '' }).catch(() => {});
  for (const r of queue) reply(r.tabId, fail(r.requestId, RPC_ERROR.USER_REJECTED, 'User rejected the request'));
});

// ── events to connected sites ────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[SETTINGS_KEY]) applySurface();
  if (changes[ACTIVE_ADDRESS_KEY]) {
    const address = changes[ACTIVE_ADDRESS_KEY].newValue as string | undefined;
    broadcastToSites({ type: MSG.ACCOUNTS_CHANGED, addresses: address ? [address] : [] });
  }
  if (changes[NETWORK_KEY]) {
    broadcastToSites({ type: MSG.NETWORK_CHANGED, network: changes[NETWORK_KEY].newValue === 'mainnet' ? 'mainnet' : 'chipnet' });
  }
  if (changes[SITES_KEY]) {
    // A site removed from the list (from settings, or by its own wallet_disconnect) learns it has no accounts.
    const before = Object.keys((changes[SITES_KEY].oldValue as object) ?? {});
    const after = new Set(Object.keys((changes[SITES_KEY].newValue as object) ?? {}));
    for (const origin of before) if (!after.has(origin)) broadcastToSites({ type: MSG.ACCOUNTS_CHANGED, addresses: [] }, origin);
  }
});

