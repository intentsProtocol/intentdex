# Plan: cctp-swap-server, USDC chain A → USDC chain B via Circle CCTP V2

## Status (2026-10-08)

| Step | State |
|---|---|
| 0 Spike | Done. Findings in [../docs/05-cctp-server-spike.md](../docs/05-cctp-server-spike.md). |
| 1 Scaffold | Done |
| 2 Quotes | Done |
| 3 Core | Done: atomic JSON store, state machine, worker |
| 4 EVM | **Proven live** on Ethereum, OP, Arbitrum and Base Sepolia and on Arc testnet |
| 5 Solana | **Proven live** on devnet, both directions. The mint needed a v0 transaction with a lookup table (found by the first live run). |
| 6 Hardening | Done and exercised live: `/track` with a user self-mint, pause mid-flight, relaying off, stop and reopen, server stopped mid-mint |
| 7 Deploy | Not started |

Added since the original plan, all documented in [../jupdocs](../jupdocs):

| Addition | State |
|---|---|
| Solana swaps through Jupiter (`/solana/*`), tokenized stocks included | Quotes proven live; no swap executed yet |
| Bitcoin Cash (BCH) swaps through NEAR Intents 1Click (`/bch/*`) | Researched, depth measured live ($25k max), plan in [BCH_INTEGRATION_PLAN.md](BCH_INTEGRATION_PLAN.md) and [../nearintentsdocs](../nearintentsdocs) |
| Admin API, runtime settings, event log, and the console at `/admin/swap` in the frontend | Done |
| Our fee on both products, treasury wallets, profit tracking | Cross-chain fee proven live; the Jupiter fee needs a referral account on mainnet |
| User-facing frontend | Not started: [../jupdocs/08-frontend-integration-handoff.md](../jupdocs/08-frontend-integration-handoff.md) |

Tests: 235 unit and 124 REST pass. Live results: [../jupdocs/05-live-test-report.md](../jupdocs/05-live-test-report.md).

The rest of this file is the original plan of 2026-09-28, kept for its reasoning. Where it says a step has not run, the table above is the current state.

## Context
We want the BCH Intents app to offer "USDC on chain A → USDC on chain B" so it feels like a normal swap, with Circle CCTP V2 doing the work underneath.

**How it works:**
- The user's own USDC is burned on chain A and minted to the user on chain B.
- There is no solver, no HTLC, and the server never holds user funds.
- The server quotes, builds the unsigned txs, tracks the burn, fetches Circle's attestation, submits the destination mint (paying gas), and reports status.

**Agreed scope for this phase:**
- **Chains:** EVM testnets + Arc testnet + Solana devnet.
- **Mint relay:** our relayer submits the mint. Circle's Forwarding Service comes later.
- **Deliverable:** the server plus scripted live E2E tests. No frontend yet.

A future phase adds any token → any token, with DEX swaps on each side (see the last section).

**Background:** [arc-cctp/docs/01-verified-facts.md](../docs/01-verified-facts.md) (addresses, domains, attestation times, fees, Arc quirks). The server is item R9 of [03-implementation-plan.md](../docs/03-implementation-plan.md).

## Phase-1 chain set (testnet)
The EVM CCTP V2 contracts use the same address on every EVM testnet: TokenMessengerV2 `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`, MessageTransmitterV2 `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`.

| Chain | Domain | chainId | USDC | Notes |
|---|---|---|---|---|
| Ethereum Sepolia | 0 | 11155111 | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | Fast source |
| OP Sepolia | 2 | 11155420 | `0x5fd84259d66Cd46123540766Be93DFE6D43130D7` | Fast source |
| Arbitrum Sepolia | 3 | 421614 | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | Fast source |
| Solana devnet | 5 | – | mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | See Solana notes below |
| Base Sepolia | 6 | 84532 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | Fast source |
| Arc testnet | 26 | 5042002 | `0x3600000000000000000000000000000000000000` | Standard only, ~0.5 s. 20 gwei fee floor. Gas is paid in USDC. |

