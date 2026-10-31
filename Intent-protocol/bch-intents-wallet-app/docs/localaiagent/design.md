# Design

Decisions taken on 26 October 2026: **phone app first**, on an Android 12+ phone with 6 GB RAM or more; the demo
**executes swaps and creates Mesh positions**; loans are planned and shown as drafts. The repository to submit is
decided on Thursday.

## 1. The idea in one picture

```
 user: "Put a quarter of my BCH into a ladder that buys more MESH if it dips"
   │
   ▼
 ┌──────────────── offline, on the phone ──────────────────────────┐
 │ QVAC model (Qwen3 1.7B)  ──tool call──▶  wallet-core agent tools │
 │   reads the request         plan_mesh_strategy({ archetype,      │
 │   picks a tool              token, budget, risk })               │
 │   explains the result     ◀──draft────  checks, maths, draft     │
 └──────────────────────────────────────────────────────────────────┘
   │  Draft card: what, how much, price range, worst case, fees
   ▼
 user taps Approve, enters PIN
   │
   ▼
 ┌──────────────── needs a network (declared) ─────────────────────┐
 │ quote / Mesh preview → sign in the WDK worklet → broadcast       │
 └──────────────────────────────────────────────────────────────────┘
```

The model is the interface, not the authority. It never sees a key, a seed or a raw transaction, and it cannot
sign. Everything it proposes passes through ordinary code that rejects bad arguments and computes the numbers.

## 2. Three runtimes in one app

| Runtime | Runs | Holds keys |
|---|---|---|
| React Native (Hermes) | screens, agent loop, tools, transaction layout | never |
| WDK worklet (Bare) | the four wallet modules: derive, sign, send | while unlocked |
| QVAC worker (Bare) | the model: load, completion with tools | never |

The WDK worklet is reached through `src/wdk/bridge.ts` as today. QVAC is reached through `@qvac/sdk`, which starts
its own Bare worker. The two workers never talk to each other; React Native sits between them.

**If two Bare runtimes plus a 1.1 GB model use too much memory**, the fallback is the 600M model, then a smaller
`ctx_size`. Loading QVAC inside the WDK worklet (`@qvac/inference`, one Bare runtime) is possible in principle but
not attempted this week.

## 3. Where the code lives

```
bch-intents-wallet-core/src/agent/        shared, no UI, no keys, no platform APIs (rule 11)
  types.ts        AgentTool, ToolResult, Draft (plain shapes, bigint amounts)
  tools/          one file per tool: JSON schema + validate + run
  prompts.ts      system prompt, per-area examples, the refusal rules
  loop.ts         history → completion → tool → result → answer (at most 4 steps)
  policy.ts       limits and checks applied to every draft (section 6)
  llm.ts          LlmClient interface: chat(history, tools, opts) → events
  strategies.ts   the eight Mesh archetypes as data, each mapped to shape, range rule and bin rule
  evals/          prompts with the expected tool call; run in vitest against a fake, and on the phone against QVAC

bch-intents-wallet-core/src/mesh/
  v4.ts           (exists) commitment codec, price grid, read client
  plan.ts         new: client for /v4/positions/preview and /v4/positions, plan types
  verify.ts       new: port of frontend/src/lib/mesh/v4/verify.ts — rejects a server plan that does not match
  genesis.ts      new: seed and genesis layout as an unsigned transaction + source outputs (pure JS, no libauth)

bch-intents-wallet-app/
  src/agent/qvac.ts        LlmClient over @qvac/sdk: download, load, completion, cancel, unload
  src/agent/runtime.ts     binds tools to portfolio, swap flows, Mesh and the bridge
  src/agent/snapshot.ts    last portfolio and prices saved for offline use
  src/app/(app)/(tabs)/agent.tsx   chat, draft cards, approve and reject
  src/app/(app)/agent/model.tsx    model download and status
  qvac.config.json         only the llamacpp completion plugin
```

