# Borrow — implementation plan

A **Borrow** feature for the extension. First release: borrow USDC on Ethereum against BTC through Liquidium.
BCH loans through ParyonUSD are shown as "coming soon" and built later.

Research, terms and risks: [`../../../borrow&lend/`](../../../borrow&lend/README.md). SDK field names used here were
checked against `@liquidium/client` 0.10.0; the copy of its API reference is in
`borrow&lend/liquidium-research-doc/materials/`.

Status: plan only. Nothing here is built.

---

## 1. Scope

| In the first release | Later |
|---|---|
| BTC collateral → USDC on Ethereum (Liquidium Simple Loan) | USDT as the borrowed asset, ETH as collateral |
| Open, track, repay (part or all), collateral returned | Supply to earn (Liquidium profile flow) |
| Loans restored from the seed alone | Liquidation alerts while the wallet is closed |
| Mainnet only; explained state on testnet | Our service fee (needs our own Bitcoin transaction builder, see 9) |
| "BCH loans — coming soon" card | ParyonUSD: PUSD token, read-only loans, borrowing |

No server of ours. No new permission in the manifest.

## 2. What the code base gives us, and what it does not

| Need | Today | Gap |
|---|---|---|
| BTC address and key | `btcAccount` in `Signers`, native SegWit (`bc1q…`) | None |
| Send an exact BTC amount | `sendAsset()` → `btcAccount.sendTransaction({ to, value })` | One recipient only. Fine for the deposit; **not** enough for a fee output in the same transaction |
| Ethereum mainnet address | `ethereum` network, `addresses.evm` | None |
| Send USDC on Ethereum | `sendAsset()` with the `erc20` asset | None |
| Gas check | `quoteSend()` returns `canPayFee` | None |
| Bridge USDC to and from Ethereum | Swap screen, CCTP | Needs an entry point from the loan page |
| Screen routing | `Screen` union in `screens/shared.tsx`, `navigate(screen, param)` in `App.tsx` | Add `'borrow'` |
| Interrupted-flow journal | `swap/journal.ts` pattern in the core | A loan journal of the same shape |
| Activity entries | `ActivityKind` is `send, receive, swap, bridge, sign, connect` | Add `borrow` and `repay` |
| Strings | `en` and `zh-CN` catalogues in the core | New `borrow.*` keys in both |
| E2E mocking | Playwright `page.route` on service URLs | Liquidium reads go to ICP canisters (binary); use a mock client instead (see 11) |

## 3. Architecture

```
bch-intents-wallet-core/src/lend/          no SDK import, no keys, no platform API
  types.ts        LendClient interface, Loan, LoanStatus, Market, Quote (plain shapes, bigint amounts)
  liquidium.ts    pure logic: status → UI step, health, liquidation price, validation, polling rule
  store.ts        loan records and the deposit/repay journal, on the host's KeyValueStore
  fees.ts         service-fee maths (rate 0 in the first release)

bch-intents-wallet-extension/src/lend/
  liquidium-client.ts   implements LendClient with @liquidium/client, loaded by dynamic import
  mock-client.ts        scripted LendClient for e2e builds only
  runtime.ts            deposit and repay through lib/send.ts with the active account's Signers
  useLoans.ts           React hook: market, loans of the active account, polling

bch-intents-wallet-extension/src/popup/screens/
  Borrow.tsx            the screen and its views
  borrow/               one file per view once Borrow.tsx passes ~400 lines
```

Why the SDK stays out of the core: the core is shared with the mobile app, and the SDK is not yet proven in React
Native. The core defines the `LendClient` interface and all logic against it; each host supplies the client. This
also keeps the SDK out of every context except the wallet UI (rule 2) and lets tests run against a fake.

```ts
// core/src/lend/types.ts (outline)
export interface LendClient {
  market(): Promise<Market>;                         // pools + prices, with fetchedAt
  quote(m: Market, collateral: bigint, borrow: bigint): Quote;
  create(req: CreateLoanRequest): Promise<Loan>;     // never retried by callers
  get(ref: string): Promise<Loan>;
  find(addressOrRef: string): Promise<LoanMatch[]>;
  activities(ref: string): Promise<LoanActivity[]>;  // confirmations, top-up shortfall
}
```