- **Solana programs:** TokenMessengerMinterV2 `CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe`, MessageTransmitterV2 `CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC`. Same IDs on devnet and mainnet.
- **Later:** Avalanche Fuji, Polygon Amoy and Unichain Sepolia are config-only additions.

**Solana specifics:**
- **Solana as destination:** `mintRecipient` must be the recipient's **USDC token account (ATA)**, not their wallet address. That account must exist before the mint, so the relayer creates it idempotently.
- **Solana as source:** `deposit_for_burn` needs a fresh message-event keypair as a co-signer. Its rent can be reclaimed later with `reclaim_event_account`.

## Key decisions
- **New standalone service** at `arc-cctp/cctp-swap-server`, with its own relayer keys. It does not reuse the solver key, so a leak affects only this service.
- **Structure copied from `bsc-bch-server`:** Fastify, ESM, Node 20, `tsx`, ethers v6, the `ChainConfig` registry, `secrets.ts`, the tests harness, Dockerfile and `railway.toml`. It also takes the better patterns from `sol-bch-zk-server` (strict tsconfig, save on every update, `retryAfter` backoff) and `cashtoken-relayer` (a `TERMINAL_STATUSES` set).
- **`destinationCaller = 0` on every burn**, so anyone can mint. If our relayer dies, the user can mint themselves from the message and attestation the server exposes, so funds can't get stuck because of us.
- **Only transfers registered through our API are relayed** (`POST /transfers` or `/track`), with a minimum amount and a rate limit, so nobody can drain the relayer's gas.
- **Raw CCTP calls, not Bridge Kit.** Bridge Kit runs the whole flow in the client. We need a server-side relay and state tracking, and a custom router with hooks later.
- **Solana instructions:** start from Circle's `circlefin/solana-cctp-contracts` `examples/v2` code (PDA derivation, `bridge-v2`) and the V2 IDLs. Use `@solana/web3.js` v1 + `@coral-xyz/anchor` + `@solana/spl-token` 0.4, matching `sol-bch-zk-server`. If the IDLs don't work with our Anchor version, build the instructions by hand from the discriminators and account order in Circle's Solana→Arc quickstart.

## Project layout (`arc-cctp/cctp-swap-server/`)
```
package.json          ESM; fastify ^4, @fastify/cors, @fastify/rate-limit, dotenv, ethers ^6.13,
                      @solana/web3.js ^1.98, @coral-xyz/anchor, @solana/spl-token ^0.4, bs58; tsx (dev)
tsconfig.json         copy of sol-bch-zk-server/tsconfig.json (strict, bundler resolution)
Dockerfile, railway.toml   from bsc-bch-server, without the Rust/Miden stage
.env.example
src/index.ts          Fastify app, routes, startup, SIGTERM/SIGINT graceful shutdown (new)
src/config.ts         chain registry + limits (pattern: bsc-bch-server/src/config.ts ChainConfig/buildChains)
src/secrets.ts        copied verbatim from bsc-bch-server/src/secrets.ts
src/types.ts          Transfer, TransferStatus, TERMINAL_STATUSES (pattern: cashtoken-relayer/src/intentStore.ts)
src/store/TransferStore.ts    one JSON store in data/, atomic write (tmp + rename), save on every update
src/cctp/iris.ts      IrisClient: messages, fees, fast allowance, reattest; backoff; ≤ 40 req/s
src/cctp/quote.ts     fee/maxFee/receive-amount/ETA/speed selection
src/cctp/encoding.ts  bytes32 helpers (EVM pad, Solana pubkey, ATA), message-header parsing (nonce, domains)
src/evm/EvmCctp.ts    build approve+burn calldata, verify DepositForBurn receipt, receiveMessage, usedNonces check
src/evm/TxSender.ts   per-chain serialized sender: nonce control, EIP-1559 + per-chain floor (Arc 20 gwei),
                      wait timeout + fee-bump replacement, pending tx hash saved before waiting
src/solana/SolanaCctp.ts  build burn tx (partly signed by the event keypair), verify burn,
                      ensure recipient ATA, receive_message + remaining accounts, used-nonce check
src/solana/idl/       vendored Circle V2 IDLs + PDA helpers adapted from examples/v2
src/worker/TransferWorker.ts  poll loop, inFlight set, retryAfter backoff, per-status handlers
src/admin.ts          x-admin-key onRequest hook using crypto.timingSafeEqual (new; no repo precedent)
tests/lib/{report.ts,env.ts}, tests/run-all.ts   copied from bsc-bch-server/tests
tests/unit/*, tests/short/*, tests/long/*, scripts/e2e_transfer.ts
```

