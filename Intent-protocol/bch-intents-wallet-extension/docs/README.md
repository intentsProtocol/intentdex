# BCH Intents Wallet documentation

Three sets of documents, for three readers.

## For people using the wallet: [`user/`](user/)

| Guide | What it covers |
|---|---|
| [Getting started](user/getting-started.md) | Installing, creating or importing a wallet, the first look around |
| [Accounts and networks](user/accounts-and-networks.md) | Several accounts from one phrase; testnet and mainnet; which chains are supported |
| [Send and receive](user/send-and-receive.md) | Addresses, QR codes, sending on each chain, fees |
| [Swaps](user/swaps.md) | Bitcoin Cash swaps, moving USDC between chains, Solana swaps |
| [Connecting to sites](user/connecting-to-sites.md) | What a site can and cannot do, approving requests, disconnecting |
| [Security and recovery](user/security-and-recovery.md) | The recovery phrase, the password, auto-lock, restoring a wallet |
| [Settings](user/settings.md) | Every setting and what it changes |
| [Troubleshooting](user/troubleshooting.md) | Common problems and what to do |

## For developers building on the wallet: [`developers/`](developers/)

| Guide | What it covers |
|---|---|
| [Provider API](developers/provider-api.md) | `window.bchIntents`: methods, events, error codes |
| [Integration guide](developers/integration-guide.md) | Connecting a site step by step, with code |
| [Building and testing](developers/building-and-testing.md) | Building the extension, loading it, running the test suites |
| [Configuration](developers/configuration.md) | Build-time variables: service URLs, RPC endpoints |

## For the team: [`internal/`](internal/)

| Document | What it covers |
|---|---|
| [Architecture](internal/architecture.md) | The four contexts, state, keys, the dapp pipeline |
| [Security model](internal/security-model.md) | What is protected, from whom, and what is not |
| [Swap integration](internal/swap-integration.md) | The two services, the flows, interrupted transfers |
| [Design system](internal/design-system.md) | Tokens, themes, liquid glass, components, Cham |
| [Translations](internal/i18n.md) | How strings work, adding a language |
| [Testing](internal/testing.md) | What is tested, what was verified by hand, what was not verified |
| [Known limitations](internal/known-limitations.md) | What the alpha does not do |
| [Release checklist](internal/release-checklist.md) | Steps to cut a build |
| [Borrow: implementation plan](internal/borrow-implementation-plan.md) | Planned, not built: loans against BTC through Liquidium, pages, flows, phases |