The SDK chunk loads only when the Borrow screen opens (`await import('@liquidium/client')`), so start-up and the
other screens do not pay for `@icp-sdk/*` and `viem`.

## 4. Navigation and entry points

| Entry point | Where | Opens |
|---|---|---|
| Quick action "Borrow" | Home, next to Send / Receive / Swap | Borrow hub |
| "Borrow against BTC" button | Asset sheet of BTC (mainnet) | New loan, BTC preselected |
| Loan card | Home, above the token list, only while a loan is open | That loan's page |
| Activity entry of kind `borrow` or `repay` | Activity | That loan's page |

The bottom bar keeps its four tabs. `Screen` gains `'borrow'`; `param` carries a view or a loan reference:
`navigate('borrow')`, `navigate('borrow', 'new')`, `navigate('borrow', 'loan:ABC123')`. Borrow manages its own
views internally, as Settings does with `initialView`.

## 5. Pages

Every page uses `PageHeader`, `DetailCard`/`DetailRow`, `Banner`, `MPrimary`/`MSecondary`, `Sheet`, `Skeleton`
and `EmptyState` from the design system. Inline styles with `MX` tokens only.

### 5.1 Borrow hub — `borrow-hub`

| Element | Content |
|---|---|
| Product card: Bitcoin | "Borrow USDC against BTC", current borrow rate, max LTV, "via Liquidium" |
| Product card: Bitcoin Cash | "Borrow against BCH — coming soon", disabled, "via ParyonUSD" |
| Your loans | One row per loan: amount, status chip, health bar. Empty state when none |
| Footer link | "How borrowing works" → docs |

States: loading (skeletons), market unavailable (banner with retry; loans still listed from the cache),
testnet (see 5.9).

### 5.2 New loan — `borrow-new`

| Element | Behaviour |
|---|---|
| Collateral input | BTC amount, balance, Max, USD value. Max leaves room for the Bitcoin fee |
| Borrow input | USDC amount, USD value |
| LTV slider | Linked to the two inputs. Capped 2 points under the pool's max LTV; marks at 25 / 40 / 50%; default 40% |
| Health bar | Green / amber / red from the chosen LTV against the liquidation threshold |
| Detail card | Borrow rate (variable), activation fee, opening debt, liquidation price of BTC, time to receive (~40 min) |
| Receive-to and refund-to | The account's own Ethereum and Bitcoin addresses, shown, not editable |
| Banners | No ETH for gas later (warn, not block); amount below minimum; pool frozen; not enough BTC |
| Button | "Review" — disabled until `quote.validationErrors` is empty |

Editing either amount recomputes the other from the slider; editing the slider recomputes the borrow amount.

### 5.3 Review — `borrow-review`

| Element | Content |
|---|---|
| Summary | You lock X BTC · You receive Y USDC on Ethereum |
| Costs | Activation fee, Bitcoin network fee (from `quoteSend`), our fee (hidden while 0), opening debt |
| Risk | Liquidation price, and a plain sentence: if BTC falls to this price, part of your collateral is sold |
| Acknowledge | One checkbox: "I understand my BTC can be sold if its price falls" |
| Button | "Lock BTC and borrow" |

Confirm runs flow 6.1. The button shows progress and cannot be pressed twice.

### 5.4 Loan progress — `borrow-progress`

A step list, the same pattern as `StepList` in the Swap screen.

| Step | Done when |
|---|---|
| Loan created | `create()` returned and the record is saved |
| BTC sent | The deposit transaction id is saved |
| Confirming on Bitcoin (n of 4) | `status` leaves `deposit / confirming` |
| Sending your USDC | `status` reaches `repayment / active` |

Also: the deposit transaction on the explorer, the loan reference with a copy button, "You can close the wallet;
this continues without it." Failure states are in 7.

### 5.5 Loan page — `borrow-loan`

| Element | Content |
|---|---|
| Header | Borrowed amount, status chip |
| Health card | Health bar, current LTV, liquidation price, current BTC price, "updated n s ago" |
| Detail card | Debt now (principal + interest), collateral, borrow rate, opened on, reference |
| Actions | Repay · Move USDC to another chain (→ Swap with USDC on Ethereum preselected) · View on Liquidium |
| History | Deposit, payout, repayments, liquidations, each with its transaction link |