## Transfer lifecycle
```
CREATED ─(client posts burn tx hash)→ BURN_SUBMITTED ─(receipt/event verified)→ BURN_CONFIRMED
  ─(Iris status complete)→ ATTESTED ─(relayer sends mint; hash saved first)→ MINT_SUBMITTED ─→ COMPLETED
Terminal: COMPLETED | COMPLETED_EXTERNAL (nonce already used: user or someone else minted)
        | FAILED (burn invalid / reverted) | EXPIRED (no burn within TTL)
```

**Transfer record fields:**
- ids and route: id, srcChain, dstChain, srcDomain, dstDomain;
- parties: sender, recipient (for Solana, the wallet and derived ATA);
- amounts: amount, speed, minFinalityThreshold, maxFee, feeQuotedBps;
- burn: burnTxHash, eventAccount (Solana);
- attestation: message, attestation, nonce;
- mint: mintTxHash, feeExecuted, received;
- bookkeeping: attempts, retryAfter, failReason, per-step timestamps.

**Rules:**
- Save before every external action.
- On restart, a transfer in `MINT_SUBMITTED` checks its saved receipt and the used-nonce state before sending the mint again.
- A mint that fails with "nonce already used" counts as success (`COMPLETED_EXTERNAL`).
- A `retryAfter` backoff separates transient failures from permanent ones (pattern: `sol-bch-zk-server` `SolanaBCHZKCore.ts` ~L544-572).

## API
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | status, enabled chains, counts. No RPC calls. |
| GET | `/chains` | chain registry for clients |
| GET | `/quote?src&dst&amount&speed=auto\|fast\|standard` | mode, `minFinalityThreshold`, `maxFee`, fee, receive amount, ETA, warnings (e.g. keep USDC for gas on Arc) |
| POST | `/transfers` | `{src,dst,amount,sender,recipient,speed}` → `{id, quote, txs}`. EVM: `[approve?, depositForBurn]` as `{chainId,to,data}`. Solana: base64 tx partly signed by the event keypair, plus blockhash expiry. |
| POST | `/transfers/:id/rebuild` | fresh Solana tx if the blockhash expired before the user signed |
| POST | `/transfers/:id/burn` | `{txHash}`, which starts tracking |
| GET | `/transfers/:id` | status, tx links, timings, and `message`/`attestation` once available (self-mint fallback) |
| GET | `/transfers?address=` | history |
| POST | `/track` | `{src, txHash}`: recover any CCTP burn that wasn't registered through `/transfers` |
| GET/POST | `/admin/balances`, `/admin/pause`, `/admin/resume` | behind `x-admin-key` |

**Quote rules:**
- Fees come from Iris `/v2/burn/USDC/fees/{src}/{dst}`, cached for about 30 s. `maxFee = ceil(amount × bps × 1.2 / 10000)`.
- `receive = amount − fee`, because V2 deducts the fee on the destination mint.
- **Speed `auto`:** Standard when the source's Standard ETA is ≤ 60 s (Arc ~0.5 s, Solana ~25 s). Otherwise Fast, if the Fast allowance (`/v2/fastBurn/USDC/allowance`) covers the amount. If it doesn't, Standard with the 15-19 min ETA.
- **Validation:** src ≠ dst, amount in 6-decimal units, `MIN_TRANSFER` (1 USDC) ≤ amount ≤ `MAX_TRANSFER` (testnet 100 USDC), recipient format checked per chain, pause flag honored.

