/**
 * Content script — runs in every page's isolated world at document_start.
 *
 * It is a relay and nothing else: requests from the inpage provider go to the background worker, and the
 * worker's answers and events go back. The provider itself (src/inpage/provider.ts) is loaded into the page's
 * main world by the manifest ("world": "MAIN"), so no script tag is injected here.
 *
 * Self-contained on purpose: a content script cannot import a chunk, so the message names are repeated from
 * src/shared/messages.ts. Keep them equal.
 */

import type { DappRequest } from '../shared/messages';

const DAPP_REQUEST = 'DAPP_REQUEST';
const FORWARDED = ['DAPP_RESPONSE', 'ACCOUNTS_CHANGED', 'NETWORK_CHANGED'];
const FROM_PAGE = 'bch-intents-inpage';
const FROM_WALLET = 'bch-intents-content';

// inpage → background
window.addEventListener('message', event => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.from !== FROM_PAGE || data.type !== DAPP_REQUEST) return;
  const request = data.payload as DappRequest;
  try {
    chrome.runtime.sendMessage({ type: DAPP_REQUEST, request }).catch(() => answerUnavailable(request));
  } catch {
    // The extension was reloaded or removed while this page stayed open.
    answerUnavailable(request);
  }
});

function answerUnavailable(request: DappRequest) {
  window.postMessage({
    from: FROM_WALLET, type: 'DAPP_RESPONSE',
    payload: { requestId: request?.requestId, approved: false, code: 4900, error: 'The wallet is unavailable. Reload the page and try again.' },
  }, window.location.origin);
}

// background → inpage
chrome.runtime.onMessage.addListener(message => {
  if (!message || !FORWARDED.includes(message.type)) return;
  window.postMessage({ from: FROM_WALLET, ...message }, window.location.origin);
});
