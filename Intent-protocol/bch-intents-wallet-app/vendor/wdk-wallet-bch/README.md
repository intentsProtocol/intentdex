# @bch-intents/wdk-wallet-bch

A [WDK](https://docs.wdk.tether.io) wallet module for Bitcoin Cash. WDK ships modules for Bitcoin, EVM chains, Solana and others; this one adds BCH with the same interface, so a WDK wallet can treat it like any other chain.

Pure JavaScript: `@noble/curves`, `@noble/hashes` and `@scure/bip32`. No WebAssembly and no native code, so it runs in a browser, in Node and inside WDK's Bare worklet on a phone.

**Status: alpha.** Tested against two independent implementations (see below) and not yet reviewed by a third party. Use it on chipnet; treat mainnet with care.

## What it does

- Derives accounts from a BIP-39 seed: the address, and its token-aware form
- Balances: BCH, and fungible CashTokens by category
- Sends BCH, including "send everything"
- Sends fungible CashTokens, returning token change and BCH change
- Pays pay-to-script-hash addresses (20 and 32 byte), which is where covenants live
- Signs and verifies messages in the format BCH wallets use
- Signs a transaction a dapp built (WalletConnect, WizardConnect), with `SIGHASH_UTXOS`
- Exports the extended public key of a named branch for a connected dapp
- Recent history with the change each transaction made

Not yet: NFTs (they are never spent by accident, and cannot be sent on purpose), several addresses per account, Schnorr signatures (ECDSA is used; every node accepts it).

## Use

```js
import WalletManagerBch from '@bch-intents/wdk-wallet-bch'

const wallet = new WalletManagerBch(seedPhrase, { network: 'chipnet' })
const account = await wallet.getAccount(0)

await account.getAddress()        // bchtest:q…
await account.getTokenAddress()   // bchtest:z…
await account.getBalance()        // spendable satoshis, bigint
await account.getTokenBalances()  // { [category]: bigint }

await account.sendTransaction({ to: 'bchtest:q…', value: 10_000n })
await account.transfer({ token: category, recipient: 'bchtest:z…', amount: 25n })
await account.sign('hello')       // base64
```

### Configuration

| Option | Default | Meaning |
|---|---|---|
| `network` | `'mainnet'` | `'mainnet'` or `'chipnet'` |
| `coinType` | `145` | BIP-44 coin type. See below. |
| `servers` | public Fulcrum servers | Electrum WebSocket URLs, tried in order |
| `WebSocket` | `globalThis.WebSocket` | The constructor to use where there is no global one (a Bare worklet) |
| `feeRate` | what the server relays at | Satoshis per byte |
| `client` | — | An object with the Electrum client's methods; for tests |

### Derivation, and `coinType: 0`

Account *n* is `m/44'/145'/0'/0/n`: address *n* of the branch Electron Cash derives its receiving addresses on.

The BCH Intents frontend and browser extension are built on `mainnet-js`, whose default wallet is `m/44'/0'/0'/0/0`: Bitcoin's coin type, not Bitcoin Cash's. A wallet that must show **the same address as those apps** sets `coinType: 0`. The tests pin both.

## How it is tested

`npm test`. The suite compares the module with:

- **`mainnet-js`**: addresses (both networks, both forms, several indexes) and message signatures must be identical, byte for byte.
- **`@bitauth/libauth`**: every transaction the module signs is run through libauth's Bitcoin Cash virtual machine with the outputs it spends, and must be accepted. Token prefixes and transaction encoding must equal libauth's.

Both libraries are loaded from the browser extension's install in the sibling folder (`../bch-intents-wallet-extension/node_modules`); without it those tests are skipped.

Not covered by tests: the Electrum client against a live server, and anything on a real network.