`LlmClient` keeps QVAC behind one interface, so tests use a scripted fake and the extension can later use the same
tools over `qvac serve --openai`.

## 4. Tool catalogue

**Read** and **Plan** tools work offline. **Act** tools make a draft; nothing runs until the user approves, and the
run needs a network.

| Tool | Kind | Offline | What it does | Built on |
|---|---|---|---|---|
| `get_portfolio` | Read | yes | Balances per network, USD value from the saved prices with their age | `agent/snapshot.ts` (new) |
| `get_positions` | Read | yes | Mesh positions held, decoded from the NFT: shape, range, bins | `mesh/v4.ts decodeCommitment, priceRange` |
| `get_activity` | Read | yes | Recent swaps, intents, sends, with status | activity store |
| `explain` | Read | yes | An intent, a position, a fee or a term in plain words | glossary in `prompts.ts` |
| `plan_swap` | Plan | yes | Picks the route (CashToken intent, CCTP, Jupiter), checks balances | `swap/tokens.ts resolveRoute, balanceOf` |
| `plan_mesh_strategy` | Plan | yes | Goal → archetype → shape, range, bin step, bin count, BCH and token split | `agent/strategies.ts`, `mesh/v4.ts gridPrice` |
| `plan_loan` | Plan | yes | Max borrow, LTV, liquidation price, health for BTC collateral | maths from `borrow-implementation-plan.md` |
| `draft_swap` | Act | no | Live quote, then the swap draft | `src/swap/useSwap.ts` flows |
| `draft_mesh_position` | Act | no | Mesh preview → verify → seed (if needed) → genesis → sign → broadcast → register | section 5 |
| `draft_loan` | Act | no | Shown only; Approve says "coming soon" (Liquidium is mainnet only) | — |

### Keeping a small model accurate

- At most six tools per turn. A first forced call `choose_area` (`portfolio`, `swap`, `strategy`, `loan`,
  `explain`) narrows the next step to that area's tools. QVAC's Laya decision model is the alternative router if it
  proves faster.
- Enums instead of free text (`archetype: "accumulate-ladder" | …`, `risk: "low" | "medium" | "high"`).
- `tool_choice: "required"` on the first step, so a request always becomes a structured call.
- Amounts are passed as the user said them ("half", "0.2", "all") and resolved by code. The model does no arithmetic.
- Numbers in the final answer come from the tool result, inserted by code, not written by the model.
- About 40 eval prompts (English, a few Swahili) with the expected tool and arguments, run before each prompt change.

## 5. Creating a Mesh position from the phone

The web dapp already does this (`frontend/src/lib/mesh/v4/v4Tx.ts`, with cashscript and libauth). The app ports the
layout, not the libraries:

1. **Plan.** `POST /api/v1/v4/positions/preview` on the Mesh server with token, bin step, range, market price,
   deposit, shape and the seed outpoint. The server returns the outputs in order (identity, NFT, bins, BCMR) and the
   commitment.
2. **Verify.** `mesh/verify.ts` checks the plan against what the agent asked for: commitment fields, totals, every
   bin owned by this wallet's key, nothing paid to an address the wallet does not expect. A plan that fails is
   rejected and shown as an error.
3. **Seed.** The position's category is the txid of a transaction whose output 0 the genesis spends. If the wallet
   has no plain coin at output 0, send BCH to itself: `sendTransaction` puts the recipient at output 0.
4. **Genesis.** `mesh/genesis.ts` lays out input 0 = the seed, then token inputs, then BCH inputs; the plan's
   outputs in order; token change, then BCH change; fee from the measured size. Coins come from `getUtxos` over the
   bridge.
5. **Sign and send.** `call(net, account, 'signPreparedTransaction', { transaction, sourceOutputs })`, then
   `broadcastTransaction`. The app already does this for WalletConnect BCH requests.
6. **Register.** `POST /api/v1/v4/positions` with the genesis txid and bins; pin the metadata.

