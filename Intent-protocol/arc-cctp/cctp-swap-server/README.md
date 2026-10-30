# cctp-swap-server

USDC on chain A → USDC on chain B through Circle CCTP V2, presented as a swap.

The user's wallet signs the burn on chain A. This server tracks the burn, fetches Circle's attestation, submits the mint on chain B (paying the gas), and reports status. It never holds user funds. Every burn sets `destinationCaller = 0`, so if this server is down the user can mint themselves with the `message` and `attestation` from `GET /transfers/:id`.

Testnet chains: Ethereum Sepolia, OP Sepolia, Arbitrum Sepolia, Base Sepolia, Arc testnet, Solana devnet. Design and plan: [PLAN.md](PLAN.md), [../docs](../docs).

## Quick start

```bash
npm install
npm run gen:keys          # writes missing relayer / E2E / admin keys to .env, prints addresses
npm run check:balances    # what each wallet still needs
npm run dev               # http://localhost:3012
```

## Client flow

```
GET  /quote?src=base-sepolia&dst=arc-testnet&amount=1          → speed, fee, receive, ETA
POST /transfers {src,dst,amount,sender,recipient,speed?}        → {transfer, quote, txs}
     wallet signs + sends txs in order (EVM: approve?, burn; Solana: one burn tx, already signed by the event key)
POST /transfers/:id/burn {txHash}                              → tracking starts
GET  /transfers/:id                                            → poll until COMPLETED
```

| Status | Meaning |
|---|---|
| `CREATED` | txs returned, waiting for the burn hash (expires after `CREATED_TTL_MIN`) |
| `BURN_SUBMITTED` | burn hash received |
| `BURN_CONFIRMED` | burn landed and matches the quote; waiting for Circle |
| `ATTESTED` | message + attestation stored; mint next |
| `MINT_SUBMITTED` | relayer broadcast the mint |
| `COMPLETED` | minted by the relayer |
| `COMPLETED_EXTERNAL` | nonce already used: minted by the user or someone else |
| `FAILED` / `EXPIRED` | see `failReason` |

Other routes:
- `GET /health`, `GET /chains`.
- `GET /config`: both products in one call (open or paused, limits, fee policy, slippage bounds, chains), for a client to shape its form.
- `GET /transfers?address=`.
- `GET /activity?address=`: transfers and Solana swaps for up to five addresses as one list; without an address, the public feed.
- Every error is `{ error, code }`. The codes are listed in `../jupdocs/04-frontend-api.md`.
- `POST /transfers/:id/rebuild`: a new Solana tx when the blockhash expired before signing.
- `POST /track {src, txHash}`: pick up any CCTP burn made outside the API.
- `/admin/balances`, `/admin/pause`, `/admin/resume` and `/admin/transfers/:id/retry`, all behind `x-admin-key`. Pausing blocks new transfers only; transfers already in flight keep being relayed.

Chain notes:
- **Arc.** Gas is paid in USDC from the same balance, so the user needs a little extra when sending from Arc. Every Arc tx is sent with `maxFeePerGas ≥ 20 gwei`; lower-priced txs are silently dropped. Arc is Standard-only, and its attestation takes ~0.5 s.
- **Solana as destination.** The burn's `mintRecipient` is the recipient's USDC token account. The relayer creates it if it is missing.
- **Solana as source.** The burn tx is partly signed by a fresh event keypair. The user signs as fee payer and owner, and pays the rent (~0.003 SOL) for the event account.

## Solana swaps (Jupiter)

The same server also swaps any Solana token for any other on **mainnet** through Jupiter's Swap API v2, tokenized stocks included. The user signs; Jupiter lands the transaction; no relayer key is involved. Docs: [../jupdocs](../jupdocs).

```
GET  /solana/tokens | /solana/tokens/search?q= | /solana/stocks | /solana/prices?ids=
GET  /solana/quote?inputMint&outputMint&amount[&taker]         → amounts, route, fee, warnings
POST /solana/swaps {inputMint,outputMint,amount,taker}          → {swap, quote, tx}
     wallet signs tx.serializedTx (does not send it)
POST /solana/swaps/:id/execute {signedTransaction}             → COMPLETED | FAILED
GET  /solana/swaps/:id                                         → poll only after a 502
```

Solana amounts are base units; cross-chain amounts are decimal USDC. Set `JUPITER_API_KEY` before real traffic.

## Admin, fees and treasury

Everything under `/admin/*` needs `x-admin-key`. The console lives in the frontend at `/admin/swap` (overview, transfers, chains and relayer gas, Solana swaps, tokens and stocks, profits and treasury, settings, events).

