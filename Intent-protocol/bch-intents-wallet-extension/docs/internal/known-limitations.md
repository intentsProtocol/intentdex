# Known limitations of the alpha

What the wallet does not do, or does only partly. For what has and has not been tested, see [`testing.md`](testing.md).

## Must be dealt with before real volume

| Limitation | Detail |
|---|---|
| **Not audited** | No independent review of the code or the security model. |
| **Swap services choose what is signed** | The wallet signs the covenant address, calldata or transaction a service returns without checking it against the quote. A compromised service could redirect a swap. See [`security-model.md`](security-model.md#swap-services). |
| **No swap has been run end to end** | Routing and quoting are tested against mocks; signing and settlement are not. |
| **Default service URLs are localhost** | A build without the `VITE_` variables set swaps nothing. |
| **KDF cost** | PBKDF2 at 100,000 iterations, below current guidance. |
| **Recovering an unfilled BCH order depends on the relayer** | The relayer broadcasts the refund. If it were gone for good, the deposit would need the covenant's `cancel()` spend built by hand; the wallet has no screen for it. |

## Chains and assets

- **EVM tokens:** only the gas coin and USDC are listed per network. Other ERC-20s are safe at the address but invisible and unsendable here.
- **EVM networks:** the five in the bridge set. No BNB Chain, Polygon or Avalanche, and no custom networks or RPC URLs.
- **Solana testnet:** tokens other than USDC show their mint, not a name (there is no devnet registry).
- **CashToken NFTs** are not shown or sendable. Fungible tokens only.
- **Bitcoin:** native SegWit (BIP-84) only; one address per account, reused.
- **BCH:** one address per account, reused. No fresh address per payment.
- **Prices:** mainnet only. CashTokens are priced only in the swap selector, not in the portfolio.
- **Activity:** incoming transfers are itemised for BCH and BTC only. For EVM and Solana the balance changes without an entry. Only the newest 25 chain transactions are read.
- **Fees:** estimated, not adjustable. No speed choice, no replace-by-fee, no speed-up or cancel for a stuck EVM transaction.

## Accounts

- **Accounts created before the derivation change (builds up to 0.2.0 as first committed) used a different path for accounts after the first** (`m/44'/60'/n'/0/0` and `m/44'/145'/n'/0/0`). Those addresses are no longer shown. Anyone who funded a second account on such a build can reach it by importing the phrase into a wallet that lets them set the path. The first account never changed.
- No importing a single private key, no hardware wallets, no watch-only addresses.
- One recovery phrase per browser profile.
- Accounts cannot be removed or reordered.

## Swaps

- Market swaps only: no limit orders or TWAP.
- BCH swaps: the auction floor is fixed at half the quote by the relayer; the wallet cannot set a tighter minimum.
- Bridge: no "deliver it myself" button when the bridge's own delivery stalls (the function exists in `swap/flows.ts`; no screen calls it).
- Bridge always sends to the same account on the destination chain; no custom recipient.
- No BCH ↔ EVM, BCH ↔ Solana or other cross-family swaps. Those flows live in the frontend's `BCHSwapContext` and were not ported.
- Solana swaps: no tokenized stocks; slippage is one of four presets.
- A swap's progress panel follows it only while the Swap screen is open; afterwards Activity does, by polling.

## Sites

- **One provider, `window.bchIntents`.** It can sign messages and send on every chain through `wallet_signMessage` and `wallet_sendTransaction`, but it is not an EIP-1193/6963 provider or a Solana Wallet Standard wallet, so existing EVM and Solana dapps do not see it. No WalletConnect.
- `bch_sendTransaction` and `wallet_sendTransaction` pay one recipient. On Bitcoin Cash a site can have a transaction it built signed with `bch_signTransaction`; the other chains have no equivalent yet.
- `bch_signTransaction` shows amounts from the request. For the account's own inputs the signature commits to them, so a false value yields an invalid transaction, not a loss. The fee shown also depends on the values the site gave for inputs that are not the account's. The wallet does not simulate contracts: for a contract input it shows that one is spent, not what the contract enforces.
- No per-site account choice, spending limits or "always allow".
- No phishing blocklist.
- An approval opens in the side panel only if it is already open; otherwise in a separate window that can end up behind the browser.

## Interface

- **Chinese is machine-drafted** and unreviewed. Server-supplied messages stay in English.
- Dates and "5m ago" follow the browser's locale, not the wallet's language.
- No in-wallet notifications or toasts; outcomes are shown on the screen that started them and in Activity.
- No address book, no QR scanning, no fiat on-ramp.
- Sheets do not trap keyboard focus; no screen-reader pass has been done.
- The extension's three icon sizes are one image scaled.
- Chromium only. A browser without `chrome.sidePanel` falls back to the popup; Firefox was not built or tested.

## Build

- The wallet UI bundle is about 2.6 MB minified in one chunk. It loads from disk, so this costs start-up time, not bandwidth.
- `postcss.config.js` and `tailwind.config.js` remain from the scaffold; no screen uses Tailwind.
- Host permission is `<all_urls>`.