Tests: the shared fixture `frontend/src/lib/mesh/__fixtures__/v4Plan.fixture.json`, with the genesis compared byte
for byte against the frontend's builder. Runs on chipnet.

## 6. Safety rules (in code, not in the prompt)

1. The agent never holds keys. Tools get addresses and saved data; signing stays in the worklet.
2. Every Act tool returns a draft. Running it needs Approve and the PIN (or biometrics), as sends do today.
3. Policy on every draft: network matches the wallet's mode; amount within the balance and a per-action limit set
   in Settings; swap slippage and auction floor within today's limits; tokens only from the wallet's lists; Mesh
   plans must pass `verify.ts`.
4. Testnet (chipnet) for the demo, with the mode shown on every draft.
5. Token names, memos and server answers enter tool results as quoted data and are never followed as instructions.
   Policy does not depend on the model obeying.
6. Chats stay on the phone: saved encrypted (section 9), shown only after unlock, deleted with the wallet. Nothing
   is logged (rule 3), and no seed, PIN or key ever enters a chat or a tool result.

## 7. Offline and online, declared

| Works with the internet off | Needs a network |
|---|---|
| Loading and running the model | First model download (before the demo) |
| Understanding the request, choosing a tool | Swap quotes, prices newer than the snapshot |
| Portfolio and positions from the snapshot | Broadcasting any transaction |
| Mesh strategy design and the price-grid maths | CashToken relayer, CCTP swap server, Jupiter |
| Loan maths from the last snapshot | Mesh preview, registration, metadata pin |
| Explanations, drafts | Liquidium |
| Underfunded strategy creation & Top Up prompts | Executing transaction / broadcast |
| Homepage token list cached balance view | Real-time on-chain balance refresh |

Answers and plans carry an "offline" chip; drafts that need a network carry a "needs network" chip, and their
Approve button waits for a connection.

## 8. Phone app changes outside the agent

| Change | Why | Risk |
|---|---|---|
| `react-native-bare-kit` 0.14.5 → 0.16.x | QVAC's peer requirement | The WDK worklet and the pinned Bare stack (commit `40b0e15`) must be checked again on the device |
| `@qvac/sdk` 0.22.0 + `@qvac/sdk/expo-plugin` (`installMissingPrebuilds`) | QVAC native addons (`@qvac/fabric-android-arm64`) | Prebuild relinks addons; run it again after every install |
| `expo-file-system`, `expo-device` | QVAC peers | — |
| `expo-dev-client` and the `development` profile | Change JavaScript without a 13-minute cloud build each time | One extra build; Metro over Wi-Fi on this PC |
| ProGuard keep rules if QVAC classes are stripped | Release builds minify | Only if the first build crashes |
| `minSdkVersion` 29 | QVAC | Already set |

## 9. Saved chats and working offline

**Setup, online once.** The Agent tab downloads the model (about 1.1 GB) to the phone; the wallet saves a snapshot
(balances, prices, Mesh positions, recent activity). After that the AI needs no network.

**Chats.** A list of threads per account, like a messaging app. Each thread holds its messages, cards and outbox
items. Stored in AsyncStorage, encrypted with a key kept in `expo-secure-store`; readable only after unlock;
removed by "Remove wallet". The model sees a short summary of older turns plus the latest ones (4,096-token context);
the summary is written by the same model, on the phone.

**Outbox.** An action that needs a network becomes a card marked "Waiting for network". Nothing is signed. When the
phone is online the card refreshes its quote or Mesh plan, shows what changed since it was planned, and waits for
Approve and the PIN. The result (transaction link, new position) is written back into the same thread.

| Saved on the phone | Never saved |
|---|---|
| Threads, messages, cards, outbox items | Seed phrase, PIN, private keys |
| Wallet snapshot | Anything sent to a cloud AI (there is none) |
| The model file | |

Open: approve outbox items when back online (recommended) or pre-approve offline; signing plain BCH sends offline
from saved coins (not planned this week).
