# Provider API: `window.bchIntents`

The wallet injects one object into every `http` and `https` page: `window.bchIntents`. It is shaped like an EIP-1193 provider (one `request` method, plus events), in the style of Phantom's `window.solana`.

Bitcoin Cash has its own methods (`bch_*`). Two further methods, `wallet_signMessage` and `wallet_sendTransaction`, work on every chain the wallet supports: Bitcoin Cash, EVM networks, Solana and Bitcoin. The wallet is not an EIP-1193 or Solana Wallet Standard provider, so sites call these methods on `window.bchIntents` directly.

## Detecting the wallet

The provider is set at `document_start`, before the page's own scripts run. A page that loads its code late can read it directly; a page that wants to be safe waits for the event:

```js
function getProvider() {
  if (window.bchIntents?.isBCHIntents) return Promise.resolve(window.bchIntents);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('BCH Intents Wallet is not installed')), 3000);
    window.addEventListener('bchIntents#initialized', () => {
      clearTimeout(timer);
      resolve(window.bchIntents);
    }, { once: true });
  });
}
```

## Properties

| Property | Type | Meaning |
|---|---|---|
| `isBCHIntents` | `true` | Identifies this wallet |
| `selectedAddress` | `string \| null` | The connected address, or `null` |
| `isConnected()` | `boolean` | True while the site has an account |

## `request({ method, params })`

Returns a promise. `params` is an array or omitted.

| Method | Params | Resolves with | Prompt |
|---|---|---|---|
| `bch_requestAccounts` | none | `string[]`, one cashaddr | Yes, the first time. A connected site gets its address back without one. |
| `bch_accounts` | none | `string[]`: the address if connected, else `[]` | No |
| `bch_getNetwork` | none | `'chipnet' \| 'mainnet'` | No |
| `bch_getBalance` | none | `{ satoshis: number }` | No. Needs a connection. |
| `bch_sendTransaction` | `[{ to, satoshis, token? }]` | `{ txid: string }` | Yes |
| `bch_signTransaction` | `[{ transaction, sourceOutputs, broadcast?, userPrompt? }]` | `{ signedTransaction, signedTransactionHash }` | Yes |
| `personal_sign` | `[message, address?]` | `{ signature: string }` | Yes |
| `bch_signMessage` | `[message]` | `{ signature: string }` | Yes. Same as `personal_sign`. |
| `wallet_getAddresses` | none | `{ bch, evm, solana, btc, network }` | No. Needs a connection. |
| `wallet_signMessage` | `[{ chain, message }]` | `{ signature, address, chain }` | Yes |
| `wallet_sendTransaction` | `[{ network, to, amount, token? }]` | `{ txid, network }` | Yes |
| `wallet_disconnect` | none | `true` | No |

Shorthands: `provider.connect()` is `bch_requestAccounts`, and `provider.disconnect()` is `wallet_disconnect`.

### `bch_sendTransaction`

```js
// 10,000 satoshis of BCH
await provider.request({
  method: 'bch_sendTransaction',
  params: [{ to: 'bchtest:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eymt9qmp0k', satoshis: 10000 }],
});

// 25 base units of a CashToken
await provider.request({
  method: 'bch_sendTransaction',
  params: [{
    to: 'bchtest:zr6m7j9njldwwzlg9v7v53unlr4jkmx6eyupk748s9',
    satoshis: 1000,
    token: { category: '<64 hex characters>', amount: '25' },
  }],
});
```

