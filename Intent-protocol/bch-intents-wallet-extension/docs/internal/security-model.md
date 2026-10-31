# Security model

What the wallet protects, from whom, and where it does not. This is a description of the alpha as built, not an audit. **The code has not been audited.**

## Assets

1. The seed phrase (and the keys derived from it).
2. The user's intent: that what gets signed is what the user saw and approved.
3. Privacy: which addresses belong to the user, and which sites know them.

## Trust boundaries

| Party | Trusted with | Not trusted with |
|---|---|---|
| The user's browser profile and OS | Everything. A compromised machine defeats the wallet. | — |
| Wallet UI context | The seed, signing | — |
| Service worker | The request queue, the connected-sites list, public addresses | Keys. It never receives or derives one. |
| Web pages | Nothing by default; the active BCH address and balance after the user connects | Any signature without an approval |
| Swap services | Public addresses, trade requests, signed transactions to broadcast | Keys; the choice of what gets signed (see below) |
| RPC endpoints, indexers, price feeds | Reads and broadcasts | Correctness of what they return (see below) |

## The seed

- **At rest:** AES-256-GCM, key from PBKDF2-SHA-256 with 100,000 iterations and a random 16-byte salt, random 12-byte IV (`src/lib/crypto.ts`, Web Crypto). Stored in `chrome.storage.local`. This is the frontend's scheme unchanged.
- **While unlocked:** the phrase sits in `chrome.storage.session`, which the browser keeps in memory and clears when it closes. This is what lets the side panel, an approval window and a reopened popup share one unlock. It also means any code running in an extension page can read it, so nothing third-party runs there: no remote scripts, no analytics, no remote fonts.
- **Lock:** removes the session entry. Triggered by the user, by inactivity in an open view, and by the service worker's alarm when no view is open.
- **Never:** in `chrome.storage.local` unencrypted, in a message, in a log, or sent to any server. An end-to-end test reads the whole of local storage after creating a wallet and checks the phrase and password are not in it.

Known weaknesses:

- 100,000 PBKDF2 iterations is below current guidance (OWASP suggests 600,000 for PBKDF2-SHA-256). Raising it needs a versioned record and a migration, and should be done together with the frontend so one phrase file stays portable.
- The password policy is length only (8 characters).
- There is no limit on unlock attempts. The cost of each attempt is the KDF.
- JavaScript cannot wipe memory. Strings holding the phrase live until garbage collection.

## Pages and the provider

- The inpage provider is injected by the manifest into the main world at `document_start` and is frozen and non-configurable, so page scripts cannot replace `request` to capture approvals. A page can still define its own unrelated global; sites must check `isBCHIntents`.
- The content script relays three message types and nothing else. It posts to the page's own origin, not `*`.
- **The service worker takes the origin from `sender.origin`.** The `origin` field in the request body is ignored. A page cannot claim to be another site, and an iframe is identified by its own origin.
- Read-only methods reveal nothing to an unconnected origin: `bch_accounts` answers `[]`, `bch_getBalance` answers 4100. `bch_getNetwork` is answered to anyone; it reveals a setting, not an identity.
- Every signature and every send needs a per-request approval. There is no "always allow".
- Approval results are accepted only from extension pages. Content scripts share the extension's id, so the sender's tab URL is checked too.

### What the approval screen guarantees

The screen is built from the request parameters and wallet state, never from text the site supplies (apart from the page title and icon, shown as decoration next to the browser-reported origin).

- **Send:** the parameters are parsed and validated first. A malformed request, an address for the other network, or an amount the account cannot cover disables the approve button. The transaction is then built by the wallet from those same parsed values, so what is signed is what was shown.
- **Sign message:** the exact string that will be signed is displayed. Hex input is decoded as UTF-8 for display and signed as that text.
- **Connect:** grants the active account's BCH address and the right to ask for approvals. Nothing else.

Not defended against:

- **Phishing by a convincing site.** The wallet shows the true origin; it does not know whether that origin is the one the user wanted. There is no blocklist.
- **Blind message signing.** A message is opaque text. A site could ask a user to sign something meaningful to a third party.
- **Clickjacking of the wallet UI** is not a concern for extension pages (they cannot be framed by web content), but an approval window can be covered by another window.

## Swap services

The services are not trusted with keys. They are, in two flows, trusted with *what to sign*, and that deserves to be explicit:

| Flow | What the wallet signs | Who built it | What the wallet checks |
|---|---|---|---|
| BCH swap | A plain payment to the covenant address | The wallet builds the transaction; the **relayer supplies the address** | Nothing about the address. The wallet does not recompile the covenant to confirm the address encodes the quoted terms. |
| USDC bridge, EVM | `approve`, `burn`, `fee` calls | The **server supplies `to` and `data`** | `estimateGas` must succeed. The calldata is not decoded or compared with the quote. |
| USDC bridge, Solana | A burn transaction | The **server** | That the wallet's key is a required signer. |
| Solana swap | A Jupiter transaction | The **server**, from Jupiter | That the wallet's key is a required signer. |

So a compromised or malicious swap service could have the wallet sign a transaction that sends the swap amount, or approves an allowance, somewhere else. The user would have approved "swap 5 USDC" and signed something different. This is the same trust the frontend places in these services, and it is the most important gap to close before real volume:

- BCH: recompile the covenant client-side from the quoted terms and compare addresses (the frontend already does this for cancellation).
- EVM: decode the calldata and check the spender, the token, the amount and the recipient against the quote and the server's published contract addresses.
- Solana: simulate and check the balance changes.

Mitigations in place: the services are first-party, the URLs are fixed at build time (a user cannot be talked into changing them, because there is no setting), per-transfer limits come from the server's config, and the user's exposure per action is the amount they typed.

## Networks and data

- RPC endpoints, the Cauldron indexer, the BCMR indexer and the price feeds are read without verification. A lying endpoint can show a wrong balance or price; it cannot move funds.
- **Token names are untrusted.** A CashToken's or Solana token's name and symbol are chosen by its creator. Tokens no registry vouches for are marked unverified wherever they appear, and Jupiter's "suspicious" flag is shown. Solana tokens are identified by mint, never by symbol.
- Token icons are loaded from URLs in registries (`http(s)`, `ipfs`, `data:image` only). Loading one tells that host the user's IP address.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Everything in the state table |
| `tabs` | Reply to the tab that asked; find connected sites' tabs for events; read a tab's title and icon for the approval screen |
| `sidePanel` | The docked wallet |
| `alarms` | Auto-lock when no view is open |
| host `<all_urls>` | Inject the provider; call RPCs and services without depending on their CORS headers |

`<all_urls>` is broad and will be questioned in store review. It could be narrowed to the content-script matches plus an explicit list of RPC and service hosts once those are fixed.

The extension pages' CSP is `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`. `wasm-unsafe-eval` is required by the WebAssembly in `mainnet-js`'s crypto.

## Before a public release

1. An independent audit, of this document's claims first.
2. Verify service-supplied transactions against the quote (the table above).
3. Raise the KDF cost, with a migration.
4. Narrow host permissions.
5. A phishing blocklist or allowlist for connections.
6. Rate-limit or back off unlock attempts.
