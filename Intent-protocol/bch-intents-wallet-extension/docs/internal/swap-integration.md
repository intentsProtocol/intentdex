# Swap integration

How the wallet talks to the two swap services. Both are called from the wallet UI with plain `fetch`; neither ever receives a key. Every flow is "get a quote, get something to sign, sign it here, report back".

| Product | Service | Repo | Default URL | Networks |
|---|---|---|---|---|
| BCH ↔ CashTokens | cashtoken-relayer | `Intent-protocol/cashtoken-relayer` | `localhost:3001` | chipnet and mainnet, one instance, `network` in each request |
| USDC across chains (Circle CCTP) | cctp-swap-server | `Intent-protocol/arc-cctp/cctp-swap-server` | `localhost:3012` testnet, `localhost:3013` mainnet | one instance per network |
| Solana token swaps (Jupiter) | cctp-swap-server | same | the mainnet instance | mainnet only |

URLs are build-time variables: see [`../developers/configuration.md`](../developers/configuration.md).

## Routing

`swap/tokens.ts`:

- `bchTokens`, `cctpTokens`, `jupiterTokens` build the selector's rows. Each row carries the `product` that can trade it.
- `resolveRoute(sell, buy, config)` returns `cashtoken`, `cctp`, `jupiter` or `none` with a reason key.
- `counterpart(picked, other, all, config)` changes the other side after a pick when the pair would otherwise have no route, so a user stays inside one product without thinking about it.

Differences from the frontend's `resolveRoute`:

- There is no "existing flow" fallthrough. The frontend returns `null` for pairs `BCHSwapContext` owns; the wallet has no such context, so anything unrecognised is `none`.
- The wallet never uses the testnet swap server in mainnet mode. If no mainnet instance is configured, mainnet has BCH swaps only.
- Tokenized stocks are filtered out of every list.

## BCH ↔ CashTokens (`swap/cashtoken.ts`)

A market swap is a Dutch-auction intent.

1. `POST /router/quote { sellToken, buyToken, sellAmount, network }` → `{ buyAmount }`. Tokens are a category (hex, no prefix) or `'BCH'`. Amounts are base units. `'0'` means the order is too small to cover the solver's costs; the card says so.
2. `POST /intent/create { makerAddress, sellToken, buyToken, sellAmount, buyAmount, orderType: 'dutch', duration, expiryTime, network }` → `{ intentId, contractAddress, tokenAddress }`. The relayer compiles a covenant whose address is derived from these terms.
3. **Fund the covenant** with one transaction from the wallet, through `mainnet-js`:
   - selling BCH: `send([{ cashaddr: contractAddress, value: sellAmount }])`
   - selling a token: `send([new TokenSendRequest({ cashaddr: tokenAddress, category, amount, value: 1000n })])`
4. Poll `GET /intent/:id` every 4 seconds until `filled`, `refunded`, `expired`, `cancelled` or `failed`.

What the user is told, and why:

- **Auction floor.** The relayer sets the auction to decay from the quoted amount to half of it (`endBuy = buyAmount / 2n` in `/intent/create`). The card shows the quote as the expected amount and half of it as the floor.
- **Refund.** If no solver fills the order, the covenant returns the deposit after the auction. The wallet does not build that transaction: the relayer's solver broadcasts the refund. If the relayer is down for good, recovering the deposit needs the covenant's `cancel()` path built by hand, which the wallet does not offer yet (see [`known-limitations.md`](known-limitations.md)).
- **Duration** comes from Settings → Trading defaults (5 to 300 seconds, default 60).

The frontend funds the covenant with CashScript's `TransactionBuilder`. The wallet uses `mainnet-js`'s own coin selection instead, which already keeps token UTXOs out of plain BCH sends, and saves the dependency.

## USDC across chains (`swap/flows.ts`, ported)

`flows.ts`, `signers.ts`, `api.ts`, `types.ts` and `journal.ts` are ports of `frontend/src/swap-server/`. Keep them in step with the frontend; the server's API is the contract. The differences are listed at the top of each file:

- `journal.ts` persists to `chrome.storage.local`, which is asynchronous. `set()` returns a promise that settles when the entry is on disk, and `flows.ts` awaits it before broadcasting.
- `signers.ts` takes RPC URLs from `lib/chains.ts`.
- `api.ts` drops the "production build must not call localhost" guard, which is a website concern.

The flow, for an EVM source:

1. `GET /quote?src&dst&amount` (decimal USDC) for the card.
2. `POST /transfers` → the record and unsigned transactions: `approve` (when needed), `burn`, `fee`.
3. Each is signed with the in-wallet key. The hash is written to the journal **before** broadcast; the burn is reported with `POST /transfers/:id/burn` as soon as it is out.
4. The server waits for Circle's attestation and delivers on the destination. The card polls `GET /transfers/:id`.

A Solana source has one transaction, already carrying the fee; it is sent through `POST /transfers/:id/broadcast` so the server forwards only the burn it built.

### Interrupted transfers

The rules the port keeps, with where the wallet surfaces them:

| Situation | What happens |
|---|---|
| The view closed after the burn was broadcast but before it was reported | `recoverUnreported()` (`swap/runtime.ts`) runs when the Swap screen opens and reports the journaled hash. Nothing is signed twice. |
| The burn is out, the fee was never sent | The server holds the delivery. Activity shows **Pay the service fee to finish delivery**, which calls `payFee`. |
| The transfer was created and never signed | Activity shows **Resume this transfer**, which calls `resumeBridge`. After the record expires nothing was sent and it is marked failed. |
| The burn record expired on the server but the USDC is burned | `flushJournal` hands the hash to `POST /track`. |

Not ported: the "deliver it myself" button (`selfMint`). The function is in `flows.ts`; no screen calls it yet.

## Solana swaps (`swap/solana.ts`, ported)

1. `GET /solana/quote` with the taker, so Jupiter also checks the wallet can pay (`takerCheck`).
2. `POST /solana/swaps` → an unsigned versioned transaction.
3. Sign with the in-wallet keypair, `POST /solana/swaps/:id/execute`.
4. `RESULT_UNKNOWN` or `IN_PROGRESS` means poll `GET /solana/swaps/:id`. A second swap is never created for the same intent.

Token search: Jupiter's verified list first, then the wide search for anything else, with unverified and suspicious tokens marked in the selector and warned about on the card.

## Amount units

The easiest thing to get wrong:

| Call | Unit |
|---|---|
| `/quote`, `/transfers` | decimal USDC: `"1.5"` |
| `/solana/*` | integer base units of the input token: `"1500000"` |
| relayer `/router/quote`, `/intent/create` | integer base units (satoshis for BCH) |

Arc is the odd chain: USDC is its native asset with 18 decimals, and the bridge counts it with 6. `balanceOf` in `swap/tokens.ts` converts, and there is a unit test for it.

## Activity

Every swap writes an entry to `lib/activity.ts` at the moment the first transaction is signed, with a `ref` to the service's record. The Activity screen reconciles pending entries against that record on open and every 12 seconds, so a swap whose view was closed still ends in the right state.

## What is verified, and what is not

See [`testing.md`](testing.md). In short: routing, request shapes, error display and the journal are covered by unit and end-to-end tests against mocked services. No swap has been signed and settled from the extension, because that needs the services running and a funded wallet.