- `to` is a cashaddr, with or without its prefix. A prefix for the other network is refused in the approval screen.
- `satoshis` is an integer (number or numeric string). For a plain send the minimum is 546. For a token send it is the BCH that travels with the token; below 800 the wallet uses 1000.
- `token.amount` is in base units (the token's smallest unit), as an integer or numeric string.
- The wallet picks the inputs, adds change, signs and broadcasts. The promise resolves once the network accepted the transaction.

### `bch_signTransaction`

Signs a transaction your site built: funding a contract, spending from one, anything `bch_sendTransaction` cannot express. The payload is the one of the [WalletConnect BCH specification](https://github.com/mainnet-pat/wc2-bch-bcr), so code written for Cashonize or Paytaca works unchanged.

```js
import { stringify } from '@bitauth/libauth';

// CashScript builds the payload: placeholders where the wallet has to sign.
const wcObject = builder.generateWcTransactionObject({ broadcast: true, userPrompt: 'Fund the swap' });

const { signedTransaction, signedTransactionHash } = await provider.request({
  method: 'bch_signTransaction',
  params: [JSON.parse(stringify(wcObject))],
});
```

- `transaction` is the unsigned transaction, as hex or as a libauth transaction object.
- `sourceOutputs` has one entry per input, in the same order: the output that input spends (`lockingBytecode`, `valueSatoshis`, `token` if it has one). If an entry carries `outpointTransactionHash` and `outpointIndex`, they must equal the input's, or the request is refused.
- Byte arrays and big integers are libauth "extended JSON" strings (`<Uint8Array: 0x…>`, `<bigint: 123n>`), which is what `stringify` produces. Transaction hashes and token categories are in display order, as libauth holds them.
- `broadcast: true` makes the wallet send the transaction after signing. Without it the signed transaction comes back and your site sends it.
- `userPrompt` is shown to the user as your site's description, up to 200 characters.

The wallet signs two things and leaves every other input as you sent it:

| Input | What the wallet does |
|---|---|
| Empty unlocking script, spending an output of the connected account (P2PKH) | Signs it (Schnorr, all outputs) |
| `sourceOutputs[i].contract` set, unlocking script with a 65-byte zero signature or a 33-byte zero public key | Replaces the placeholders. The signature covers `contract.redeemScript`, all outputs and all source outputs, as CashScript's `SignatureTemplate` does |

CashScript's `placeholderP2PKHUnlocker`, `placeholderSignature` and `placeholderPublicKey` produce exactly these. If nothing in the transaction is for the connected account, the wallet refuses to sign.

The approval screen is built from the transaction, not from `userPrompt`: what leaves the account, each recipient, and the fee.

`signedTransaction` is hex; `signedTransactionHash` is the transaction ID.

### `personal_sign`

`message` is a UTF-8 string, or a `0x`-prefixed hex string of UTF-8 bytes. The signature is a standard Bitcoin Cash signed message (base64), verifiable with `mainnet-js`, Electron Cash or `libauth`.

## Every chain

Connecting (`bch_requestAccounts`) gives a site the active account's public address on every chain, through `wallet_getAddresses`. `network` is `'testnet'` or `'mainnet'`.

### `wallet_signMessage`

```js
const { signature, address } = await provider.request({
  method: 'wallet_signMessage',
  params: [{ chain: 'evm', message: 'Sign in to example.com\nNonce: 42' }],
});
```

| `chain` | Signature | Verify with |
|---|---|---|
| `bch` | base64, Bitcoin signed message (65 bytes) | `mainnet-js` `SignedMessage.verify`, Electron Cash |
| `evm` | `0x` hex, EIP-191 (`personal_sign`) | `ethers.verifyMessage(message, signature)` |
| `solana` | hex, ed25519 over the UTF-8 bytes of the message (64 bytes) | any ed25519 library, against the address's 32-byte public key |
| `btc` | base64, BIP-137 with the SegWit flag | `bitcoinjs-message` `verify(message, address, signature, undefined, true)` |

The EVM key is the same on every EVM network, so there is one `evm` chain for signing.

### `wallet_sendTransaction`

```js
// 1 USDC on Base Sepolia
const { txid } = await provider.request({
  method: 'wallet_sendTransaction',
  params: [{
    network: 'base-sepolia',
    to: '0x…',
    amount: '1000000',
    token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  }],
});
```

- `network` is a network key: `bch-chipnet`, `eth-sepolia`, `base-sepolia`, `arb-sepolia`, `op-sepolia`, `arc-testnet`, `solana-devnet`, `btc-testnet` on testnet; `bch-mainnet`, `ethereum`, `base`, `arbitrum`, `optimism`, `arc`, `solana`, `btc-mainnet` on mainnet. A network of the mode the wallet is not in is refused.
- `amount` is an integer string in base units: satoshis, wei, lamports, or the token's smallest unit.
- `token` is the ERC-20 contract, SPL mint or CashToken category. Leave it out for the network's native coin. The account must hold the asset.
- The wallet checks the recipient is an address of that chain and that the account can cover the amount and the fee, then shows the user the asset, amount, recipient and fee.

## Events

```js
provider.on('accountsChanged', (accounts) => { /* string[]; [] means disconnected */ });
provider.on('networkChanged', (network) => { /* 'chipnet' | 'mainnet' */ });
provider.on('connect', ({ network }) => {});
provider.on('disconnect', (error) => {});
provider.removeListener('accountsChanged', handler); // or provider.off(...)
```

`accountsChanged` fires when the user switches account, disconnects the site in the wallet's settings, or removes the wallet. Only connected sites receive events.

## Errors

A rejected promise carries an `Error` with a numeric `code`:

| Code | Meaning |
|---|---|
| `4001` | The user rejected the request, or closed the approval window |
| `4100` | The site is not connected. Call `bch_requestAccounts` first. |
| `4200` | The method is not supported |
| `4900` | The wallet is unavailable (the extension was reloaded; reload the page) |
| `-32602` | Invalid parameters |

```js
try {
  await provider.request({ method: 'bch_sendTransaction', params: [tx] });
} catch (e) {
  if (e.code === 4001) return; // the user said no
  throw e;
}
```

## Behaviour worth knowing

- **Locked wallet.** A request that needs approval opens the wallet, which asks for the password first and then shows the request. Read-only methods answer while the wallet is locked.
- **Several requests.** They queue and are shown one at a time, in order.
- **Timeout.** A request the user never answers is rejected with `4001` after 10 minutes.
- **Network.** Check `bch_getNetwork` and listen for `networkChanged`. New wallets start on chipnet.
- **Origin.** The wallet identifies your site by the origin the browser reports, not by anything the page sends.
- **Frozen object.** `window.bchIntents` cannot be replaced or extended by page scripts.

## A complete example

`test-extension.html` in the repository root exercises every method and event; open it from a local web server (`npx serve .`), not from `file://`.
