# Plan to the deadline

Deadline: **Friday 30 October, 17:00 EAT**. Aim to submit by **15:00** and check every link.
Today: Monday 26 October. About four and a half working days for: QVAC in the phone app, the agent, swaps and Mesh
position creation through it, and the offline demo.

That is a lot for the time. The **cut line** below says what goes first if a day slips.

Rules for this machine: one heavy job at a time (Metro, npm install, tests). Cloud builds on EAS do not count.

## Day 1 — Monday 26: QVAC and WDK in one app, on the phone (gate)

| Step | Done when |
|---|---|
| Phone: Developer options, Wireless debugging, `adb pair` + `adb connect` from this PC (platform-tools) | `adb devices` lists the phone |
| Branch `agent` in the app. `react-native-bare-kit` 0.16.x, `@qvac/sdk` 0.22.0, `expo-file-system`, `expo-device`, `expo-dev-client`, the QVAC Expo plugin, `qvac.config.json` | `npm install` and `npm run bundle:worklet` pass; typecheck and tests pass |
| A hidden debug screen: download `QWEN3_1_7B_INST_Q4`, load with `tools: true`, one completion with one tool | code ready before the build |
| One EAS `development` build, install with `adb install` | the app opens |
| On the phone: unlock, balances, a chipnet send (WDK still works); then the debug screen (QVAC works) | both pass; tokens/s, load time and RAM written into research.md |

**Gate at the end of day 1**

- Both work → go on.
- WDK breaks on bare-kit 0.16 → try the Bare versions QVAC's Expo example uses; if still broken by Tuesday noon,
  move the agent to the extension with `qvac serve` in WSL (design kept; only `LlmClient` changes).
- QVAC fails to load 1.7B → 600M; then `ctx_size` 2048.

While the build runs (cloud), write the core: `agent/types.ts`, `llm.ts`, `loop.ts`, a scripted fake LLM, tests.

## Day 2 — Tuesday 27: tools and the Agent tab

- `agent/snapshot.ts`: save the last portfolio and prices so the agent can answer offline.
- `get_portfolio`, `get_positions`, `get_activity`, `explain`, `plan_swap`, `draft_swap` (existing swap flows).
- `agent/strategies.ts` and `plan_mesh_strategy`.
- Agent tab: chat, streaming answer, draft cards, offline and "needs network" chips, model status. Theme colours,
  `t()` strings in `en` and `zh-CN`.
- Model download screen with progress, so the demo phone has the model before going offline.
- JavaScript changes reach the phone through Metro and the dev client, no new build.

## Day 3 — Wednesday 28: Mesh position creation (mid-week offline check)

- `mesh/plan.ts`, `mesh/verify.ts`, `mesh/genesis.ts` in the core, tested against the frontend's fixture.
- `draft_mesh_position` in the app: preview → verify → seed → genesis → sign in the worklet → broadcast → register.
- One position created on chipnet from the phone through the agent.
- Show the offline part at the mid-week check.

## Day 4 — Thursday 29: loans, safety, accuracy

- `plan_loan` (draft only) and `policy.ts` with tests; per-action limit in Settings.
- Eval set (about 40 prompts) run on the phone; tune prompts and tool descriptions.
- A `preview` EAS build (release, what judges would install) and a full pass on it.
- Docs: user guide (download the model, what the agent can do, what needs a network), developer notes, known limits.
- Decide the repository and push.

## Day 5 — Friday 30 morning: record and submit

- Record the demo (script below) with flight mode visible. Upload, check the link in a private window.
- README for judges (checklist below). Submit on DoraHacks by 15:00.

## Status & Completed Milestones (Thursday 29 October)

All core deliverables and advanced features for the Local AI agent are now fully implemented and verified with 63 passing automated tests:

1. **Production Offline Snapshots**:
   - `buildSnapshot` and encrypted storage in XChaCha20-Poly1305 keystore.
   - **Homepage Token List Offline Balance Persistence**: When offline or in airplane mode, the wallet homepage (`wallet.tsx`) immediately populates from the last saved snapshot, displaying token balances, holdings, and USD totals with an `"Offline · Showing last saved balances"` indicator.
   - Automatic background snapshot refresh whenever connected and unlocked.

