# Known limitations

What this alpha does not do, and what to expect because of it.

## Devices

The wallet has run on a Samsung Galaxy S24 (Android 16). The agent needs Android 12 or later, an arm64 phone and
about 4 GB of RAM (QVAC's requirements); older or smaller phones keep the wallet but not the assistant. Emulators
cannot run the model.

## Security

- **Not audited.** Neither the app nor the Bitcoin Cash wallet module (`wdk-wallet-bch`) has had an independent review. The module signs transactions; a second reader is needed before real funds depend on it.
- **The PIN is a gate, not a key.** It decides whether the app opens. The seed is protected by the phone's keychain, not encrypted with the PIN. Someone who can read the keychain of an unlocked, compromised phone does not need the PIN.
- **Two prompts on some phones.** WDK's keychain storage asks for the phone's own fingerprint or passcode when the seed is loaded. With the app's biometric unlock on, a phone may ask twice. This is to be checked on devices and, if confirmed, reduced to one prompt.
- **No auto-lock while the app is open.** The wallet locks after time in the background, not after idle time in the foreground.
- **No cloud backup.** The recovery phrase on paper is the only backup.
- **A rooted or jailbroken phone** is not detected.

## Wallet

- **Accounts are not discovered on restore.** After importing a phrase, tap Add account until the accounts you had are back.
- **Bitcoin Cash addresses do not match Electron Cash's default.** The path is `m/44'/0'/0'/0/N`, the one the BCH Intents web app and extension use. Electron Cash shows the same addresses with its derivation path set to `m/44'/0'/0'`.
- **One Bitcoin Cash address per account.** Change returns to the same address; there is no fresh address per payment.
- **EVM and Solana history is the wallet's own record.** Payments received, and anything done with the same phrase in another wallet, do not appear in Activity. Balances are always read from the chain.
- **Token lists.** On EVM networks only the native coin and USDC are shown. Solana shows every token held; names and prices come from the swap service on mainnet.
- **Bitcoin** is read through a Blockbook server (Trezor's public one by default).

## Swaps

- **Market swaps only.** No limit orders, no TWAP.
- **A swap needs its service.** A build without service URLs shows the Swap tab as unavailable. Sending and receiving do not depend on any service.
- **Leaving the app during a bridge.** A transfer that was signed continues on the server and Activity follows it. One interrupted between its steps is finished from its Activity row ("Resume this transfer", "Pay the service fee").

## Dapp connections

- **WalletConnect only.** There is no in-app browser.
- **A WalletConnect project id is required at build time.** Without one the Connect screen says so.
- **Messages must be text.** A `personal_sign` or `solana_signMessage` payload that is not valid UTF-8 is refused: the wallet modules sign text, and signing something the user cannot read is not offered.
- **`eth_sign` is not offered**, by design: it signs an opaque hash.
- **Contract deployments** (`eth_sendTransaction` without `to`) are refused.
- **Bitcoin Cash:** the wallet signs its own P2PKH inputs of a prepared transaction. A transaction that needs the wallet's signature inside a contract's unlocking script is refused.
- **Solana and contract transactions are not decoded.** The sheet says so and shows the network and the app that asked.
- **WizardConnect is not included.** Its packages depend on libauth, which needs WebAssembly and top-level `await`; React Native's JavaScript engine has neither, so they cannot be bundled. The route to it is running the WizardConnect wallet adapter inside the worklet, which does have both. The Bitcoin Cash module already exposes what the adapter needs (`getExtendedPublicKey` for the receive, change and defi branches, and `signPreparedTransaction`).

## Agent

- **The model is small.** Qwen3 1.7B runs on a phone; it can misread a request. It never acts on its own, and every
  number on a card is computed by the wallet, but check the card before approving.
- **Offline answers use saved data.** Balances and prices are as of the last online refresh; cards show their age.
- **Loans are plans only.** The wallet cannot open a loan yet (Liquidium is mainnet only and not integrated).
- **Mesh positions:** only the default bin variant, at most 32 bins, BCH and one CashToken. The Mesh server plans
  the outputs; the phone checks them before signing.
- **Background notifications** depend on Android running the check (about every 15 minutes at best); in the app
  the banner shows at once.
- **First load** of the model takes several seconds; the model is unloaded on lock and loads again on first use.

## Platform

- **Android first.** iOS builds from the same code but has had no attention beyond that; Liquid Glass on iOS 26 is wired in and unseen.
- **No tablet layout.**
- **English and Simplified Chinese.**
