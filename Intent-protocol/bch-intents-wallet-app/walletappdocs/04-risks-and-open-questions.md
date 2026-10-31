# 04 — Risks and open questions

## Risks

Ordered by how much each could change the plan.

| # | Risk | Likelihood | If it happens | What we do about it |
|---|---|---|---|---|
| 1 | **The worklet cannot sign a transaction a server built** with WDK's own modules | Medium | Swaps and WalletConnect transaction requests have no signing path | Phase 0.5 finds out. Fallback is designed: the `intents-signer` generic module. |
| 2 | **WDK's Solana or Bitcoin module does not work inside Bare** | Medium for Solana, low for Bitcoin | That chain needs its own module in the worklet | Phase 0.4. Fallback: wrap `@solana/web3.js` signing in a generic module, as the extension's own code already does. |
| 3 | **A breaking WDK beta release mid-project** | High | Days lost re-aligning versions and APIs | Pin exact versions. Upgrade deliberately, between phases, never during one. Keep our use of WDK behind thin wrappers in `src/wallet/`. |
| 4 | **The BCH module has a signing or coin-selection bug** | Low if tested as planned; the consequence is lost funds | Money is lost | Byte-equality tests against `mainnet-js`, published vectors, chipnet first, an external review before mainnet, and conservative coin selection (never touch a token coin for a plain send). |
| 5 | **No Bare networking usable from a custom module** | Low to medium | The BCH module cannot reach Electrum | Phase 0.6. Fallback: the module only derives and signs; coins, history and broadcast go through an HTTPS indexer called from the app. |
| 6 | **Version set does not exist**: no combination of Expo SDK and the beta packages builds | Low | Phase 0 stalls | Start from the starter's lockfile, which builds by definition, and move forward one package at a time. |
| 7 | **iOS cannot be debugged properly from Windows** | High | iOS bugs are slow to fix: each attempt is a cloud build | Android first. Budget iOS time in Phase 6. A borrowed Mac for a week would pay for itself. |
| 8 | **Swap services decide what gets signed** (carried over from the extension) | Present today | A compromised service could redirect a swap | Phase 4.4: check the transaction against the quote before signing, in `wallet-core`, for both wallets. |
| 9 | **Shared package destabilises the extension** | Low | The working alpha regresses | Phase 1's exit is the extension's whole test suite passing unchanged. |
| 10 | **App store review** for a self-custodial wallet with swaps | Medium | Delay at release | Start the listings and policy in Phase 6, not after. Apple and Google both have crypto-specific rules; read them before designing "Buy" or any in-app purchase-like flow. |
| 11 | **Worklet memory or start-up on low-end Android** with sixteen networks | Unknown | Slow unlock; possible crashes | Phase 0.9 measures. Mitigation: bundle only the active mode's networks, or initialise lazily. |
| 12 | **Recovery expectations on mobile** | Medium | Users lose phones; "I lost my phone" is the most common support request for mobile wallets | Make the backup check hard to skip, keep the reminder visible, and decide on cloud backup (open question 5). |

## Open questions for the owner

None of these blocks reading the plan. All of them are needed before or during the phase named.

| # | Question | Needed for | Notes |
|---|---|---|---|
| 1 | **Where does the shared package live?** The extension is its own git repository; the app folder sits in the parent `Intent-protocol` repository. | Phase 1 | Options: a `packages/wallet-core` folder in the parent repository that the extension reaches by a relative path; its own repository published to npm (public or private); or moving the extension into the parent repository too. The first is simplest if the extension is always checked out next to its parent. |
| 2 | **App name, bundle id and package name** (for example `xyz.intentsprotocol.wallet`) | Phase 3 | Hard to change after the first store upload. |
| 3 | **Apple Developer and Google Play Console accounts**: do they exist, and under whose name? | Phase 0.10 (Apple), Phase 6 | Apple's is paid yearly and takes days to approve for an organisation. |
| 4 | **A Reown (WalletConnect) project id** | Phase 5 | Free to create at Reown's dashboard. The frontend may already have one; a wallet should have its own. |
| 5 | **Cloud backup of the recovery phrase?** Encrypted backup to iCloud or Google Drive is what makes mobile wallets survivable for ordinary users, and it is also a custody-shaped feature with its own risks. | Before Phase 3's onboarding is designed | WDK has a cloud backup tool. Recommendation: not in the first release; design onboarding so it can be added. |
| 6 | **A WDK Indexer API key?** | Phase 3 (optional) | Gives EVM and Bitcoin transaction history without running our own indexer. Requested from Tether. Without it, history on those chains stays as thin as in the extension. |
| 7 | **Where will the two swap services be hosted** for mobile testing? | Phase 4 | A phone cannot reach the developer's `localhost`. A LAN address works for development; real testers need public URLs. Same blocker as the extension's release build. |
| 8 | **Who reviews the BCH module** before mainnet? | End of Phase 2 | Someone with Bitcoin Cash transaction-signing experience, outside the person who wrote it. |
| 9 | **Is a "Buy" button wanted?** | Phase 6 or later | WDK has a MoonPay module. It brings KYC flows and store-policy questions. |
| 10 | **Should the app also offer gasless smart accounts later** as an optional second EVM account? | After release | Decided against as the default; this asks whether to keep the door open in the account model. |
| 11 | **Minimum devices to support?** WDK requires Android 10 and iOS 15.1. | Phase 3 | Anything older is excluded by the SDK, not by us. |
| 12 | **Test devices available**: which Android phone, and is there an iPhone and someone to test on it? | Phase 0 | |

## Assumptions the plan makes

If any of these is wrong, say so and the plan changes.

- One developer, working mostly on Android from Windows.
- The extension's behaviour is the specification: where this plan is silent, the app does what the extension does.
- Testnet first; mainnet only after the BCH module is reviewed.
- English and Simplified Chinese; no right-to-left languages in the first release.
- Phones only. Tablets get a centred phone layout.
- No backend of our own for the wallet: only the two existing swap services, public RPC endpoints, and whatever indexer access we obtain.