Banners: health in the amber zone ("Repay part of the loan to move away from liquidation"); red zone; a
liquidation has happened; repayment in progress; top-up required with the shortfall.

### 5.6 Repay — `borrow-repay`

| Element | Behaviour |
|---|---|
| Amount | USDC, with 25% / 50% / "Repay all" |
| Balance line | USDC on Ethereum in this account |
| Detail card | Debt now, transfer fee included in the quote, Ethereum gas, debt after |
| Note | Part repayments lower the debt but release no BTC; full repayment returns all of it |
| Shortfall banner | Not enough USDC on Ethereum → "Bring USDC from another chain" (→ Swap, destination Ethereum) |
| Gas banner | No ETH → explain, link to Receive ETH |
| Button | "Repay" |

"Repay all" uses the fee-inclusive `repayment.targets.ETH.amount` read at the moment of confirming, because
interest accrues every second.

### 5.7 Repay progress and closed loan — `borrow-repay-progress`, `borrow-closed`

Steps: USDC sent → Confirming on Ethereum (n of 64, about 13 min) → Debt updated → (full repayment) BTC returned.
A closed loan shows the totals: borrowed, repaid, interest paid, collateral returned, with the refund transaction.

### 5.8 Find a loan — sheet `borrow-find`

"Check again" searches by this account's addresses. An input accepts a loan reference for a loan opened elsewhere
to this wallet's addresses. Shown from the hub's empty state and its overflow menu.

### 5.9 Unavailable states

| Case | Page |
|---|---|
| Testnet mode | Explanation and a "Switch to mainnet" button (→ Settings, network) |
| No BTC | Empty state with "Receive BTC" |
| Service unreachable | Banner with retry; cached loans stay visible, marked as possibly out of date |

### 5.10 BCH loans — `borrow-pusd-soon`

A short page behind the disabled card: what it will be (borrow PUSD against BCH), that it is not available yet.
No inputs. Replaced by the real flow in phase 6.

## 6. Flows

### 6.1 Open a loan

1. Re-read the market; re-run the quote. Stop if it now fails ("Rates changed, please review").
2. `create()` with the account's Ethereum address as destination, its Bitcoin address as refund,
   `ltvMaxBps` from the quote, a deposit window of one hour.
3. **Save the loan record** (`ref`, `loanId`, account, amounts, deposit address and amount, expiry, `step: created`)
   and wait for the write. Only then continue.
4. Check the returned loan: status is `deposit / action_required`, the asset is BTC, the amount is at least what the
   user approved and no more than their balance less the fee, the expiry is in the future.
5. Send `initialDeposit.targets.BTC.amount` to `initialDeposit.targets.BTC.target.address` with `sendAsset()`.
6. Save the transaction id (`step: deposited`). Add an activity entry of kind `borrow`, status `pending`.
7. Show Loan progress and start polling.

If `create()` throws `SimpleLoanCreatedError`, the loan exists: fetch it by the error's `loanId` and continue at 3.
`create()` is never called a second time for one confirmation.

### 6.2 Resume

On opening the Borrow screen, and on wallet unlock, for each record of the active account that is not closed:

| Record step | Loan status | Action |
|---|---|---|
| `created`, no transaction id | `deposit / action_required`, not expired | Look for a payment to the deposit address (Esplora). Found: save its id. Not found: show "Finish your loan" with **Send BTC** and **Cancel** |
| `created` | `deposit / expired` | Mark expired. Never send |
| `deposited` | anything | Show progress, poll |
| any | `repayment / active` | Loan page |
| any | `repayment / completed` | Mark closed |

### 6.3 Track

Poll `get(ref)` while the state is `confirming` or `processing`: every 30 s for the first 10 minutes, then every
60 s, only while the screen is visible. Stop on `active`, `completed`, `failed`, `expired`. On the Loan page,
refresh the position and price every 60 s for the health figures. No polling when no view is open.

### 6.4 Repay

1. Re-read the loan. Take `repayment.targets.ETH`; if it is missing or `debtAmount` is 0, say so and stop.
2. Check USDC balance and gas with `quoteSend()`.
3. Save a repay journal entry (`ref`, amount, `step: created`), then send the USDC with `sendAsset()`.
4. Save the transaction hash. Activity entry of kind `repay`.
5. Poll until the status returns to `repayment / active` (part) or `repayment / completed` (all).

