# Integration guide

How to add "Connect BCH Intents Wallet" to a site. The full reference is [`provider-api.md`](provider-api.md); this page is the path through it.

## 1. Find the provider

```js
async function getProvider(timeoutMs = 3000) {
  if (window.bchIntents?.isBCHIntents) return window.bchIntents;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('NOT_INSTALLED')), timeoutMs);
    window.addEventListener('bchIntents#initialized', () => {
      clearTimeout(timer);
      resolve(window.bchIntents);
    }, { once: true });
  });
}
```

If it rejects, show an install prompt rather than an error.

## 2. Restore a previous connection, silently

On page load, ask for accounts without prompting. A site the user connected before gets its address back; anyone else gets an empty array and sees nothing.

```js
const provider = await getProvider();
const [address] = await provider.request({ method: 'bch_accounts' });
if (address) showConnected(address);
```

Only call `bch_requestAccounts` from a click. A prompt that appears on page load, before the user asked for anything, is the fastest way to get rejected.

## 3. Connect

```js
connectButton.onclick = async () => {
  try {
    const [address] = await provider.request({ method: 'bch_requestAccounts' });
    showConnected(address);
  } catch (e) {
    if (e.code === 4001) return;        // the user declined: not an error
    showError(e.message);
  }
};
```

## 4. Follow the wallet

```js
provider.on('accountsChanged', ([address]) => (address ? showConnected(address) : showDisconnected()));
provider.on('networkChanged', network => refreshForNetwork(network));
```

Treat these events as the truth. The user can switch account, switch network, or disconnect your site from the wallet at any moment.

## 5. Check the network before asking for money

```js
const network = await provider.request({ method: 'bch_getNetwork' }); // 'chipnet' | 'mainnet'
if (network !== EXPECTED_NETWORK) {
  showMessage(`Switch the wallet to ${EXPECTED_NETWORK} to continue.`);
  return;
}
```

There is no method to switch the wallet's network from a site: the user does it. New wallets are on chipnet.

Use the address prefix that matches (`bchtest:` on chipnet, `bitcoincash:` on mainnet). The wallet refuses a send whose recipient has the other network's prefix.

## 6. Ask for a payment

```js
const { txid } = await provider.request({
  method: 'bch_sendTransaction',
  params: [{ to: merchantAddress, satoshis: 25000 }],
});
```

The wallet shows the user the amount and the recipient, builds and signs the transaction, and broadcasts it. Your site gets the transaction ID once the network accepted it. Confirm it yourself on your backend before delivering anything of value: a transaction ID from the browser is a claim, not a proof.

For a CashToken:

```js
await provider.request({
  method: 'bch_sendTransaction',
  params: [{ to: tokenAwareAddress, satoshis: 1000, token: { category, amount: '250' } }],
});
```

`amount` is in the token's base units. The recipient must be a token-aware address (`z…`).

For a transaction your site builds itself (funding a covenant, a contract call), see [`bch_signTransaction`](provider-api.md#bch_signtransaction). The frontend app does this in `frontend/src/context/ExternalBCHWalletProvider.tsx`.

## 7. Sign in with a signature

```js
const message = `Sign in to example.com\nNonce: ${nonceFromYourServer}`;
const { signature } = await provider.request({ method: 'personal_sign', params: [message] });
// Send { address, message, signature } to your server and verify there.
```

Verify on the server, for example with `mainnet-js`:

```js
import { SignedMessage } from 'mainnet-js';
const { valid } = await SignedMessage.verify(message, signature, address);
```

Use a nonce your server issued and checks once, and put your site's name in the message so a signature made for another site is useless on yours.

## 8. Disconnect

```js
await provider.disconnect();
```

## What users see

- A request that needs approval opens in the docked wallet if it is open, otherwise in a small window. The user sees your site's origin as the browser reports it, your page's title and its icon.
- If the wallet is locked, the user enters their password first.
- Requests from several tabs queue and are shown one at a time.

## Limits of the alpha

- `bch_sendTransaction` sends to one recipient. For anything else (several recipients, contracts), build the transaction and use `bch_signTransaction`.
- No WalletConnect: the wallet is reached through `window.bchIntents` only. `bch_signTransaction` takes the same payload as WalletConnect's, so one code path can serve both.
- One address per connection: the active account's.

## Testing your integration

1. Build and load the extension ([`building-and-testing.md`](building-and-testing.md)).
2. Create a wallet; it starts on chipnet.
3. Get test coins from a chipnet faucet (the wallet links to one).
4. Serve your site over `http://localhost` or `https`. The wallet does not inject into `file://` pages.

`test-extension.html` in the repository is a working page that calls every method; `tests/e2e/dapp.spec.ts` drives it and shows the expected result of each.