2. **Underfunded Strategy & Swap Creation with "Top Up" Flow**:
   - The agent **never aborts or blocks strategy/swap creation** due to insufficient balance.
   - Computes required deposits, calculates exact missing satoshis/tokens, marks drafts as `underfunded`, and displays actionable **"Top Up"** buttons that route directly to the Receive screen.

3. **Fast Offline Quick Intent Engine**:
   - Instant 0ms regex routing for:
     * Swaps and CCTP cross-chain bridges
     * Mesh strategies: Accumulate ladder, Take profit, Range MM, Limit orders
     * Portfolio, balances, positions, and activity queries
     * DeFi collateral loan calculations
     * Complete financial concept explanations

4. **Enhanced Chat UI/UX & Formatted Responses**:
   - Native Markdown rendering: headers, bullet lists, numbered steps, bold highlights, inline code pills, and highlighted token tickers (`$BCH`, `$MESH`, etc.).
   - Dynamic ticker and action suggestion chips above the composer.

5. **Token Logo & Selector Polish**:
   - FlatList recycling state bug resolved in `TokenIcon.tsx`.
   - Support for HTTP/HTTPS and IPFS gateways (`ipfs.io`, `cloudflare-ipfs.com`).
   - Clean, vibrant typographic fallbacks for all tokens.

6. **Documentation & Prompt Bank**:
   - Comprehensive prompt bank in [prompts.md](prompts.md) with 50+ tested queries across all archetypes, Swahili queries, loans, and edge cases.

---

## Cut line

If time runs short, drop from the bottom first:

1. Swahili prompts, voice input.
2. Laya router (keep the forced `choose_area` call).
3. `plan_loan`.
4. Mesh registration and metadata pin (the position exists on chain; registration can be done later).
5. Mesh creation entirely: keep `plan_mesh_strategy` as a draft.

Never cut: the offline demo, the draft-and-approve step, the policy checks, the network declaration.

## Demo script (about 3 minutes)

1. Flight mode on, shown on screen. Model already downloaded; Agent tab shows "on this phone".
2. "What do I hold?" → portfolio from the snapshot, with its age. **Offline.**
3. "Keep accumulating MESH cheaply with a quarter of my BCH" → Accumulate Ladder: range, bins, worst case.
   **Offline.**
4. "How much USDC could I borrow on my BTC safely?" → amount at 40% LTV, liquidation price. **Offline.**
5. "Swap 0.01 BCH for MESH" → draft with the "needs network" chip; Approve waits.
6. Flight mode off. Approve the swap → PIN → intent funded and filled on chipnet. **Network, declared.**
7. Approve the ladder → PIN → position created on chipnet, NFT appears in the wallet. **Network, declared.**
8. Close on the offline / online table.

## Submission checklist

- [ ] Track: On-device agentic finance.
- [ ] Problem and audience: people who want DeFi strategies without handing their keys, or their questions, to a cloud AI.
- [ ] Public repository with setup steps, dependencies, and what was built during the event (the wallet existed
      before 24 October; the agent, its tools, Agent tab, QVAC integration and Mesh creation in the app are new).
- [ ] QVAC: `@qvac/sdk` 0.22.0, `react-native-bare-kit` version, model `QWEN3_1_7B_INST_Q4`, download steps, files.
- [ ] WDK: which accounts and calls the agent drafts for (`sendTransaction`, `signPreparedTransaction`,
      `broadcastTransaction`), and that signing stays in the worklet.
- [ ] Phone model, Android version, RAM, tokens per second measured on day 1, model licence (Qwen3: Apache-2.0).
- [ ] Network-dependent features listed.
- [ ] Offline demo video link.
- [ ] No seeds, keys, `.env` values or private data in the repository or the video.

## Open questions

1. **Repository** (decided Thursday): a new public repo with the app and the core, or push the existing ones.
2. **Extras**, only above the cut line: Swahili requests, voice input (QVAC transcription), rule-based automations
   ("take profit if BCH passes $X") that the agent writes and the wallet checks when online.

## Answered on 26 October

| Question | Answer |
|---|---|
| Where does the agent run first? | Phone app |
| An Android 12+ phone with 6 GB RAM or more? | Yes |
| What executes in the demo? | Swaps and Mesh position creation; loans as drafts |