## Relayer operations
- **Keys, via `getSecret`:**
  - `CCTP_RELAYER_EVM_KEY`, one address on every EVM chain;
  - `CCTP_RELAYER_SOLANA_KEY`, a JSON byte array (same pattern as `SolanaZKService`).
- **Gas to fund:**
  - Sepolia ETH on Eth, Base, Arb and OP;
  - USDC on Arc testnet, from `faucet.circle.com`;
  - devnet SOL, which also covers about 0.002 SOL of rent per new recipient token account.
- **Watchdog** (`unref`'d interval, pattern: `bsc-bch-server/src/index.ts` L608-651): low-balance warnings, stuck transfers (no progress in N minutes), and the Iris error rate.
- **Arc:** every EVM tx builder applies `maxFeePerGas ≥ 20 gwei`. The quote tells users sending from Arc to keep a little extra USDC for gas.

## Implementation order
0. **Spike, about half a day.** Standalone scripts in `scripts/spike/` for three flows:
   - Sepolia → Arc (EVM burn + mint);
   - Solana devnet → Arc (burn);
   - Arc → Solana devnet (mint with Circle's `examples/v2` code).

   Confirm the fees API response shape, the `DepositForBurn`/`MintAndWithdraw` event ABIs, the V2 message header layout (nonce offset), the `usedNonces` getter, the Solana IDL and Anchor compatibility, and the full `receive_message` remaining-account list. Record the findings in `arc-cctp/docs/05-cctp-server-spike.md`.
1. **Scaffold** from `bsc-bch-server`: package, tsconfig, `secrets.ts`, Dockerfile, `railway.toml`, tests harness, `config.ts` chain registry.
2. **Quotes:** `IrisClient` + `quote.ts` + `/chains` + `/quote`, with unit tests.
3. **Core:** `TransferStore`, the state machine and the worker skeleton, with unit tests (transitions, atomic save/reload).
4. **EVM:** `EvmCctp` + `TxSender`, then run live E2E routes 1-3.
5. **Solana:** `SolanaCctp` (burn tx builder, burn verification, ATA ensure, `receive_message`), then run live E2E routes 4-6.
6. **Hardening:** `/track` recovery, admin auth, watchdog, graceful shutdown, failure tests.
7. **Deploy** to Railway (testnet) and run the full matrix against the deployed URL.

## Verification
**Unit** (`npm run test:unit`, no network, `tsx` + `report.ts` harness):
- quote math and rounding, and the maxFee buffer;
- bytes32 encoding for EVM, Solana pubkeys and ATAs;
- message-header parsing;
- status transitions and the terminal set;
- store atomic write and reload;
- Iris parsing against pending, complete and 404 fixtures;
- event parsing from recorded receipts;
- the Arc fee floor.

**Short** (`npm run test:short`, against `npm run dev`):
- `/chains`;
- `/quote` validation errors;
- `/transfers` calldata decoded and checked arg by arg;
- admin routes reject requests without the key;
- rate limit.

**Long, live testnet** (`ONLY=<route> npx tsx scripts/e2e_transfer.ts`):
- The script plays the user with its own funded keys (`E2E_EVM_KEY`, `E2E_SOLANA_KEY`). It signs the returned txs, posts the burn hash, polls `/transfers/:id` until `COMPLETED`, and asserts the recipient's balance went up by exactly `received`.
- It logs per-step timings to `tests/.results.jsonl` and writes `arc-cctp/docs/04-measurements.md`, which is the Phase-0 measurement table from docs/03.

| # | Route | Exercises |
|---|---|---|
| 1 | Eth Sepolia → Arc | Fast; mint on Arc with the fee floor and USDC gas |
| 2 | Arc → Base Sepolia | Standard from Arc (seconds) |
| 3 | Base Sepolia → Arb Sepolia | Fast L2 → L2 |
| 4 | Arb Sepolia → Solana devnet | Solana mint, token-account creation, `receive_message` |
| 5 | Solana devnet → Arc | Solana burn, partly signed tx, event keypair |
| 6 | Solana devnet → Base Sepolia | Standard from Solana (~25 s) |
| 7 | Base Sepolia → OP Sepolia, Standard (`SLOW=1`, run once) | the 15-19 min path; long poll |

**Failure scenarios** (`tests/long/failure_*.ts`):
- Kill the server in `BURN_SUBMITTED` and again in `MINT_SUBMITTED`, restart, and expect `COMPLETED` with exactly one mint.
- The user mints first using `/transfers/:id` message and attestation; expect `COMPLETED_EXTERNAL`.
- Post an unrelated or mismatched burn hash; expect `FAILED` with a reason.
- Drain the relayer's gas on the destination; expect it to stay `ATTESTED` with retries, and the user self-mint to still work.
- An expired Solana blockhash; `/rebuild` returns a signable tx.

**Gate:** `npm run test:all:long` passes on the Railway deployment, with all 7 routes green and the failure scenarios green.

## Not in this phase: frontend pointers
- Slot into `/trade`:
  - add `'usdc-cctp'` in `detectSwapType` **before** the same-chain fallthrough (`frontend/src/context/BCHSwapContext.tsx` ~L185-197);
  - add a new `lib/cctpSwapApi.ts` modeled on `lib/bscBchApi.ts`;
  - add `VITE_CCTP_SWAP_SERVER_URL` in `lib/config.ts`;
  - add `executeUsdcCctp` modeled on `executeETHToBCH` (~L1684-1788).
- Signing: EVM through `getEvmSignerForChain` (`lib/evmChains.ts` L178-192); Solana through the keypair adapter at `BCHSwapContext.tsx` ~L106-113.
- Add Arc and the spoke USDC addresses to `lib/evmChains.ts` and `BCHTokenSelector.tsx`.
- The browser extension can only sign BCH today, and its dApp bridge is broken, so it is out of scope.

## Future phase: any token (A) → any token (B)
**Contracts** in `contracts-evm` (hardhat, solc 0.8.24, OpenZeppelin 5, mocha tests):

| Contract | Role |
|---|---|
| `CctpSourceRouter` | Pull `tokenIn` via Permit2, swap to USDC through an allowlisted DEX target with `minUsdcOut`, take the protocol fee (bps), then `depositForBurnWithHook(mintRecipient = dstRouter, destinationCaller = dstRouter)`. Pausing blocks new burns only. |
| `CctpDestinationRouter` | Permissionless `relay(message, attestation, swapTarget, swapData)`: `receiveMessage`, amount by balance delta, decode hookData, then `try` swap with `minOut` and send `tokenOut`, `catch` or past deadline sends USDC. Accept hooks only from allowlisted source routers (burn message `messageSender`). Never pausable; nonReentrant; sweeps no balance beyond what was minted. |
| `MockSwapRouter` | Fixed-rate swaps between Circle USDC and `MockERC20`, for testnets, which have little or no real DEX liquidity. |

**Parts:**
- **hookData v1:** `{version, recipient, tokenOut, minOut, deadline}`.
- **Server additions:**
  - a route finder with aggregator quotes on each side (an EVM aggregator such as 0x or 1inch; Jupiter on Solana);
  - composed quotes (source swap → CCTP fee → destination swap, with slippage);
  - the executor calls `dstRouter.relay` with fresh destination swap calldata while the attested `minOut` still binds;
  - new terminal statuses `DELIVERED_TOKEN` and `DELIVERED_USDC_FALLBACK`.
- **Solana:**
  - Source first: a Jupiter swap plus `deposit_for_burn_with_hook` in one tx.
  - Destination last: it needs a Solana program that receives into a PDA and swaps by CPI.

**Milestones:**

| | Scope | Test |
|---|---|---|
| F1 | Routers + mocks | Hardhat unit tests (fallback, deadline, allowlist, reentrancy, dust) |
| F2 | EVM any→any | Testnets with `MockSwapRouter` |
| F3 | Real aggregators | Mainnet, small amounts, on Base and Arbitrum |
| F4 | Solana source swaps, then Solana destination program | Devnet, then mainnet small |

A security review of both routers is required before mainnet.
