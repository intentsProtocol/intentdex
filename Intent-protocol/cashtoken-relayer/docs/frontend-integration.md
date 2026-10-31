# CashToken Swap Frontend Integration

This document outlines the end-to-end flow of how the frontend interacts with the CashToken Relayer for same-chain swaps (BCH \u2194 CashTokens).

The primary implementation resides in the frontend's `BCHSwapContext.tsx`, specifically within the `executeSameChainSwap` function.

## 1. Intent Creation
The frontend initiates the swap by calling the relayer's `/intent/create` endpoint.

- **Endpoint**: `POST /intent/create`
- **Payload**:
  - `makerAddress`: The normalized address of the user (must include `bitcoincash:` or `bchtest:` prefix).
  - `sellToken`: The category ID of the token to sell, or `'BCH'` if selling native BCH.
  - `buyToken`: The category ID of the token to buy, or `'BCH'` if buying native BCH.
  - `sellAmount`: The amount to sell, normalized to base units (satoshis).
  - `buyAmount`: The target amount to buy, normalized to base units.
  - `orderType`: `'limit'` or `'dutch'`.
  - `duration`: For Dutch auctions, the time window in seconds.
  - `expiryTime`: The UNIX timestamp when the intent expires.
  - `network`: `'mainnet'` or `'chipnet'`.

The relayer validates the request and returns an `intentId` along with a generated `contractAddress` (for BCH) or `tokenAddress` (for CashTokens) which acts as the escrow/covenant.

## 2. Funding the Covenant
After receiving the contract address, the frontend must build and broadcast a funding transaction to lock the user's funds into the covenant. The frontend supports two different wallet types for signing:

### A. Main WDK Wallet (Internal)
Uses CashScript's `TransactionBuilder` directly.
- **Token Sells**:
  - Finds UTXOs matching the `sellCategoryId`.
  - Ensures the combined token UTXOs cover the required `sellAmount`.
  - Automatically calculates network fees dynamically using an estimation function based on inputs/outputs.
  - Adds additional native BCH UTXOs if the token UTXOs don't contain enough dust to cover fees.
  - Sends the exact `sellAmount` of tokens with 1000 sats of dust to the `tokenAddress`.
  - Returns any token change to a z-prefix token address.
  - Returns any BCH change to the user's main address.
- **BCH Sells**:
  - Filters out token-bearing UTXOs to prevent accidental burning.
  - Selects enough pure BCH UTXOs to cover `sellAmount` plus dynamically estimated fees.
  - Sends the `sellAmount` to the `contractAddress`.
  - Returns any BCH change to the user's main address.
- **Broadcast**: The signed transaction is broadcasted to the network via the Electrum provider, returning a `fundTxId`.

### B. External Wallets (Cashonize / WalletConnect v2)
Uses CashScript to build the transaction structure, but delegates signing to the external wallet.
- **UTXO Selection**: Similar logic to the main wallet, carefully separating token UTXOs and pure BCH UTXOs.
- **Placeholder Signatures**: Uses a dummy WIF to allow CashScript to build the raw unsigned transaction hex.
- **WalletConnect Payload**: Constructs a `sourceOutputs` array formatted for libauth and the unsigned hex.
- **Delegation**: Calls `extBCHCtx.signTransaction` which pushes the signing request to the connected Cashonize wallet via WalletConnect.
- **Broadcast**: The external wallet signs and broadcasts the transaction, returning the `fundTxId` to the frontend.

## 3. Order Tracking and Lifecycle
Once funded, the frontend adds the order to its local state (`pendingOrders`) with the `fundTxId` and `intentId`.

- The relayer's background scanner detects the funded covenant on-chain and begins attempting to execute the swap based on market conditions (as defined in `ProfitPolicy`).
- The frontend tracks status via **polling only** — `refreshOrders()` in `BCHSwapContext.tsx` GETs `/intent/:id` on an interval (8-30s depending on which component mounted it; see `LimitOrderHistory.tsx` / `BCHOrderTracker.tsx` / `WalletOrdersTab.tsx`). The relayer's `/ws` WebSocket exists and pushes `router:fill`/`intent:*` events, but the frontend does not currently subscribe to it for same-chain orders — this doc previously said otherwise; corrected 2026-07-04.
- The order goes `pending` → `filled` | `refunded` | `cancelled` | `expired` (mapped directly from the relayer's intent status — there is no separate frontend-local `ACTIVE`/`COMPLETED` state machine).

## 4. Cancelling an Order (Limit Orders only)
As of 2026-07-04, a Limit Order can be cancelled by its maker at any time before it fills — not just after expiry. See `cashtoken-relayer/docs/unfilled-orders.md` §3a for the on-chain design.

- **UI**: a "Cancel" button appears on open same-chain Limit Orders (not Dutch Auctions) in `LimitOrderHistory.tsx` / `BCHOrderTracker.tsx`, wired to `cancelSameChainOrder(orderId)` in `BCHSwapContext.tsx`.
- **Flow**: the frontend reconstructs the exact `LimitOrderSwap` contract client-side from data already stored in the local order (sell/buy token, amounts, expiry), verifies the reconstructed address matches the stored `contractAddress` (refuses to proceed if not — a client bug should fail loudly, not build an unsafe tx), then builds and broadcasts a `cancelEarly()`-unlocking transaction directly against chipnet/mainnet using the maker's own key. Only after a successful broadcast does it call `POST /intent/:id/cancel` with the txid so the relayer's order book reflects reality.
- **WDK (internal) wallet only** — external wallets (Cashonize/WalletConnect) aren't wired up yet. Covenant-unlock signing needs a real signature over a custom redeem script; the `getDummyUnlocker` pattern used for plain funding transactions doesn't generically extend to that. See `MILESTONES.md` in `cashtoken-relayer` for the follow-up.
- **Fund safety never depends on the relayer accepting the notification** — the covenant itself already guarantees the maker's funds land back correctly on-chain regardless of what the order book says.

## Error Handling & Fee Estimation
A critical part of the frontend logic is dynamic fee estimation.
- Token transactions are heavier: Inputs are ~180 bytes, outputs ~50 bytes.
- The frontend uses `estimateFee = (numIn, numOut) => Math.ceil((numIn * 180 + numOut * 50 + 10) * 2)` to guarantee a 2 sat/byte fee rate, preventing "mempool min fee not met" errors.
- If the user doesn't have enough BCH to cover the dust and fees for a token transfer, the frontend correctly halts and prompts the user to add BCH.
- `BCHSwapCard.tsx`'s pre-submit `/router/quote` call (used to auto-fill the expected `buyAmount`) now resets `buyAmount` to `'0'` if the relayer is unreachable or paused, instead of silently leaving a stale value on screen (fixed 2026-07-04 — previously only the cross-chain quote paths did this).