- **Controls, changeable while running** (`data/settings.json`): pause each product, close a chain or a single route, switch relaying or Fast off, limits, slippage caps, stocks and unverified tokens on or off, a token blocklist.
- **Our margin** (docs: [../jupdocs/06-fees-and-profits.md](../jupdocs/06-fees-and-profits.md)):
  - Cross-chain: `feeBps`, `feeMinUsdc`, `feeMaxUsdc`, a flat `gasFeeUsdc` per destination. Paid as a USDC transfer to the treasury on the source chain (EVM: a third transaction; Solana: inside the burn transaction). With `feeEnforced`, the mint waits until the fee is seen.
  - Solana swaps: Jupiter's referral fee, 0 or 50-255 bps, with separate rates for stocks and stablecoin pairs. Needs a referral account.
- **Treasury wallets** (`data/treasury.json`): generated on the server (key in `data/treasury-keys/`, printed only by `npx tsx scripts/treasury_export.ts <address> --show`) or external watch-only addresses. One active wallet per chain type.
- **Event log** (`data/events.jsonl`): every status change, fee, operator action and watchdog warning.

`data/` holds transfers, swaps, settings, events and treasury keys. Back it up privately; it is gitignored.

## Tests

| Command | What | Needs |
|---|---|---|
| `npm run test:unit` | encoding, quote maths, store, worker state machine (restart, double-mint, external mint, re-attest, backoff), Solana swaps against a fake Jupiter | nothing |
| `npm run test:short` | REST API against a running server, including decoded calldata; `/solana/*` against live Jupiter (read-only) | `npm run dev` |
| `npm run test:all:long` | live transfers on 6 routes, plus the track + self-mint test | server + funded wallets |
| `npx tsx scripts/live_scenarios.ts` | live operator scenarios: relaying off, pause mid-flight, parallel, amounts; `SCENARIO=fee-hold` for a skipped fee | server + funded wallets |
| `bash scripts/restart_during_mint.sh` | stops the server while a mint is in flight; it must deliver once after the restart | server + funded wallets |
| `PAIR=USDC-SOL AMOUNT=1 npx tsx scripts/e2e_solana_swap.ts` | one real Jupiter swap on mainnet | server + SOL/USDC on mainnet |
| `ONLY=2 npm run e2e` | one live route; `SLOW=1` adds the 15-19 min Standard route | server + funded wallets |
| `npx tsx scripts/spike_readonly.ts` | live read-only checks of every chain and Iris | network |

Every live run appends to `tests/measurements.jsonl` and regenerates [../docs/04-measurements.md](../docs/04-measurements.md).

## Funding for the live tests

`npm run check:balances` prints the exact list. In short:

| Wallet | Needs |
|---|---|
| relayer (EVM) | Sepolia ETH on Eth/Base/Arb/OP Sepolia, and Arc testnet USDC for gas |
| relayer (Solana) | devnet SOL |
| E2E user (EVM) | Sepolia ETH plus faucet USDC on Eth/Base/Arb Sepolia, and Arc testnet USDC |
| E2E user (Solana) | devnet SOL and faucet USDC |

Faucets: [faucet.circle.com](https://faucet.circle.com) for USDC on every chain, including Arc; [faucet.solana.com](https://faucet.solana.com) for devnet SOL.

## Deploy (Railway)

Dockerfile + `railway.toml` follow `bsc-bch-server`. Mount a volume at `/app/data` so transfer state survives redeploys. Set `CCTP_RELAYER_EVM_KEY`, `CCTP_RELAYER_SOLANA_KEY` and `ADMIN_API_KEY` as sealed variables. Use provider RPCs instead of the public ones; the public Arc testnet RPC timed out once during testing.

## Not done yet

- No signed Jupiter swap has landed on mainnet through this server; it needs a funded mainnet wallet. No Jupiter API key or referral account is set up.
- Live results are in [../jupdocs/05-live-test-report.md](../jupdocs/05-live-test-report.md): 23 routes across six testnet chains delivered; no Jupiter swap has executed yet.
- The cross-chain fee can be skipped by anyone who burns on Circle's contracts directly and mints themselves. A fee that cannot be skipped needs the router contract in PLAN.md.
- Solana event-account rent reclaim (`reclaim_event_account`) is not implemented.
- The Circle Forwarding Service fallback (planned).
- Storage is a single JSON file, which is fine for testnet. Consider SQLite before mainnet volume.