On resume, a repay entry without a hash is checked against the account's recent USDC transfers to the repayment
address before the button is offered again.

### 6.5 Restore from seed

After a restore or an account switch, when the loan cache for the account is empty: `find(btcAddress)` and
`find(evmAddress)`, merge by reference, `get()` each, save. Runs once per account and on "Check again".

### 6.6 Liquidation

Detected when the position's collateral falls without a repayment, or an activity or history entry of operation
`liquidation` appears. The Loan page shows a banner and a history row. The exact shape of this data for Simple
Loans must be confirmed on a real position or with Liquidium before the copy is final.

### 6.7 Account, network and lock

- Loans are stored per account (keyed by the account's BTC address). Switching account switches the list.
- Switching to testnet shows 5.9; records are kept.
- Lock clears nothing in the loan cache: it holds no secrets. Polling stops with the view.

## 7. Failures and what the user sees

| Failure | Handling |
|---|---|
| `create()` times out | Do not retry. `find()` by address to see whether it was created; show the result |
| Bitcoin send throws | Check Esplora for a payment to the deposit address before offering "Send BTC" again |
| Popup closed between create and send | Resume (6.2) |
| Deposit window expired | "This loan request expired. Nothing was sent." Start again |
| Deposit below the required amount (`topUp.required`) | Banner with the shortfall and "Send the rest" |
| USDC payout delayed | Progress stays on "Sending your USDC", with the reference and a support link |
| Status `failed` | Show Liquidium's state, the reference, and that collateral is refunded to the BTC address |
| Rate or fee changed before confirm | Back to Review with the new figures |
| Service or canister unreachable | Banner with retry; read-only cache |
| Repay sent but not yet detected | "Confirming on Ethereum (n of 64)"; never prompt a second repayment meanwhile |

## 8. Data

| Key (`chrome.storage.local`, through the core's `KeyValueStore`) | Value |
|---|---|
| `lend_loans_v1` | `Record<accountBtcAddress, LoanRecord[]>` |
| `lend_journal_v1` | Open deposit and repay intents with their transaction ids |

```ts
interface LoanRecord {
  provider: 'liquidium';
  ref: string; loanId: string;
  collateral: { asset: 'BTC'; amount: string };          // base units as strings
  borrow: { asset: 'USDC'; chain: 'ETH'; amount: string };
  deposit: { address: string; amount: string; expiresAt: number | null; txid?: string };
  step: 'created' | 'deposited' | 'active' | 'closed' | 'expired' | 'failed';
  openedAt: number; lastStatus?: { operation: string; state: string }; lastSeenAt?: number;
}
```

The cache is a convenience. Liquidium is the source of truth and `find()` rebuilds it. Add both keys to the
storage table in `architecture.md`. Amounts are `bigint` in memory and decimal strings on disk (rule 8).

Health figures, all in the core, from pool and price data:

- current LTV = debt value ÷ collateral value
- health = collateral value × liquidation threshold ÷ debt value
- liquidation price of BTC = debt value ÷ (collateral amount × liquidation threshold)

## 9. Fees

The first release charges no fee of ours. `lend/fees.ts` exists with a rate of 0 so the Review page and the tests
already carry the line.

Charging in the deposit transaction needs a second output, and `btcAccount.sendTransaction` builds one recipient
plus change. Turning the fee on therefore needs our own PSBT builder (coin selection, two outputs, change, signing
with the account key; `bitcoinjs-lib` is already in the tree through the WDK). That is its own phase, with its own
tests, after a decision on the rate and the treasury address. See `borrow&lend/monetisation.md`.

## 10. Security

- The deposit and repayment addresses come from Liquidium. Before sending, the wallet re-reads the loan and
  checks asset, amount bounds and expiry (6.1 step 4). The Review and progress pages show the address.
- Borrowed funds and refunds go only to the active account's own addresses. There is no address field.
- The SDK runs in the wallet UI only. It receives addresses and amounts, never keys or the seed.
- Do not pass the SDK's `headers` option: the service's CORS policy would reject the request.
- The SDK version is pinned exactly; upgrades are reviewed against its changelog.
- Add a "Borrow" section to `security-model.md`: what Liquidium can and cannot do, and that a loan's collateral
  is held by Liquidium's canisters, not by the wallet.

## 11. Tests

| Level | What |
|---|---|
| Core unit | Status → step mapping for every state; health, LTV and liquidation-price maths; quote validation; polling rule; store and journal (save-before-send ordering, resume table of 6.2) |
| Extension unit | `runtime.ts` with fake signers: deposit amount and address taken from the loan, not from the form; `create()` called once; `SimpleLoanCreatedError` path |
| E2E (Playwright) | A build with `VITE_LEND_MOCK=1` swaps in `mock-client.ts`. Journeys: open a loan to "active"; resume after closing between create and send; expired request; part repay; full repay to "closed"; testnet state; restore finds a loan |
| By hand, mainnet | One real loan end to end with the smallest workable amounts. Record times and fees in `testing.md` |

The mock is chosen at build time and is absent from release builds; the release checklist gains a line to confirm it.

## 12. Files

| New | Purpose |
|---|---|
| `core/src/lend/{types,liquidium,store,fees}.ts` + tests | Shared logic |
| `src/lend/{liquidium-client,mock-client,runtime,useLoans}.ts` | Host side |
| `src/popup/screens/Borrow.tsx` (+ `borrow/`) | Pages |
| `tests/unit/lend.test.ts`, `tests/e2e/borrow.spec.ts` | Tests |
| `docs/user/borrowing.md` | User guide, with the risks stated plainly |

| Changed | Change |
|---|---|
| `core/src/index.ts` | Export `lend/*` |
| `core/src/activity.ts` | `ActivityKind` gains `borrow`, `repay` |
| `core/src/i18n/en.ts`, `zh-CN.ts` | `borrow.*`, `nav`/`action` keys |
| `src/popup/screens/shared.tsx` | `Screen` gains `'borrow'` |
| `src/popup/App.tsx` | Route `borrow` |
| `src/popup/screens/Home.tsx` | Quick action, BTC asset-sheet button, loan card |
| `src/popup/screens/Activity.tsx` | Render the two new kinds, link to the loan |
| `src/design-system/primitives.tsx`, `theme.css` | A borrow icon in `MI`; health-bar colours as tokens in both themes, if the existing ones do not fit |
| `package.json` | `@liquidium/client` at exactly `0.10.0` |
| `vite.config.ts`, `src/lib/config.ts` | `VITE_LEND_MOCK`; Liquidium app URL for "View on Liquidium" |
| `CLAUDE.md`, `docs/README.md`, `architecture.md`, `security-model.md`, `known-limitations.md`, `testing.md`, `release-checklist.md` | Documentation |

## 13. Phases

| # | Phase | Output | Estimate |
|---|---|---|---|
| 0 | Spike | SDK installed; pools and prices listed from inside the extension; bundle size and chunking measured; decision recorded | 1 day |
| 1 | Core | `lend/` types, logic, store, tests | 2 days |
| 2 | Open a loan | Hub, New loan, Review, Progress; runtime; resume | 3 days |
| 3 | Manage | Loan page, Repay, closed loan, Find, Home card, Activity | 3 days |
| 4 | Harden | E2E with the mock, both languages, docs, one real mainnet loan, release checklist | 2–3 days |
| 5 | Fee (optional) | Bitcoin PSBT builder with a fee output; rate from config | 3 days |
| 6 | PUSD | Token listing, then read-only loans, then borrowing, per `borrow&lend/pusdloandocs/integration-plan.md` | separate plan |

Phases 0–4 are about two and a half weeks of work. Each phase ends with `npm run typecheck`, `npm test` and
`npm run build` passing, and a commit.

**Phase 0 decides whether to continue.** If the SDK cannot run inside the extension page, or adds more weight
than we accept, stop and reconsider before building screens.

## 14. Open questions

| Question | Blocks |
|---|---|
| Does Liquidium offer a partner arrangement, and a staging environment? | Fee decision; test cost |
| How does a liquidation of a Simple Loan appear in the SDK data? | Final copy of 6.6 |
| Can collateral be added to an open Simple Loan? | An "Add collateral" action on the Loan page |
| Is there a minimum part repayment? | Repay validation |
| Legal review of offering loans, and of charging for it | Release; phase 5 |
| Default LTV: 40% is proposed | New loan page |
